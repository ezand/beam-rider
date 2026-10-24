import { fileHashes, filesByRegion } from "./files";
import type { FoundImage, GameField, ScrapeResult, Scraper } from "./types";

/**
 * Hasheous (https://hasheous.org): identifies games by checksum and maps
 * them to other databases.
 *
 * - Without a key, `Lookup/ByHash` gives the game's name, year, publisher,
 *   logo, an AI-written description (kept as "hasheous-ai", the last choice
 *   for descriptions), and links to IGDB, Wikipedia and others, which later
 *   scrapers use.
 * - With an app key (HASHEOUS_CLIENT_API_KEY; Hasheous issues them on request
 *   in its Discord), the IGDB record through its metadata proxy too: summary,
 *   genres, developer, publisher, release date, cover, screenshots, artwork.
 *   Its fields follow IGDB's v4 API, which hasn't been checked against the
 *   live proxy without a key.
 *
 * Files identified by name (discs) are looked up by their DAT entry's hashes.
 */

export const HASHEOUS_URL = "https://hasheous.org/";

type Mapping = { source: string; id: string; status: string };
type Lookup = {
  id?: number;
  name?: string;
  publisher?: { name?: string };
  signature?: { game?: { year?: string; publisher?: string } };
  metadata?: Mapping[];
  attributes?: { attributeName: string; value: unknown }[];
};

/** IGDB's v4 game, with the expansions requested. */
type IgdbGame = {
  id?: number;
  summary?: string;
  first_release_date?: number;
  genres?: ({ name?: string } | number)[];
  involved_companies?: ({ company?: { name?: string } | number; developer?: boolean; publisher?: boolean } | number)[];
  cover?: { image_id?: string } | number;
  screenshots?: ({ image_id?: string } | number)[];
  artworks?: ({ image_id?: string } | number)[];
  url?: string;
};

const LINK_SOURCES: Record<string, string> = {
  Wikipedia: "wikipedia",
  IGDB: "igdb",
  TheGamesDb: "thegamesdb",
  ScreenScraper: "screenscraper",
  RetroAchievements: "retroachievements",
  SteamGridDb: "steamgriddb",
};

const object = <T>(value: T | number | undefined): T | undefined => (typeof value === "object" ? value : undefined);

export const hasheous: Scraper = {
  id: "hasheous",
  name: "Hasheous",
  configured: () => true,

  async scrape(target, { http, dats, settings }) {
    const base = settings.urls?.hasheous ?? HASHEOUS_URL;
    const headers: Record<string, string> = settings.hasheousClientKey ? { "X-Client-API-Key": settings.hasheousClientKey } : {};

    let found: Lookup | null = null;
    const tried = new Set<string>();
    search: for (const file of filesByRegion(target.files)) {
      for (const hashes of fileHashes(file, target.platform.slug, dats)) {
        const tries: [string, string | null][] = [
          ["sha1", hashes.sha1],
          ["md5", hashes.md5],
          ["crc", hashes.crc32 === null ? null : hashes.crc32.toString(16).padStart(8, "0")],
        ];
        for (const [kind, hash] of tries) {
          if (!hash || tried.has(hash)) continue;
          tried.add(hash);
          found = await http.json<Lookup>("hasheous", `${base}api/v1/Lookup/ByHash/${kind}/${hash}`, { headers });
          if (found?.name) break search;
        }
      }
    }
    if (!found?.name) return null;

    const result: ScrapeResult = {
      externalId: found.id === undefined ? null : String(found.id),
      fields: {},
      fieldSources: {},
      genres: [],
      images: [],
      links: {},
    };
    for (const mapping of found.metadata ?? []) {
      const key = LINK_SOURCES[mapping.source];
      if (key && mapping.status === "Mapped" && mapping.id) result.links![key] = mapping.id;
    }
    const year = found.signature?.game?.year;
    if (year && /^\d{4}$/.test(year)) result.fields!.release_date = year;
    const publisher = found.publisher?.name ?? found.signature?.game?.publisher;
    if (publisher) result.fields!.publisher = publisher;
    const attribute = (name: string) => found!.attributes?.find((a) => a.attributeName === name)?.value;
    const ai = attribute("AIDescription");
    if (typeof ai === "string" && ai.trim()) {
      result.fields!.description = ai.trim();
      result.fieldSources!.description = "hasheous-ai";
    }
    const logo = attribute("Logo");
    if (typeof logo === "string" && logo) result.images!.push({ type: "logo", url: `${base}api/v1/images/${logo}` });

    // IGDB, through Hasheous's proxy, if there's a key and a mapping.
    if (settings.hasheousClientKey && result.links!.igdb) {
      const expand = "genres,involved_companies,involved_companies.company,cover,screenshots,artworks";
      const response = await http.json<IgdbGame | IgdbGame[]>(
        "hasheous",
        `${base}api/v1/MetadataProxy/IGDB/Game?Id=${encodeURIComponent(result.links!.igdb)}&expandColumns=${expand}`,
        { headers },
      );
      const game = Array.isArray(response) ? response[0] : response;
      if (game) mergeIgdb(result, game, base);
    }
    return result;
  },
};

/** Adds an IGDB game's details and images, marked as IGDB's. */
function mergeIgdb(result: ScrapeResult, game: IgdbGame, base: string) {
  const set = (field: GameField, value: string | undefined) => {
    if (!value) return;
    result.fields![field] = value;
    result.fieldSources![field] = "igdb";
  };
  if (game.summary?.trim()) {
    set("description", game.summary.trim());
    result.descriptionUrl = game.url ?? null;
  }
  if (game.first_release_date) set("release_date", new Date(game.first_release_date * 1000).toISOString().slice(0, 10));
  const companies = (game.involved_companies ?? []).map((c) => object(c)).filter((c) => c !== undefined);
  const company = (role: "developer" | "publisher") =>
    object(companies.find((c) => c[role] && object(c.company)?.name)?.company)?.name;
  set("developer", company("developer"));
  set("publisher", company("publisher"));
  const genres = (game.genres ?? []).map((g) => object(g)?.name).filter((name): name is string => Boolean(name));
  if (genres.length) {
    result.genres = genres;
    result.fieldSources!.genres = "igdb";
  }
  const image = (type: FoundImage["type"], value: { image_id?: string } | number | undefined) => {
    const id = object(value)?.image_id;
    if (id) result.images!.push({ type, url: `${base}api/v1/MetadataProxy/IGDB/Image/${id}.jpg` });
  };
  image("box-front", game.cover);
  for (const shot of game.screenshots ?? []) image("screenshot", shot);
  for (const art of game.artworks ?? []) image("fanart", art);
}
