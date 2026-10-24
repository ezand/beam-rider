/**
 * Downloads the No-Intro and Redump reference lists (DATs) the ROM scanner
 * identifies games with, from libretro-database (CC BY-SA 4.0), into
 * data/dats/, and loads them into the DAT reference database
 * (LIBRARY_DATS_PATH, default data/dats.db). The library itself only holds
 * your games.
 *
 *   bun run import:dats [--refresh]
 *
 * Copies younger than a week are reused unless --refresh. Then run
 * `bun run scan`.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { datsPath, WEB_ROOT } from "../src/server/config";
import { importDats, importMetadata, openDats } from "../src/server/scanner/dat";

mkdirSync(dirname(datsPath()), { recursive: true });
const dats = openDats(datsPath())!;
const started = performance.now();
const results = await importDats(dats, join(WEB_ROOT, "data", "dats"), {
  maxAgeMs: process.argv.includes("--refresh") ? 0 : undefined,
  onDat(result) {
    const line = result.error ? `failed: ${result.error}` : `${result.roms.toLocaleString("en")} entries (${result.version ?? "no version"})`;
    console.log(`  ${result.name}: ${line}`);
  },
});
// Game details (developer, genre, year, ...) for the libretro scraper.
console.log("Game details from libretro's metadat lists …");
const meta = await importMetadata(dats, join(WEB_ROOT, "data", "dats"), {
  maxAgeMs: process.argv.includes("--refresh") ? 0 : undefined,
  onPlatform(result) {
    if (result.lists || result.errors.length) {
      console.log(`  ${result.platform}: ${result.entries.toLocaleString("en")} details from ${result.lists} lists` +
        (result.errors.length ? `, ${result.errors.length} failed` : ""));
    }
  },
});
dats.run("PRAGMA optimize");
dats.close();

const failed = results.filter((result) => result.error);
const entries = results.reduce((total, result) => total + result.roms, 0);
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`Imported ${results.length - failed.length} DATs, ${entries.toLocaleString("en")} entries, in ${seconds} s.`);
const metaEntries = meta.reduce((total, result) => total + result.entries, 0);
console.log(`Loaded ${metaEntries.toLocaleString("en")} game details for ${meta.filter((r) => r.lists).length} platforms.`);
if (failed.length || meta.some((r) => r.errors.length)) console.log("Some downloads failed; run again to retry them.");
