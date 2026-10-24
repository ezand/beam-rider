import { Database } from "bun:sqlite";
import { MAX_PAGE_SIZE, type GameListItem, type Platform } from "../library/api";
import { artUrl } from "./art";
import { PLATFORMS } from "./scanner/platforms";
import { migrate } from "./schema";

/**
 * Read access to the library database, with the queries the wheel needs.
 * Every game in the library is one of the user's (the scanner adds them), so
 * the wheel lists a platform's visible games in `sort_key, id` order through
 * the `games_wheel` index, which costs the same at any list size.
 */
export type Library = ReturnType<typeof openLibrary>;

/** The artwork type a card shows. */
export const CARD_ART_TYPE = "box-front";

/** Whose box art a card shows when a game has several, best first. */
export const DEFAULT_ART_REGIONS = ["North America", "USA", "World", "Europe", "United Kingdom", "Japan"];

export type LibraryOptions = { artRegions?: string[] };

/** Opens (creating and migrating if needed) the library at `path`. */
export function openLibrary(path: string, { artRegions = DEFAULT_ART_REGIONS }: LibraryOptions = {}) {
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  // WAL lets the scanner write on its own connection while the server reads.
  if (path !== ":memory:") {
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
  }
  migrate(db);
  syncPlatforms(db);

  // Platforms with games, and how many. A custom name replaces the code's.
  const platformsQuery = db.query<Platform, []>(`
    SELECT p.id, coalesce(nullif(trim(p.custom_name), ''), p.name) AS name, p.maker AS manufacturer,
      p.year AS release_year, p.color, COUNT(g.id) AS game_count
    FROM platforms p JOIN games g ON g.platform_id = p.id AND g.hide = 0
    GROUP BY p.id
    ORDER BY coalesce(nullif(p.sort_title, ''), nullif(trim(p.custom_name), ''), p.name) COLLATE NOCASE, p.id`);

  // The page is picked first, so art is looked up for its rows only and not
  // for the ones OFFSET skips. A game's card art is its best downloaded front
  // box, by region. `art` is its path and CRC (the URL's version), separated
  // by a tab.
  type PageRow = Omit<GameListItem, "art"> & { art: string | null };
  const pageQuery = db.query<PageRow, { platform: number; limit: number; offset: number; regions: string }>(`
    SELECT p.id, p.title, p.release_year, (
      SELECT i.path || char(9) || coalesce(i.crc32, 0) FROM game_images i
      WHERE i.game_id = p.id AND i.type = '${CARD_ART_TYPE}' AND i.path IS NOT NULL
      ORDER BY coalesce((SELECT key FROM json_each($regions) WHERE value = i.region), 1000), i.id
      LIMIT 1
    ) AS art
    FROM (
      SELECT id, title, release_year, sort_key FROM games
      WHERE platform_id = $platform AND hide = 0
      ORDER BY sort_key, id
      LIMIT $limit OFFSET $offset
    ) p
    ORDER BY p.sort_key, p.id`);
  const regions = JSON.stringify(artRegions);

  // Letter jumps. Range counts walk the index row by row, so they are the
  // costly part (about 3 ms per 100,000 rows); the other lookups are b-tree
  // probes. A jump makes at most one count.
  type Key = { sort_key: string };
  type Bounds = { platform: number; key: string };
  const keyOfQuery = db.query<Key, { platform: number; id: number }>(`
    SELECT sort_key FROM games WHERE id = $id AND platform_id = $platform AND hide = 0`);
  const countBelowQuery = db.query<{ n: number }, Bounds>(`
    SELECT COUNT(*) AS n FROM games
    WHERE platform_id = $platform AND hide = 0 AND sort_key < $key`);
  const firstFromQuery = db.query<Key, Bounds>(`
    SELECT sort_key FROM games
    WHERE platform_id = $platform AND hide = 0 AND sort_key >= $key
    ORDER BY sort_key LIMIT 1`);
  const lastBelowQuery = db.query<Key, Bounds>(`
    SELECT sort_key FROM games
    WHERE platform_id = $platform AND hide = 0 AND sort_key < $key
    ORDER BY sort_key DESC LIMIT 1`);
  const lastQuery = db.query<Key, { platform: number }>(`
    SELECT sort_key FROM games WHERE platform_id = $platform AND hide = 0
    ORDER BY sort_key DESC LIMIT 1`);

  const countBelow = (platform: number, key: string) => countBelowQuery.get({ platform, key })!.n;

  return {
    db,

    platforms: () => platformsQuery.all(),

    gamesPage(platform: number, offset: number, limit: number): GameListItem[] {
      const rows = pageQuery.all({
        platform,
        offset: Math.max(0, Math.floor(offset)),
        limit: Math.min(Math.max(0, Math.floor(limit)), MAX_PAGE_SIZE),
        regions,
      });
      return rows.map((row) => {
        if (row.art === null) return row;
        const [path, version] = row.art.split("\t");
        return { ...row, art: artUrl(path!, Number(version)) };
      });
    },

    /**
     * Where PageDown (+1) or PageUp (-1) goes from game `id`: the index of the
     * first game of the next or previous initial letter, wrapping around, as
     * in the Godot frontend. Null if there is nowhere to go (every game has
     * the same initial) or `id` isn't a visible game of the platform.
     */
    letterJump(platform: number, id: number, direction: 1 | -1): number | null {
      const key = keyOfQuery.get({ platform, id })?.sort_key;
      if (key === undefined) return null;
      const letter = initial(key);
      if (direction > 0) {
        const after = nextKey(letter);
        if (firstFromQuery.get({ platform, key: after })) return countBelow(platform, after);
        // The last letter: wrap to the start.
        if (!lastBelowQuery.get({ platform, key: letter })) return null;
        return 0;
      }
      const previous = lastBelowQuery.get({ platform, key: letter }) ?? lastQuery.get({ platform });
      const target = initial(previous!.sort_key);
      if (target === letter) return null;
      return countBelow(platform, target);
    },

    close: () => db.close(),
  };
}

/**
 * Brings the platform rows in line with PLATFORMS: adds new platforms and
 * updates names, makers and years. The user's own settings (custom name,
 * color, sort title) are kept, and platforms that left the code keep their
 * games.
 */
function syncPlatforms(db: Database) {
  const upsert = db.query(`
    INSERT INTO platforms (slug, name, maker, year) VALUES (?, ?, ?, ?)
    ON CONFLICT (slug) DO UPDATE SET name = excluded.name, maker = excluded.maker, year = excluded.year`);
  db.transaction(() => {
    for (const platform of PLATFORMS) upsert.run(platform.slug, platform.name, platform.maker, platform.year);
  })();
}

/** A sort key's first character (code point), or "" for an empty key. */
export function initial(key: string): string {
  const point = key.codePointAt(0);
  return point === undefined ? "" : String.fromCodePoint(point);
}

/**
 * The smallest key after every key starting with `letter`. SQLite compares
 * text as UTF-8 bytes, which orders the same as code points. For the empty
 * key, it's the smallest non-empty string.
 */
function nextKey(letter: string): string {
  if (letter === "") return "\u0000";
  return String.fromCodePoint(letter.codePointAt(0)! + 1);
}
