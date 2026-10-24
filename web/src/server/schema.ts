import type { Database } from "bun:sqlite";

/**
 * The library schema, modelled on LaunchBox: platforms in a tree of platform
 * categories, games that each belong to one platform, alternate names,
 * genres, images, additional applications (discs, alternate versions) and
 * playlists.
 *
 * Each entry in MIGRATIONS moves the database up one version. The current
 * version is `PRAGMA user_version`. Never edit a migration that has shipped;
 * add a new one.
 */

/** A game's title lowercased and trimmed, for sorting. */
const TITLE = "lower(trim(title))";

/**
 * The key games sort and letter-jump by. An explicit sort title wins, as in
 * LaunchBox. Otherwise a leading article is dropped, so "The Legend of Zelda"
 * sorts under L, matching make_sort_name() in the Godot frontend.
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
    // LaunchBox's "Parents" tree, such as Consoles > Nintendo.
    `CREATE TABLE platform_categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER REFERENCES platform_categories(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    )`,
    `CREATE INDEX platform_categories_by_parent ON platform_categories(parent_id, sort_order)`,

    // `scrape_as` is the platform name scrapers know it by. `color` is the
    // card color in BeamRider; null shows the default. The hardware fields
    // are free text, as in LaunchBox ("1 (up to 8 if daisy-chained)").
    `CREATE TABLE platforms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_title TEXT,
      manufacturer TEXT,
      developer TEXT,
      release_date TEXT,
      release_year INTEGER GENERATED ALWAYS AS (CAST(substr(release_date, 1, 4) AS INTEGER)) VIRTUAL,
      notes TEXT,
      cpu TEXT,
      memory TEXT,
      graphics TEXT,
      sound TEXT,
      display TEXT,
      media TEXT,
      max_controllers TEXT,
      ${flag("emulated")},
      scrape_as TEXT,
      color TEXT,
      date_added TEXT,
      date_modified TEXT
    )`,
    `CREATE TABLE platform_alternate_names (
      platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      PRIMARY KEY (platform_id, name)
    ) WITHOUT ROWID`,

    // A platform can sit in several categories, as in LaunchBox.
    `CREATE TABLE platform_category_platforms (
      category_id INTEGER NOT NULL REFERENCES platform_categories(id) ON DELETE CASCADE,
      platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (category_id, platform_id)
    )`,
    `CREATE INDEX platform_category_platforms_by_platform ON platform_category_platforms(platform_id)`,

    // Dates are ISO 8601 text; release dates may be just a year or year-month.
    `CREATE TABLE games (
      id INTEGER PRIMARY KEY,
      platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_title TEXT,
      sort_key TEXT GENERATED ALWAYS AS (${SORT_KEY}) STORED,
      application_path TEXT,
      command_line TEXT,
      developer TEXT,
      publisher TEXT,
      series TEXT,
      release_date TEXT,
      release_year INTEGER GENERATED ALWAYS AS (CAST(substr(release_date, 1, 4) AS INTEGER)) VIRTUAL,
      region TEXT,
      version TEXT,
      play_mode TEXT,
      max_players INTEGER,
      rating TEXT,
      community_star_rating REAL,
      community_rating_count INTEGER NOT NULL DEFAULT 0,
      star_rating INTEGER,
      ${flag("cooperative")},
      notes TEXT,
      video_url TEXT,
      wikipedia_url TEXT,
      source TEXT,
      status TEXT,
      release_type TEXT,
      launchbox_db_id INTEGER,
      steam_app_id INTEGER,
      ${flag("favorite")},
      ${flag("completed")},
      ${flag("broken")},
      ${flag("hide")},
      play_count INTEGER NOT NULL DEFAULT 0,
      play_time_seconds INTEGER NOT NULL DEFAULT 0,
      last_played_at TEXT,
      date_added TEXT,
      date_modified TEXT
    )`,
    // The wheel's index: a platform's visible games in sort order. The rowid
    // is its implicit last column, so ORDER BY sort_key, id needs no sort, and
    // OFFSET and range counts read only the index. It also serves the
    // foreign key lookups on platform_id.
    `CREATE INDEX games_wheel ON games(platform_id, hide, sort_key)`,
    // Imports match games to the LaunchBox Games Database by its id.
    `CREATE UNIQUE INDEX games_by_launchbox_id ON games(launchbox_db_id)`,

    `CREATE TABLE game_alternate_names (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (game_id, name, region)
    ) WITHOUT ROWID`,

    // Every known image of a game, downloaded or not. `source_name` is the
    // name the source knows it by (for LaunchBox, a GUID file name on its
    // image host). `path` is set, relative to the media folder, once the file
    // is downloaded and checked against `crc32`.
    `CREATE TABLE game_images (
      id INTEGER PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      region TEXT,
      source TEXT NOT NULL,
      source_name TEXT NOT NULL,
      crc32 INTEGER,
      path TEXT,
      bytes INTEGER,
      downloaded_at TEXT,
      error TEXT,
      UNIQUE (source, source_name)
    )`,
    `CREATE INDEX game_images_by_game ON game_images(game_id, type)`,
    `CREATE INDEX game_images_by_type ON game_images(type, game_id)`,

    // LaunchBox keeps genres as a ;-separated list. Normalized, so a genre
    // view can list and count them with an index.
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

    // Extra discs, alternate versions and helper programs for a game.
    `CREATE TABLE additional_applications (
      id INTEGER PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      application_path TEXT,
      command_line TEXT,
      region TEXT,
      version TEXT,
      disc INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX additional_applications_by_game ON additional_applications(game_id, sort_order)`,

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
