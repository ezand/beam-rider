import type { Database } from "bun:sqlite";

/**
 * The library schema. The library holds the user's own games: a game exists
 * because the ROM scanner found files for it. Platforms are BeamRider's own
 * (src/server/scanner/platforms.ts). Metadata and artwork fields are neutral,
 * for scrapers to fill from whichever provider they use.
 *
 * Each entry in MIGRATIONS moves the database up one version. The current
 * version is `PRAGMA user_version`. Never edit a migration that has shipped;
 * add a new one.
 */

/** A game's title lowercased and trimmed, for sorting. */
const TITLE = "lower(trim(title))";

/**
 * The key games sort and letter-jump by. An explicit sort title wins.
 * Otherwise a leading article is dropped, so "The Legend of Zelda" sorts
 * under L, matching make_sort_name() in the Godot frontend.
 */
const SORT_KEY = `CASE
  WHEN nullif(trim(sort_title), '') IS NOT NULL THEN lower(trim(sort_title))
  WHEN substr(${TITLE}, 1, 4) = 'the ' THEN substr(${TITLE}, 5)
  WHEN substr(${TITLE}, 1, 3) = 'an ' THEN substr(${TITLE}, 4)
  WHEN substr(${TITLE}, 1, 2) = 'a ' THEN substr(${TITLE}, 3)
  ELSE ${TITLE}
END`;

const flag = (name: string) => `${name} INTEGER NOT NULL DEFAULT 0 CHECK (${name} IN (0, 1))`;

export const MIGRATIONS: string[][] = [
  [
    // Synced from PLATFORMS at startup, so `slug`, `name`, `maker` and
    // `year` follow the code. The rest is the user's: `custom_name` replaces
    // `name` where shown, and `color` is the card color (null shows the
    // default).
    `CREATE TABLE platforms (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      custom_name TEXT,
      sort_title TEXT,
      maker TEXT,
      year INTEGER,
      color TEXT
    )`,

    // One game per title on a platform: regional versions and revisions are
    // files of the same game. `group_key` (from matchKey) is what files are
    // grouped by. Dates are ISO 8601 text, possibly just a year or year-month.
    `CREATE TABLE games (
      id INTEGER PRIMARY KEY,
      platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      group_key TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_title TEXT,
      sort_key TEXT GENERATED ALWAYS AS (${SORT_KEY}) STORED,
      release_date TEXT,
      release_year INTEGER GENERATED ALWAYS AS (CAST(substr(release_date, 1, 4) AS INTEGER)) VIRTUAL,
      developer TEXT,
      publisher TEXT,
      players TEXT,
      rating TEXT,
      description TEXT,
      ${flag("favorite")},
      ${flag("hide")},
      play_count INTEGER NOT NULL DEFAULT 0,
      play_time_seconds INTEGER NOT NULL DEFAULT 0,
      last_played_at TEXT,
      date_added TEXT NOT NULL,
      UNIQUE (platform_id, group_key)
    )`,
    // The wheel's index: a platform's visible games in sort order. The rowid
    // is its implicit last column, so ORDER BY sort_key, id needs no sort, and
    // OFFSET and range counts read only the index.
    `CREATE INDEX games_wheel ON games(platform_id, hide, sort_key)`,

    // A game file on disk, or a file inside an archive (`entry`). Hashes are
    // of the game data (`data_size` bytes: the file in the archive, or the
    // file after removing a copier header of `header_bytes`).
    // `match_method` says how the file was identified (hash, dat-name), or is
    // null if only its file name was used. `members` lists, as JSON, the files
    // a .cue, .gdi or .m3u brings along.
    `CREATE TABLE rom_files (
      id INTEGER PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      entry TEXT,
      members TEXT,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      data_size INTEGER,
      crc32 INTEGER,
      md5 TEXT,
      sha1 TEXT,
      header_bytes INTEGER NOT NULL DEFAULT 0,
      match_method TEXT,
      dat_name TEXT,
      title TEXT NOT NULL,
      region TEXT,
      tags TEXT,
      scanned_at TEXT NOT NULL
    )`,
    `CREATE INDEX rom_files_by_game ON rom_files(game_id)`,

    // Artwork for a game, from a provider. `type` is neutral: box-front,
    // box-back, box-3d, logo, screenshot, title-screen, fanart, disc, cart,
    // banner. `path` is set, relative to the media folder, once the file is
    // downloaded.
    `CREATE TABLE game_images (
      id INTEGER PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      region TEXT,
      provider TEXT NOT NULL,
      url TEXT,
      crc32 INTEGER,
      path TEXT,
      bytes INTEGER,
      downloaded_at TEXT,
      error TEXT
    )`,
    `CREATE INDEX game_images_by_game ON game_images(game_id, type)`,

    `CREATE TABLE genres (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE game_genres (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
      PRIMARY KEY (game_id, genre_id)
    ) WITHOUT ROWID`,
    `CREATE INDEX game_genres_by_genre ON game_genres(genre_id, game_id)`,

    `CREATE TABLE playlists (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_title TEXT,
      notes TEXT
    )`,
    `CREATE TABLE playlist_games (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (playlist_id, game_id)
    ) WITHOUT ROWID`,
    `CREATE INDEX playlist_games_by_order ON playlist_games(playlist_id, sort_order)`,
    `CREATE INDEX playlist_games_by_game ON playlist_games(game_id)`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Brings the database up to SCHEMA_VERSION. Returns the version it found. */
export function migrate(db: Database): number {
  const { user_version: found } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (found > SCHEMA_VERSION) {
    throw new Error(`Library database is version ${found}, newer than this app's ${SCHEMA_VERSION}`);
  }
  db.transaction(() => {
    for (const statements of MIGRATIONS.slice(found)) {
      for (const sql of statements) db.run(sql);
    }
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
  return found;
}
