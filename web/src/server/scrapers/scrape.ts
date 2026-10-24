import type { Database } from "bun:sqlite";
import { PLATFORMS } from "../scanner/platforms";
import { hasheous } from "./hasheous";
import { createHttp, type Http } from "./http";
import { downloadImage } from "./images";
import { libretro } from "./libretro";
import { merge, type GameState } from "./merge";
import type { GameField, ScrapeFile, ScrapeResult, ScrapeSettings, Scraper, ScrapeTarget } from "./types";
import { GAME_FIELDS } from "./types";
import { wikipedia } from "./wikipedia";

/**
 * Scrapes the library's games: each configured provider looks each game up,
 * what they find is merged into the game (merge.ts), and their images are
 * downloaded. What each provider made of each game is kept in `game_scrapes`,
 * so a rerun only runs providers that haven't seen a game (or failed on it),
 * unless `full`.
 */

/** Every scraper, in the order they're offered. */
export const SCRAPERS: Scraper[] = [libretro, hasheous, wikipedia];

export type ScrapeOptions = {
  dats: Database | null;
  settings: ScrapeSettings;
  /** Provider ids to use, in any order; default all. */
  providers?: string[];
  mediaRoot: string;
  /** Only these games; default all. */
  gameIds?: number[];
  /** Run every provider again, not just those that haven't seen a game. */
  full?: boolean;
  signal?: AbortSignal;
  concurrency?: number;
  http?: Http;
  onProgress?: (progress: ScrapeProgress) => void;
};

export type ScrapeProgress = { done: number; total: number };

export type ScrapeSummary = {
  games: number;
  providers: Record<string, { found: number; notFound: number; errors: number }>;
  images: { found: number; downloaded: number; failed: number };
  cancelled: boolean;
  errors: { gameId: number; provider: string; error: string }[];
};

/** The providers to run, each after the ones it starts from. */
export function scraperOrder(ids: string[] | undefined, settings: ScrapeSettings): Scraper[] {
  const chosen = SCRAPERS.filter((s) => (!ids || ids.includes(s.id)) && s.configured(settings));
  const ordered: Scraper[] = [];
  const visit = (scraper: Scraper) => {
    if (ordered.includes(scraper)) return;
    for (const id of scraper.after ?? []) {
      const before = chosen.find((s) => s.id === id);
      if (before) visit(before);
    }
    ordered.push(scraper);
  };
  chosen.forEach(visit);
  return ordered;
}

export async function scrape(db: Database, options: ScrapeOptions): Promise<ScrapeSummary> {
  const scrapers = scraperOrder(options.providers, options.settings);
  const http = options.http ?? createHttp();
  const now = () => new Date().toISOString();
  const summary: ScrapeSummary = {
    games: 0, providers: {}, images: { found: 0, downloaded: 0, failed: 0 }, cancelled: false, errors: [],
  };
  for (const scraper of scrapers) summary.providers[scraper.id] = { found: 0, notFound: 0, errors: 0 };

  type GameRow = { id: number; title: string; slug: string; field_sources: string | null } & Record<GameField, string | null>;
  const games = db.query<GameRow, []>(`
    SELECT g.id, g.title, p.slug, g.field_sources, ${GAME_FIELDS.map((f) => `g.${f}`).join(", ")}
    FROM games g JOIN platforms p ON p.id = g.platform_id ORDER BY g.id`).all()
    .filter((game) => !options.gameIds || options.gameIds.includes(game.id));
  const filesQuery = db.query<{ path: string; entry: string | null; dat_name: string | null; crc32: number | null;
    md5: string | null; sha1: string | null; data_size: number | null; size: number; region: string | null; match_method: string | null }, [number]>(`
    SELECT path, entry, dat_name, crc32, md5, sha1, data_size, size, region, match_method FROM rom_files WHERE game_id = ?`);
  const scrapesQuery = db.query<{ provider: string; status: string; links: string | null }, [number]>(`
    SELECT provider, status, links FROM game_scrapes WHERE game_id = ?`);
  const recordScrape = db.query(`
    INSERT INTO game_scrapes (game_id, provider, status, external_id, url, links, error, scraped_at)
    VALUES ($game, $provider, $status, $external_id, $url, $links, $error, $at)
    ON CONFLICT (game_id, provider) DO UPDATE SET status = excluded.status, external_id = excluded.external_id,
      url = excluded.url, links = excluded.links, error = excluded.error, scraped_at = excluded.scraped_at`);
  const hasGenres = db.query<{ n: number }, [number]>(`SELECT COUNT(*) AS n FROM game_genres WHERE game_id = ?`);
  const upsertGenre = db.query<{ id: number }, [string]>(`
    INSERT INTO genres (name) VALUES (?) ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`);
  const clearGenres = db.query(`DELETE FROM game_genres WHERE game_id = ?`);
  const addGenre = db.query(`INSERT OR IGNORE INTO game_genres (game_id, genre_id) VALUES (?, ?)`);
  const addImage = db.query(`
    INSERT OR IGNORE INTO game_images (game_id, type, region, provider, url) VALUES (?, ?, ?, ?, ?)`);
  const pendingImages = db.query<{ id: number; provider: string; url: string }, [number]>(`
    SELECT id, provider, url FROM game_images WHERE game_id = ? AND path IS NULL AND error IS NULL AND url IS NOT NULL`);
  const imageDone = db.query(`UPDATE game_images SET path = ?, bytes = ?, downloaded_at = ?, error = NULL WHERE id = ?`);
  const imageFailed = db.query(`UPDATE game_images SET error = ? WHERE id = ?`);

  async function scrapeGame(game: GameRow) {
    const platform = PLATFORMS.find((p) => p.slug === game.slug);
    if (!platform) return;
    const files: ScrapeFile[] = filesQuery.all(game.id).map((f) => ({
      fileName: f.entry ?? f.path,
      datName: f.dat_name,
      crc32: f.crc32,
      md5: f.md5,
      sha1: f.sha1,
      size: f.data_size ?? f.size,
      region: f.region,
      matchMethod: f.match_method,
    }));
    const target: ScrapeTarget = { gameId: game.id, title: game.title, platform, files };
    const done = new Map(scrapesQuery.all(game.id).map((row) => [row.provider, row]));
    const links: Record<string, string> = {};
    for (const row of done.values()) Object.assign(links, row.links ? JSON.parse(row.links) : {});

    const results: { provider: string; result: ScrapeResult }[] = [];
    let ran = false;
    for (const scraper of scrapers) {
      if (options.signal?.aborted) break;
      const previous = done.get(scraper.id);
      if (!options.full && previous && previous.status !== "error") continue;
      ran = true;
      const counts = summary.providers[scraper.id]!;
      try {
        const result = await scraper.scrape(target, { http, dats: options.dats, settings: options.settings, links });
        if (result) {
          Object.assign(links, result.links ?? {});
          results.push({ provider: scraper.id, result });
          counts.found++;
        } else counts.notFound++;
        recordScrape.run({
          game: game.id, provider: scraper.id, status: result ? "found" : "not-found",
          external_id: result?.externalId ?? null, url: result?.url ?? null,
          links: result?.links && Object.keys(result.links).length ? JSON.stringify(result.links) : null,
          error: null, at: now(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        counts.errors++;
        summary.errors.push({ gameId: game.id, provider: scraper.id, error: message });
        recordScrape.run({
          game: game.id, provider: scraper.id, status: "error", external_id: null, url: null, links: null,
          error: message, at: now(),
        });
      }
    }
    if (!ran) return;

    const state: GameState = {
      values: Object.fromEntries(GAME_FIELDS.map((f) => [f, game[f]])),
      sources: game.field_sources ? JSON.parse(game.field_sources) : {},
      hasGenres: hasGenres.get(game.id)!.n > 0,
    };
    const update = merge(state, results);
    db.transaction(() => {
      const fields = Object.entries(update.fields) as [GameField, string][];
      const sets = [...fields.map(([field]) => `${field} = $${field}`), "field_sources = $field_sources", "scraped_at = $scraped_at"];
      if ("descriptionUrl" in update) sets.push("description_url = $description_url");
      db.query(`UPDATE games SET ${sets.join(", ")} WHERE id = $id`).run({
        ...Object.fromEntries(fields),
        field_sources: JSON.stringify(update.sources),
        scraped_at: now(),
        ...("descriptionUrl" in update ? { description_url: update.descriptionUrl ?? null } : {}),
        id: game.id,
      });
      if (update.genres) {
        clearGenres.run(game.id);
        for (const name of update.genres) addGenre.run(game.id, upsertGenre.get(name)!.id);
      }
      for (const { provider, result } of results) {
        for (const image of result.images ?? []) {
          if (addImage.run(game.id, image.type, image.region ?? null, provider, image.url).changes) summary.images.found++;
        }
      }
    })();

    for (const image of pendingImages.all(game.id)) {
      if (options.signal?.aborted) break;
      try {
        const saved = await downloadImage(http, image.provider, image.url, options.mediaRoot);
        if (saved) {
          imageDone.run(saved.path, saved.bytes, now(), image.id);
          summary.images.downloaded++;
        } else {
          imageFailed.run("not found", image.id);
          summary.images.failed++;
        }
      } catch (error) {
        imageFailed.run(error instanceof Error ? error.message : String(error), image.id);
        summary.images.failed++;
      }
    }
  }

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < games.length && !options.signal?.aborted) {
      const game = games[next++]!;
      try {
        await scrapeGame(game);
      } catch (error) {
        summary.errors.push({ gameId: game.id, provider: "-", error: error instanceof Error ? error.message : String(error) });
      }
      summary.games++;
      done++;
      options.onProgress?.({ done, total: games.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
  summary.cancelled = done < games.length;
  return summary;
}
