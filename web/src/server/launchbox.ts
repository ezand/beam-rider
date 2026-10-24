import type { Database } from "bun:sqlite";
import { SaxesParser } from "saxes";

/**
 * Imports the LaunchBox Games Database (Metadata.xml from
 * https://gamesdb.launchbox-app.com/Metadata.zip) into the library.
 *
 * The file is one <LaunchBox> element holding flat records (<Game>,
 * <Platform>, <GameImage>, ...) whose children are plain text fields. Games
 * come first and name their platform; alternate names and images come after
 * and point at a game by its DatabaseID.
 *
 * Imports are upserts, so they can be run again on a newer file: LaunchBox's
 * fields are updated, while the user's own (favorites, play stats, sort
 * titles, card colors) and the download state of unchanged images are kept.
 */

export const LAUNCHBOX_SOURCE = "launchbox";
export const LAUNCHBOX_IMAGE_URL = "https://images.launchbox-app.com/";

export type LaunchBoxRecord = { kind: string; fields: Record<string, string> };

/** Streams the records of a LaunchBox XML file to `onRecord`. */
export async function readLaunchBoxXml(
  stream: ReadableStream<Uint8Array>,
  onRecord: (record: LaunchBoxRecord) => void,
): Promise<void> {
  const parser = new SaxesParser();
  let depth = 0;
  let record: LaunchBoxRecord | null = null;
  let field: string | null = null;
  let text = "";
  let failure: Error | null = null;

  parser.on("error", (error) => {
    failure ??= error;
  });
  parser.on("opentag", (tag) => {
    depth++;
    if (depth === 2) record = { kind: tag.name, fields: {} };
    else if (depth === 3) {
      field = tag.name;
      text = "";
    }
  });
  parser.on("text", (chunk) => {
    if (field !== null) text += chunk;
  });
  parser.on("closetag", () => {
    if (depth === 3 && record && field !== null) {
      record.fields[field] = text;
      field = null;
    } else if (depth === 2 && record) {
      onRecord(record);
      record = null;
    }
    depth--;
  });

  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    parser.write(decoder.decode(chunk, { stream: true }));
    if (failure) throw failure;
  }
  parser.write(decoder.decode());
  parser.close();
  if (failure) throw failure;
}

export type ImportSummary = {
  platforms: number;
  games: number;
  genres: number;
  alternateNames: number;
  images: number;
  removedImages: number;
  /** Records pointing at a game the file doesn't have. */
  orphans: number;
  /** Record kinds the importer doesn't use, such as emulators. */
  skipped: Record<string, number>;
};

/** Text, or null for an empty or missing field. */
function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function integer(value: string | undefined): number | null {
  const number = Number(text(value) ?? NaN);
  return Number.isInteger(number) ? number : null;
}

function real(value: string | undefined): number | null {
  const number = Number(text(value) ?? NaN);
  return Number.isFinite(number) ? number : null;
}

const flag = (value: string | undefined) => (text(value)?.toLowerCase() === "true" ? 1 : 0);

/** "1993-10-04T00:00:00+00:00" -> "1993-10-04". */
const date = (value: string | undefined) => text(value)?.slice(0, 10) ?? null;

/**
 * Starts an import into `db`. Feed it every record with `add`, then call
 * `finish`. The caller owns the transaction.
 */
export function createLaunchBoxImport(db: Database) {
  const now = new Date().toISOString();

  const upsertPlatformName = db.query<{ id: number }, [string, string]>(`
    INSERT INTO platforms (name, date_added) VALUES (?, ?)
    ON CONFLICT (name) DO UPDATE SET name = excluded.name
    RETURNING id`);
  const updatePlatform = db.query(`
    UPDATE platforms SET
      release_date = $release_date, developer = $developer, manufacturer = $manufacturer,
      cpu = $cpu, memory = $memory, graphics = $graphics, sound = $sound, display = $display,
      media = $media, max_controllers = $max_controllers, notes = $notes, emulated = $emulated
    WHERE id = $id`);
  const upsertCategory = db.query<{ id: number }, [string]>(`
    INSERT INTO platform_categories (name) VALUES (?)
    ON CONFLICT (name) DO UPDATE SET name = excluded.name
    RETURNING id`);
  const linkCategory = db.query(`
    INSERT OR IGNORE INTO platform_category_platforms (category_id, platform_id) VALUES (?, ?)`);
  const clearPlatformAlternateNames = db.query(`DELETE FROM platform_alternate_names WHERE platform_id = ?`);
  const insertPlatformAlternateName = db.query(`
    INSERT OR IGNORE INTO platform_alternate_names (platform_id, name) VALUES (?, ?)`);

  const upsertGame = db.query<{ id: number }, Record<string, string | number | null>>(`
    INSERT INTO games (
      platform_id, title, release_date, notes, max_players, release_type, cooperative,
      launchbox_db_id, community_star_rating, community_rating_count, rating,
      developer, publisher, video_url, wikipedia_url, steam_app_id, date_added
    ) VALUES (
      $platform_id, $title, $release_date, $notes, $max_players, $release_type, $cooperative,
      $launchbox_db_id, $community_star_rating, $community_rating_count, $rating,
      $developer, $publisher, $video_url, $wikipedia_url, $steam_app_id, $date_added
    )
    ON CONFLICT (launchbox_db_id) DO UPDATE SET
      platform_id = excluded.platform_id, title = excluded.title,
      release_date = excluded.release_date, notes = excluded.notes,
      max_players = excluded.max_players, release_type = excluded.release_type,
      cooperative = excluded.cooperative, community_star_rating = excluded.community_star_rating,
      community_rating_count = excluded.community_rating_count, rating = excluded.rating,
      developer = excluded.developer, publisher = excluded.publisher,
      video_url = excluded.video_url, wikipedia_url = excluded.wikipedia_url,
      steam_app_id = excluded.steam_app_id
    RETURNING id`);
  const upsertGenre = db.query<{ id: number }, [string]>(`
    INSERT INTO genres (name) VALUES (?)
    ON CONFLICT (name) DO UPDATE SET name = excluded.name
    RETURNING id`);
  const clearGameGenres = db.query(`DELETE FROM game_genres WHERE game_id = ?`);
  const insertGameGenre = db.query(`INSERT OR IGNORE INTO game_genres (game_id, genre_id) VALUES (?, ?)`);
  const clearGameAlternateNames = db.query(`DELETE FROM game_alternate_names WHERE game_id = ?`);
  const insertGameAlternateName = db.query(`
    INSERT OR IGNORE INTO game_alternate_names (game_id, name, region) VALUES (?, ?, ?)`);

  // A changed CRC means a new file, so its download state is reset.
  const upsertImage = db.query(`
    INSERT INTO game_images (game_id, type, region, source, source_name, crc32)
    VALUES ($game_id, $type, $region, '${LAUNCHBOX_SOURCE}', $source_name, $crc32)
    ON CONFLICT (source, source_name) DO UPDATE SET
      game_id = excluded.game_id, type = excluded.type, region = excluded.region,
      crc32 = excluded.crc32,
      path = CASE WHEN crc32 IS excluded.crc32 THEN path END,
      bytes = CASE WHEN crc32 IS excluded.crc32 THEN bytes END,
      downloaded_at = CASE WHEN crc32 IS excluded.crc32 THEN downloaded_at END,
      error = CASE WHEN crc32 IS excluded.crc32 THEN error END`);

  // Images that have dropped out of the file are removed at the end. Only
  // needed if there were any to begin with.
  const hadImages = db.query(`SELECT 1 FROM game_images WHERE source = '${LAUNCHBOX_SOURCE}' LIMIT 1`).get() !== null;
  if (hadImages) {
    db.run("CREATE TEMP TABLE IF NOT EXISTS seen_images (source_name TEXT PRIMARY KEY) WITHOUT ROWID");
    db.run("DELETE FROM temp.seen_images");
  }
  const markSeen = hadImages ? db.query(`INSERT OR IGNORE INTO temp.seen_images VALUES (?)`) : null;

  const platformIds = new Map<string, number>();
  const categoryIds = new Map<string, number>();
  const genreIds = new Map<string, number>();
  /** LaunchBox DatabaseID -> games.id. */
  const gameIds = new Map<number, number>();
  const clearedPlatformNames = new Set<number>();
  const clearedGameNames = new Set<number>();
  const summary: ImportSummary = {
    platforms: 0, games: 0, genres: 0, alternateNames: 0, images: 0, removedImages: 0, orphans: 0, skipped: {},
  };

  const platformId = (name: string) => {
    let id = platformIds.get(name);
    if (id === undefined) {
      id = upsertPlatformName.get(name, now)!.id;
      platformIds.set(name, id);
    }
    return id;
  };

  const cached = (cache: Map<string, number>, upsert: typeof upsertGenre, name: string) => {
    let id = cache.get(name);
    if (id === undefined) {
      id = upsert.get(name)!.id;
      cache.set(name, id);
    }
    return id;
  };

  const gameId = (fields: Record<string, string>) => {
    const id = gameIds.get(integer(fields.DatabaseID) ?? -1);
    if (id === undefined) summary.orphans++;
    return id;
  };

  const handlers: Record<string, (fields: Record<string, string>) => void> = {
    Game(f) {
      const title = text(f.Name);
      const launchboxId = integer(f.DatabaseID);
      const platform = text(f.Platform);
      if (!title || launchboxId === null || !platform) return;
      const maxPlayers = integer(f.MaxPlayers);
      const id = upsertGame.get({
        platform_id: platformId(platform),
        title,
        release_date: date(f.ReleaseDate) ?? text(f.ReleaseYear),
        notes: text(f.Overview),
        max_players: maxPlayers !== null && maxPlayers > 0 ? maxPlayers : null,
        release_type: text(f.ReleaseType),
        cooperative: flag(f.Cooperative),
        launchbox_db_id: launchboxId,
        community_star_rating: real(f.CommunityRating),
        community_rating_count: integer(f.CommunityRatingCount) ?? 0,
        rating: text(f.ESRB),
        developer: text(f.Developer),
        publisher: text(f.Publisher),
        video_url: text(f.VideoURL),
        wikipedia_url: text(f.WikipediaURL),
        steam_app_id: integer(f.SteamAppId),
        date_added: now,
      })!.id;
      gameIds.set(launchboxId, id);
      clearGameGenres.run(id);
      const genres = new Set((f.Genres ?? "").split(";").map((g) => g.trim()).filter(Boolean));
      for (const genre of genres) insertGameGenre.run(id, cached(genreIds, upsertGenre, genre));
      summary.games++;
    },

    Platform(f) {
      const name = text(f.Name);
      if (!name) return;
      const id = platformId(name);
      updatePlatform.run({
        id,
        release_date: date(f.ReleaseDate),
        developer: text(f.Developer),
        manufacturer: text(f.Manufacturer),
        cpu: text(f.Cpu),
        memory: text(f.Memory),
        graphics: text(f.Graphics),
        sound: text(f.Sound),
        display: text(f.Display),
        media: text(f.Media),
        max_controllers: text(f.MaxControllers),
        notes: text(f.Notes),
        emulated: flag(f.Emulated),
      });
      const category = text(f.Category);
      if (category) linkCategory.run(cached(categoryIds, upsertCategory, category), id);
      summary.platforms++;
    },

    PlatformAlternateName(f) {
      const name = text(f.Name);
      const alternate = text(f.Alternate);
      if (!name || !alternate) return;
      const id = platformId(name);
      if (!clearedPlatformNames.has(id)) {
        clearPlatformAlternateNames.run(id);
        clearedPlatformNames.add(id);
      }
      insertPlatformAlternateName.run(id, alternate);
    },

    GameAlternateName(f) {
      const name = text(f.AlternateName);
      const id = gameId(f);
      if (!name || id === undefined) return;
      if (!clearedGameNames.has(id)) {
        clearGameAlternateNames.run(id);
        clearedGameNames.add(id);
      }
      insertGameAlternateName.run(id, name, text(f.Region) ?? "");
      summary.alternateNames++;
    },

    GameImage(f) {
      const sourceName = text(f.FileName);
      const type = text(f.Type);
      const id = gameId(f);
      if (!sourceName || !type || id === undefined) return;
      upsertImage.run({
        game_id: id,
        type,
        region: text(f.Region),
        source_name: sourceName,
        crc32: integer(f.CRC32),
      });
      markSeen?.run(sourceName);
      summary.images++;
    },
  };

  return {
    add(record: LaunchBoxRecord) {
      const handler = handlers[record.kind];
      if (handler) handler(record.fields);
      else summary.skipped[record.kind] = (summary.skipped[record.kind] ?? 0) + 1;
    },

    finish(): ImportSummary {
      if (hadImages) {
        summary.removedImages = db.run(`
          DELETE FROM game_images WHERE source = '${LAUNCHBOX_SOURCE}'
            AND source_name NOT IN (SELECT source_name FROM temp.seen_images)`).changes;
        db.run("DROP TABLE temp.seen_images");
      }
      summary.genres = genreIds.size;
      return summary;
    },
  };
}

/** Imports a whole LaunchBox XML stream into `db` in one transaction. */
export async function importLaunchBox(
  db: Database,
  stream: ReadableStream<Uint8Array>,
  onProgress?: (records: number) => void,
): Promise<ImportSummary> {
  db.run("BEGIN IMMEDIATE");
  try {
    const run = createLaunchBoxImport(db);
    let records = 0;
    await readLaunchBoxXml(stream, (record) => {
      run.add(record);
      if (++records % 50_000 === 0) onProgress?.(records);
    });
    const summary = run.finish();
    db.run("COMMIT");
    return summary;
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}
