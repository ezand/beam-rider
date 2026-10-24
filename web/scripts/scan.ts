/**
 * Scans the ROM folders (LIBRARY_ROM_ROOTS, default data/roms) and builds the
 * library's games from the files found, so the wheel shows them.
 *
 *   bun run scan [--full]
 *
 * Only new and changed files are hashed; --full hashes everything again.
 * Run `bun run import:dats` first to identify games by checksum.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { datsPath, libraryPath, romPlatformOverrides, romRoots, scanLockPath } from "../src/server/config";
import { openLibrary } from "../src/server/library";
import { openDats } from "../src/server/scanner/dat";
import { acquireScanLock } from "../src/server/scanner/lock";
import { scan } from "../src/server/scanner/scan";

const roots = romRoots();
mkdirSync(dirname(libraryPath()), { recursive: true });
// One scan at a time, also against scans the server runs.
const locked = acquireScanLock(scanLockPath());
if ("heldBy" in locked) {
  console.error(`A scan is already running (process ${locked.heldBy}).`);
  process.exit(1);
}
const stop = new AbortController();
process.on("SIGINT", () => {
  if (stop.signal.aborted) process.exit(130);
  console.log("\nStopping after the files in progress (Ctrl+C again to quit now) …");
  stop.abort();
});
const library = openLibrary(libraryPath());
const dats = openDats(datsPath(), { readonly: true });
if (!dats) console.log("No DATs imported, so games are identified by file name only. Run `bun run import:dats` first.");

console.log(`Scanning ${roots.join(", ")} …`);
const started = performance.now();
let lastPrint = 0;
const summary = await scan(library.db, {
  roots,
  dats,
  overrides: romPlatformOverrides(),
  full: process.argv.includes("--full"),
  signal: stop.signal,
  onProgress({ done, total, hashed }) {
    const now = performance.now();
    if (now - lastPrint < 500 && done < total) return;
    lastPrint = now;
    process.stdout.write(`\r  ${done.toLocaleString("en")} / ${total.toLocaleString("en")} files, ${hashed.toLocaleString("en")} hashed   `);
  },
});
library.db.run("PRAGMA optimize");
library.close();
dats?.close();
locked.lock.release();

const seconds = ((performance.now() - started) / 1000).toFixed(1);
const count = (n: number) => n.toLocaleString("en");
if (summary.cancelled) console.log("\nStopped early; the next scan carries on.");
console.log(`\nScanned ${count(summary.files)} files in ${seconds} s (${count(summary.hashed)} hashed, ${count(summary.removed)} removed).`);
for (const platform of summary.platforms) console.log(`  ${platform.name}: ${count(platform.files)} files in ${platform.folder}`);
console.log(`${count(summary.games)} games in the library.`);
console.log(`Identified in a DAT: ${count(summary.identified.hash + summary.identified["dat-name"])}` +
  ` (by checksum ${count(summary.identified.hash)}, by name ${count(summary.identified["dat-name"])}).`);
if (summary.unidentified) console.log(`Not in a DAT, titled from their file names: ${count(summary.unidentified)}.`);

if (summary.missingRoots.length) {
  console.log(`\nNot found: ${summary.missingRoots.join(", ")}.`);
  console.log("Set LIBRARY_ROM_ROOTS in .env to your ROM folders (see .env.example). Files found there before stay in the library.");
}
if (summary.looseFiles.length) {
  console.log(`\nFiles outside a platform folder aren't scanned; move them into one (such as snes or wii):`);
  for (const file of summary.looseFiles.slice(0, 20)) console.log(`  ${file}`);
  if (summary.looseFiles.length > 20) console.log(`  … and ${summary.looseFiles.length - 20} more`);
}
if (summary.unknownFolders.length) {
  console.log(`\nFolders with no known platform (rename them, or map them to a platform with LIBRARY_ROM_PLATFORMS):`);
  for (const folder of summary.unknownFolders) console.log(`  ${folder}`);
}
for (const { folder, reason } of summary.unsupported) console.log(`Skipped ${folder}: ${reason}.`);
if (summary.errors.length) {
  console.log(`\n${summary.errors.length} files could not be read:`);
  for (const { path, error } of summary.errors.slice(0, 20)) console.log(`  ${path}: ${error}`);
}
