import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary, type Library } from "../library";
import { openDats } from "../scanner/dat";
import { createHttp } from "./http";
import { rank } from "./merge";
import { scrape, scraperOrder, type ScrapeOptions } from "./scrape";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const JPEG = new Uint8Array([255, 216, 255, 224, 4, 5, 6]);
const MARIO_SHA1 = "6b47bb75d16514b6a476aa0c73a683a2a4c18765";
const WII_SHA1 = "9ac7242a5feebe1d0a6e2775c21f482c471b2240";
const KEY = "app-key";

/** One server standing in for libretro-thumbnails, Hasheous and Wikipedia. */
let server: ReturnType<typeof Bun.serve>;
const requests: string[] = [];
let rateLimitsLeft = 0;

const thumbnails = new Set([
  "/libretro/Nintendo - Super Nintendo Entertainment System/Named_Boxarts/Super Mario World (USA).png",
  "/libretro/Nintendo - Super Nintendo Entertainment System/Named_Titles/Super Mario World (USA).png",
  "/libretro/Nintendo - Super Nintendo Entertainment System/Named_Snaps/Super Mario World (USA).png",
  "/libretro/Nintendo - Wii/Named_Boxarts/Wii Game (USA) (En,Fr,Es) (Rev 2).png",
  // A name with characters libretro replaces: "Kirby: Dream?" -> "Kirby_ Dream_".
  "/libretro/Nintendo - Super Nintendo Entertainment System/Named_Boxarts/Kirby_ Dream_ (USA).png",
]);

const lookups: Record<string, object> = {
  [MARIO_SHA1]: {
    id: 337, name: "Super Mario World",
    publisher: { name: "Nintendo (Hasheous)" },
    signature: { game: { year: "1991" } },
    metadata: [
      { source: "Wikipedia", id: "https://en.wikipedia.org/wiki/Super_Mario_World", status: "Mapped" },
      { source: "IGDB", id: "1070", status: "Mapped" },
      { source: "GOG", id: "", status: "NotMapped" },
    ],
    attributes: [
      { attributeName: "AIDescription", value: "An AI wrote this about Mario." },
      { attributeName: "Logo", value: "LOGO1" },
    ],
  },
  [WII_SHA1]: {
    id: 900, name: "Wii Game",
    signature: { game: { year: "2009", publisher: "Nintendo" } },
    metadata: [{ source: "IGDB", id: "2000", status: "Mapped" }],
    attributes: [{ attributeName: "AIDescription", value: "An AI wrote this about the Wii game." }],
  },
};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname);
      requests.push(`${req.method} ${path}`);
      if (path.startsWith("/libretro/")) {
        return thumbnails.has(path) ? new Response(req.method === "HEAD" ? null : PNG, { headers: { "Content-Type": "image/png" } }) : new Response(null, { status: 404 });
      }
      if (path.startsWith("/hasheous/api/v1/Lookup/ByHash/")) {
        if (rateLimitsLeft > 0) {
          rateLimitsLeft--;
          return new Response("slow down", { status: 429, headers: { "Retry-After": "0" } });
        }
        const lookup = lookups[path.split("/").pop()!];
        return lookup ? Response.json(lookup) : Response.json({ error: "not found" }, { status: 404 });
      }
      if (path.startsWith("/hasheous/api/v1/images/") || path.startsWith("/hasheous/api/v1/MetadataProxy/IGDB/Image/")) {
        return new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } });
      }
      if (path === "/hasheous/api/v1/MetadataProxy/IGDB/Game") {
        if (req.headers.get("X-Client-API-Key") !== KEY) return Response.json({ title: "Unauthorized" }, { status: 401 });
        return Response.json([{
          id: Number(url.searchParams.get("Id")),
          summary: "IGDB's summary.",
          first_release_date: 1257465600, // 2009-11-06
          genres: [{ name: "Platform" }, { name: "Adventure" }],
          involved_companies: [{ company: { name: "Nintendo EAD" }, developer: true }, { company: { name: "Nintendo" }, publisher: true }],
          cover: { image_id: "co1" },
          screenshots: [{ image_id: "sc1" }],
          url: "https://www.igdb.com/games/wii-game",
        }]);
      }
      if (path === "/wiki/w/rest.php/v1/search/page") {
        const q = url.searchParams.get("q") ?? "";
        if (!q.startsWith("Kirby")) return Response.json({ pages: [] });
        return Response.json({ pages: [
          { key: "Kirby_(series)", title: "Kirby (series)", description: "Video game series" },
          { key: "Kirby_Dream_and_Friends", title: "Kirby Dream and Friends", description: "1999 video game" },
          { key: "Kirby_Dream", title: "Kirby: Dream?", description: "1995 platform game" },
        ] });
      }
      if (path === "/wiki/api/rest_v1/page/summary/Kirby_Dream") {
        return Response.json({ type: "standard", extract: "Kirby: Dream? is a 1995 platform game." });
      }
      if (path === "/wiki/api/rest_v1/page/summary/Super_Mario_World") {
        return Response.json({
          type: "standard",
          extract: "Super Mario World is a 1990 platform game.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Super_Mario_World" } },
        });
      }
      return new Response(null, { status: 404 });
    },
  });
});
afterAll(() => server.stop());

let library: Library;
let media: string;
let ids: Record<string, number>;

beforeEach(async () => {
  requests.length = 0;
  rateLimitsLeft = 0;
  media = await mkdtemp(join(tmpdir(), "beamrider-scrape-"));
  library = openLibrary(":memory:");
  const { db } = library;
  const platform = (slug: string) => (db.query("SELECT id FROM platforms WHERE slug = ?").get(slug) as { id: number }).id;
  const game = (slug: string, key: string, title: string) =>
    (db.query("INSERT INTO games (platform_id, group_key, title, date_added) VALUES (?, ?, ?, 'now') RETURNING id")
      .get(platform(slug), key, title) as { id: number }).id;
  const file = (gameId: number, path: string, fields: Record<string, unknown>) =>
    db.query(`INSERT INTO rom_files (game_id, path, size, mtime_ms, title, scanned_at, dat_name, crc32, sha1, md5, region, match_method)
      VALUES ($game, $path, 1, 1, 'x', 'now', $dat_name, $crc32, $sha1, $md5, $region, $match_method)`)
      .run({ game: gameId, path, dat_name: null, crc32: null, sha1: null, md5: null, region: null, match_method: null, ...fields });
  ids = {
    mario: game("snes", "super mario world", "Super Mario World"),
    wii: game("wii", "wii game", "Wii Game"),
    homebrew: game("snes", "homebrew", "Homebrew"),
    kirby: game("snes", "kirby", "Kirby: Dream?"),
  };
  file(ids.mario!, "/roms/snes/smw-eu.sfc", { dat_name: "Super Mario World (Europe)", region: "Europe", crc32: 1, match_method: "hash" });
  file(ids.mario!, "/roms/snes/smw.sfc", { dat_name: "Super Mario World (USA)", region: "USA", crc32: 0xb19ed489, sha1: MARIO_SHA1, match_method: "hash" });
  // Identified by name: its own checksum isn't the DAT's, so Hasheous is asked by the DAT entry's too.
  file(ids.wii!, "/roms/wii/game.7z", {
    dat_name: "Wii Game (USA) (En,Fr,Es) (Rev 2)", region: "USA", match_method: "dat-name",
    sha1: "1111111111111111111111111111111111111111", crc32: 99,
  });
  file(ids.homebrew!, "/roms/snes/homebrew.sfc", { sha1: "0000000000000000000000000000000000000000", crc32: 7 });
  file(ids.kirby!, "/roms/snes/kirby.sfc", { dat_name: "Kirby: Dream? (USA)", region: "USA", match_method: "dat-name" });
});

const dats = (() => {
  const db = openDats(":memory:")!;
  const meta = db.prepare("INSERT INTO dat_meta (source, platform, game_name, crc32, field, value) VALUES ('test', 'snes', ?, ?, ?, ?)");
  const fields: [string, string][] = [["developer", "Nintendo EAD ???"], ["publisher", "Nintendo"], ["genre", "Action / Platform"],
    ["releaseyear", "1990"], ["releasemonth", "11"], ["users", "2"], ["franchise", "Super Mario"], ["esrb_rating", "E"]];
  for (const [field, value] of fields) {
    meta.run("Super Mario World (USA)", 0xb19ed489, field, value);
  }
  db.run("INSERT INTO dats (id, path, name, platform, imported_at) VALUES (1, 'redump/Nintendo - Wii.dat', 'Nintendo - Wii', 'wii', 'now')");
  db.run(`INSERT INTO dat_roms (dat_id, game_name, rom_name, size, crc32, sha1) VALUES
    (1, 'Wii Game (USA) (En,Fr,Es) (Rev 2)', 'Wii Game (USA) (En,Fr,Es) (Rev 2).iso', 4699979776, 5, '${WII_SHA1}')`);
  return db;
})();

const run = (extra: Partial<ScrapeOptions> = {}) =>
  scrape(library.db, {
    dats,
    mediaRoot: media,
    settings: { urls: { libretro: `${server.url.href}libretro/`, hasheous: `${server.url.href}hasheous/`, wikipedia: `${server.url.href}wiki/` } },
    http: createHttp({ retryDelayMs: 1, limits: {} }),
    ...extra,
  });

const game = (id: number) => library.db.query("SELECT * FROM games WHERE id = ?").get(id) as Record<string, any>;
const genres = (id: number) => (library.db.query(`SELECT g.name FROM game_genres gg JOIN genres g ON g.id = gg.genre_id
  WHERE gg.game_id = ? ORDER BY g.name`).all(id) as { name: string }[]).map((g) => g.name);
const images = (id: number) => library.db.query(`SELECT type, provider, region, path IS NOT NULL AS downloaded FROM game_images
  WHERE game_id = ? ORDER BY provider, type`).all(id);

describe("scraping", () => {
  test("runs Hasheous before Wikipedia, which starts from its links", () => {
    expect(scraperOrder(["wikipedia", "hasheous", "libretro"], {}).map((s) => s.id)).toEqual(["libretro", "hasheous", "wikipedia"]);
    expect(scraperOrder(["wikipedia"], {}).map((s) => s.id)).toEqual(["wikipedia"]);
    expect(rank("description", "wikipedia")).toBeLessThan(rank("description", "hasheous-ai"));
  });

  test("fills each field from the best source, and downloads the images", async () => {
    const summary = await run();
    expect(summary).toMatchObject({ games: 4, errors: [], cancelled: false });
    expect(summary.providers).toEqual({
      libretro: { found: 3, notFound: 1, errors: 0 },
      hasheous: { found: 2, notFound: 2, errors: 0 },
      wikipedia: { found: 2, notFound: 2, errors: 0 },
    });

    // Mario: details from libretro, the description from Wikipedia.
    const mario = game(ids.mario!);
    expect(mario).toMatchObject({
      title: "Super Mario World", developer: "Nintendo EAD", publisher: "Nintendo", release_date: "1990-11",
      players: "2", series: "Super Mario", rating: "ESRB E",
      description: "Super Mario World is a 1990 platform game.", description_url: "https://en.wikipedia.org/wiki/Super_Mario_World",
    });
    expect(JSON.parse(mario.field_sources)).toEqual({
      developer: "libretro", publisher: "libretro", release_date: "libretro", players: "libretro", series: "libretro",
      rating: "libretro", description: "wikipedia", genres: "libretro",
    });
    expect(genres(ids.mario!)).toEqual(["Action", "Platform"]);
    // libretro's art under the USA name (the best region), Hasheous's logo.
    expect(images(ids.mario!)).toEqual([
      { type: "logo", provider: "hasheous", region: null, downloaded: 1 },
      { type: "box-front", provider: "libretro", region: "USA", downloaded: 1 },
      { type: "screenshot", provider: "libretro", region: "USA", downloaded: 1 },
      { type: "title-screen", provider: "libretro", region: "USA", downloaded: 1 },
    ]);
    const card = library.gamesPage(library.platforms().find((p) => p.name === "SNES")!.id, 0, 10).find((g) => g.id === ids.mario)!;
    expect(card.art).toMatch(/^\/art\/512\/[0-9a-f]{2}\/libretro-[0-9a-f]{40}\.png\?v=0$/);
    const path = (library.db.query("SELECT path FROM game_images WHERE game_id = ? AND type = 'box-front'").get(ids.mario!) as { path: string }).path;
    expect(await Bun.file(join(media, path)).bytes()).toEqual(PNG);

    // The Wii game, identified by name: found on Hasheous by its DAT entry's
    // hash, with no Wikipedia article, so the AI description is the fallback.
    expect(game(ids.wii!)).toMatchObject({ release_date: "2009", publisher: "Nintendo", description: "An AI wrote this about the Wii game." });
    expect(JSON.parse(game(ids.wii!).field_sources).description).toBe("hasheous-ai");
    expect(images(ids.wii!)).toEqual([{ type: "box-front", provider: "libretro", region: "USA", downloaded: 1 }]);

    // libretro's character replacements; an unknown game stays as it was.
    expect(images(ids.kirby!)).toEqual([{ type: "box-front", provider: "libretro", region: "USA", downloaded: 1 }]);
    // Kirby has no Hasheous mapping, so Wikipedia was searched: the series
    // and a similar title were passed over for the exact title.
    expect(game(ids.kirby!)).toMatchObject({
      description: "Kirby: Dream? is a 1995 platform game.", description_url: "https://en.wikipedia.org/wiki/Kirby_Dream",
    });
    expect(game(ids.homebrew!)).toMatchObject({ description: null, developer: null, scraped_at: expect.any(String) });
    // Without a key, IGDB isn't asked.
    expect(requests.some((r) => r.includes("MetadataProxy/IGDB/Game"))).toBe(false);

    // The details view's data.
    expect(library.gameDetails(ids.mario!)).toMatchObject({
      platform: "SNES", title: "Super Mario World", developer: "Nintendo EAD", release_date: "1990-11",
      genres: ["Action", "Platform"], description_source: "wikipedia",
      description_url: "https://en.wikipedia.org/wiki/Super_Mario_World",
      files: [
        { name: "smw-eu.sfc", region: "Europe", tags: [], match_method: "hash" },
        { name: "smw.sfc", region: "USA", tags: [], match_method: "hash" },
      ],
    });
    expect(library.gameDetails(ids.mario!)!.images.map((image) => [image.type, image.provider])).toEqual([
      ["box-front", "libretro"], ["logo", "hasheous"], ["screenshot", "libretro"], ["title-screen", "libretro"],
    ]);
    expect(library.gameDetails(999_999)).toBeNull();
  });

  test("runs again only providers that haven't seen a game, unless full", async () => {
    await run();
    requests.length = 0;
    expect((await run()).providers).toEqual({
      libretro: { found: 0, notFound: 0, errors: 0 },
      hasheous: { found: 0, notFound: 0, errors: 0 },
      wikipedia: { found: 0, notFound: 0, errors: 0 },
    });
    expect(requests).toEqual([]);
    // A provider added later runs on its own, from the links stored earlier.
    library.db.run("DELETE FROM game_scrapes WHERE provider = 'wikipedia'");
    library.db.run("UPDATE games SET description = NULL, description_url = NULL WHERE id = ?", [ids.mario!]);
    expect((await run({ providers: ["wikipedia"] })).providers).toEqual({ wikipedia: { found: 2, notFound: 2, errors: 0 } });
    expect(game(ids.mario!).description).toBe("Super Mario World is a 1990 platform game.");
    expect(requests.filter((r) => r.includes("Lookup"))).toEqual([]);
    // full runs everything again, without duplicating images.
    expect((await run({ full: true })).providers.libretro).toEqual({ found: 3, notFound: 1, errors: 0 });
    expect(images(ids.mario!)).toHaveLength(4);
  });

  test("never replaces what the user edited", async () => {
    library.db.run(`UPDATE games SET developer = 'My Developer', field_sources = '{"developer":"user"}' WHERE id = ?`, [ids.mario!]);
    await run();
    expect(game(ids.mario!)).toMatchObject({ developer: "My Developer", publisher: "Nintendo" });
    expect(JSON.parse(game(ids.mario!).field_sources).developer).toBe("user");
  });

  test("a better source replaces a worse one, never the reverse", async () => {
    await run({ providers: ["hasheous"] });
    expect(game(ids.mario!)).toMatchObject({ publisher: "Nintendo (Hasheous)", description: "An AI wrote this about Mario." });
    await run({ providers: ["libretro", "wikipedia"] });
    expect(game(ids.mario!)).toMatchObject({ publisher: "Nintendo", description: "Super Mario World is a 1990 platform game." });
    await run({ providers: ["hasheous"], full: true });
    expect(game(ids.mario!)).toMatchObject({ publisher: "Nintendo", description: "Super Mario World is a 1990 platform game." });
  });

  test("with a Hasheous key, IGDB fills what libretro and Wikipedia don't have", async () => {
    await run({ settings: {
      hasheousClientKey: KEY,
      urls: { libretro: `${server.url.href}libretro/`, hasheous: `${server.url.href}hasheous/`, wikipedia: `${server.url.href}wiki/` },
    } });
    // The Wii game has no libretro details or Wikipedia article: IGDB's win over Hasheous's.
    expect(game(ids.wii!)).toMatchObject({
      developer: "Nintendo EAD", publisher: "Nintendo", release_date: "2009-11-06",
      description: "IGDB's summary.", description_url: "https://www.igdb.com/games/wii-game",
    });
    expect(genres(ids.wii!)).toEqual(["Adventure", "Platform"]);
    expect(images(ids.wii!)).toEqual([
      { type: "box-front", provider: "hasheous", region: null, downloaded: 1 },
      { type: "screenshot", provider: "hasheous", region: null, downloaded: 1 },
      { type: "box-front", provider: "libretro", region: "USA", downloaded: 1 },
    ]);
    // Mario keeps libretro's details and Wikipedia's description.
    expect(game(ids.mario!)).toMatchObject({ developer: "Nintendo EAD", release_date: "1990-11", description: "Super Mario World is a 1990 platform game." });
  });

  test("rate limits are waited out", async () => {
    rateLimitsLeft = 2;
    const summary = await run({ providers: ["hasheous"], gameIds: [ids.mario!] });
    expect(summary.providers.hasheous).toEqual({ found: 1, notFound: 0, errors: 0 });
    expect(requests.filter((r) => r.includes("Lookup"))).toHaveLength(3);
  });

  test("stops between games when cancelled", async () => {
    const stop = new AbortController();
    const summary = await run({ concurrency: 1, signal: stop.signal, onProgress: () => stop.abort() });
    expect(summary).toMatchObject({ games: 1, cancelled: true });
  });
});

afterAll(() => rm(media, { recursive: true, force: true }));
