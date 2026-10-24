import type { Database } from "bun:sqlite";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LAUNCHBOX_IMAGE_URL, LAUNCHBOX_SOURCE } from "./launchbox";

/**
 * Downloads game images recorded in `game_images` to the media folder. Files
 * keep their LaunchBox name, in folders by its first two characters so no
 * folder gets huge (`41/41ba4239-....jpg`), and are checked against their
 * CRC32 before the row gets its `path`. Rows that already have one are
 * skipped, so a run can be stopped and started again.
 */

export type ImageSelection = {
  /** Image types to download for every game. */
  types: string[];
  /** Also download every image of this many games, most rated first. */
  topGames: number;
  /** Retry images whose last download failed. */
  retryFailed: boolean;
  /** Stop after this many images. */
  limit?: number;
};

export type PendingImage = { id: number; type: string; source_name: string; crc32: number | null };

/** Rough average size of each type, from a sample of the LaunchBox host. */
const TYPE_BYTES: Record<string, number> = {
  "Box - Front": 1067e3,
  "Box - Front - Reconstructed": 1067e3,
  "Box - Back": 1501e3,
  "Box - 3D": 1248e3,
  "Clear Logo": 206e3,
  "Screenshot - Gameplay": 221e3,
  "Screenshot - Game Title": 134e3,
  "Fanart - Background": 528e3,
  Disc: 812e3,
  "Cart - Front": 401e3,
  Banner: 407e3,
};
const DEFAULT_BYTES = 500e3;

export const estimateBytes = (images: PendingImage[]) =>
  images.reduce((total, image) => total + (TYPE_BYTES[image.type] ?? DEFAULT_BYTES), 0);

/** The images still to download for a selection, top games first. */
export function pendingImages(db: Database, selection: ImageSelection): PendingImage[] {
  const types = JSON.stringify(selection.types);
  return db
    .query<PendingImage, { types: string; top: number; retry: number; limit: number }>(`
      WITH top_games AS (
        SELECT id, row_number() OVER (ORDER BY community_rating_count DESC, id) AS rank
        FROM games ORDER BY community_rating_count DESC, id LIMIT $top
      )
      SELECT i.id, i.type, i.source_name, i.crc32
      FROM game_images i
      LEFT JOIN top_games t ON t.id = i.game_id
      WHERE i.source = '${LAUNCHBOX_SOURCE}' AND i.path IS NULL
        AND ($retry OR i.error IS NULL)
        AND (t.id IS NOT NULL OR i.type IN (SELECT value FROM json_each($types)))
      ORDER BY t.rank IS NULL, t.rank, i.id
      LIMIT $limit`)
    .all({
      types,
      top: selection.topGames,
      retry: selection.retryFailed ? 1 : 0,
      limit: selection.limit ?? -1,
    });
}

/** Where an image goes, relative to the media folder. */
export const mediaFile = (sourceName: string) => `${sourceName.slice(0, 2).toLowerCase()}/${sourceName}`;

export type DownloadOptions = {
  mediaRoot: string;
  baseUrl?: string;
  concurrency?: number;
  /** Attempts per image for errors worth retrying (rate limits, server errors). */
  attempts?: number;
  /** Base delay between retries, doubled each time. */
  retryDelayMs?: number;
  userAgent?: string;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
};

export type DownloadProgress = { done: number; failed: number; total: number; bytes: number };

class Retryable extends Error {
  constructor(message: string, readonly waitMs?: number) {
    super(message);
  }
}

/**
 * Downloads `images`, `concurrency` at a time, recording each result in the
 * database. A rate limit pauses every worker. Returns when all are done, or
 * when `signal` aborts (in-flight downloads finish first).
 */
export async function downloadImages(
  db: Database,
  images: PendingImage[],
  options: DownloadOptions,
): Promise<DownloadProgress> {
  const {
    mediaRoot,
    baseUrl = LAUNCHBOX_IMAGE_URL,
    concurrency = 8,
    attempts = 5,
    retryDelayMs = 2000,
    userAgent = "BeamRider (library import)",
    signal,
    onProgress,
  } = options;

  const saved = db.query(`
    UPDATE game_images SET path = ?, bytes = ?, downloaded_at = ?, error = NULL WHERE id = ?`);
  const failed = db.query(`UPDATE game_images SET error = ? WHERE id = ?`);

  const progress: DownloadProgress = { done: 0, failed: 0, total: images.length, bytes: 0 };
  let next = 0;
  let pausedUntil = 0;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchImage(image: PendingImage): Promise<Uint8Array> {
    const response = await fetch(baseUrl + encodeURIComponent(image.source_name), {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new Retryable(`HTTP ${response.status}`, Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.bytes();
  }

  async function download(image: PendingImage) {
    // LaunchBox's CRC32 is stale for some images (the served file differs
    // from the one it was computed on). A mismatch is downloaded again: the
    // same bytes twice means the file is fine and the listed CRC is wrong;
    // different bytes mean a damaged transfer.
    let mismatched: number | null = null;
    for (let attempt = 1; ; attempt++) {
      const pause = pausedUntil - Date.now();
      if (pause > 0) await wait(pause);
      try {
        const bytes = await fetchImage(image);
        const crc = Bun.hash.crc32(bytes);
        if (image.crc32 !== null && crc !== image.crc32 && crc !== mismatched) {
          mismatched = crc;
          throw new Retryable("CRC32 mismatch", 0);
        }
        const file = mediaFile(image.source_name);
        const target = join(mediaRoot, file);
        const partial = `${target}.part`;
        await mkdir(dirname(target), { recursive: true });
        await Bun.write(partial, bytes);
        await rename(partial, target);
        saved.run(file, bytes.length, new Date().toISOString(), image.id);
        progress.done++;
        progress.bytes += bytes.length;
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof Retryable && attempt < attempts) {
          const delay = error.waitMs ?? retryDelayMs * 2 ** (attempt - 1);
          if (message.startsWith("HTTP 429")) pausedUntil = Math.max(pausedUntil, Date.now() + delay);
          else await wait(delay);
          continue;
        }
        // Timeouts and network errors are left for a --retry-failed run.
        failed.run(message, image.id);
        progress.failed++;
        await rm(join(mediaRoot, `${mediaFile(image.source_name)}.part`), { force: true });
        return;
      }
    }
  }

  async function worker() {
    while (!signal?.aborted && next < images.length) {
      const image = images[next++]!;
      await download(image);
      onProgress?.(progress);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return progress;
}
