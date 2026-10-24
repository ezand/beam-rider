/**
 * Downloads artwork for the imported LaunchBox games to the media folder
 * (LIBRARY_MEDIA_PATH, default data/media).
 *
 *   bun run import:images [--types "Box - Front,Box - Front - Reconstructed"]
 *     [--top 50] [--limit N] [--concurrency 8] [--retry-failed] [--force]
 *
 * By default it fetches every front box image (scanned and reconstructed) of
 * every game, plus every image of the 50 most rated games. Everything else
 * stays listed in the database for a scraper to fetch later. Stop it with
 * Ctrl+C at any time; the next run carries on where it left off.
 */

import { existsSync, statfsSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { libraryPath, mediaPath } from "../src/server/config";
import { downloadImages, estimateBytes, pendingImages } from "../src/server/images";
import { openLibrary } from "../src/server/library";

const { values } = parseArgs({
  options: {
    types: { type: "string", default: "Box - Front,Box - Front - Reconstructed" },
    top: { type: "string", default: "50" },
    limit: { type: "string" },
    concurrency: { type: "string", default: "8" },
    "retry-failed": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

const library = openLibrary(libraryPath());
const root = mediaPath();
const images = pendingImages(library.db, {
  types: values.types.split(",").map((type) => type.trim()).filter(Boolean),
  topGames: Number(values.top),
  retryFailed: values["retry-failed"],
  limit: values.limit ? Number(values.limit) : undefined,
});
if (images.length === 0) {
  console.log("Nothing to download.");
  process.exit(0);
}

const estimate = estimateBytes(images);
// Free space on the disk the media folder is (or will be) on.
const free = (() => {
  let folder = root;
  while (!existsSync(folder) && dirname(folder) !== folder) folder = dirname(folder);
  const stats = statfsSync(folder);
  return stats.bavail * stats.bsize;
})();
console.log(`${images.length.toLocaleString("en")} images to download, about ${gb(estimate)}, into ${root}`);
console.log(`${gb(free)} free on that disk.`);
if (free < estimate * 1.1 && !values.force) {
  console.error("Not enough free space for the estimate. Free some up, point LIBRARY_MEDIA_PATH elsewhere, or pass --force.");
  process.exit(1);
}

const stop = new AbortController();
process.on("SIGINT", () => {
  if (stop.signal.aborted) process.exit(130);
  console.log("\nStopping after the downloads in progress (Ctrl+C again to quit now) …");
  stop.abort();
});

const started = performance.now();
let lastPrint = 0;
const result = await downloadImages(library.db, images, {
  mediaRoot: root,
  concurrency: Number(values.concurrency),
  signal: stop.signal,
  onProgress(progress) {
    const now = performance.now();
    if (now - lastPrint < 1000) return;
    lastPrint = now;
    const seconds = (now - started) / 1000;
    const finished = progress.done + progress.failed;
    const rate = finished / seconds;
    const eta = rate > 0 ? (progress.total - finished) / rate : 0;
    process.stdout.write(
      `\r  ${finished.toLocaleString("en")} / ${progress.total.toLocaleString("en")}` +
        `  ${gb(progress.bytes)}  ${(progress.bytes / 1e6 / seconds).toFixed(1)} MB/s` +
        `  ${progress.failed} failed  ${Math.round(eta / 60)} min left   `,
    );
  },
});
library.close();

const minutes = ((performance.now() - started) / 60000).toFixed(1);
console.log(`\nDownloaded ${result.done.toLocaleString("en")} images (${gb(result.bytes)}) in ${minutes} min.`);
if (result.failed) console.log(`${result.failed} failed; their errors are in game_images.error. Retry with --retry-failed.`);
