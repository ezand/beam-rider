/**
 * Imports the LaunchBox Games Database into the library.
 *
 *   bun run import:launchbox [--refresh]
 *
 * Downloads Metadata.zip to data/launchbox/ (reusing a copy from the last 24
 * hours unless --refresh), unpacks Metadata.xml and imports it. Run it again
 * later to pick up LaunchBox's updates. Then fetch artwork with
 * `bun run import:images`.
 */

import { $ } from "bun";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { libraryPath, WEB_ROOT } from "../src/server/config";
import { importLaunchBox } from "../src/server/launchbox";
import { openLibrary } from "../src/server/library";

const METADATA_URL = "https://gamesdb.launchbox-app.com/Metadata.zip";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const folder = join(WEB_ROOT, "data", "launchbox");
const zip = join(folder, "Metadata.zip");
const xml = join(folder, "Metadata.xml");
mkdirSync(folder, { recursive: true });

const age = (path: string) => {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return Infinity;
  }
};

if (process.argv.includes("--refresh") || age(zip) > MAX_AGE_MS) {
  console.log(`Downloading ${METADATA_URL} …`);
  const response = await fetch(METADATA_URL);
  if (!response.ok) throw new Error(`${METADATA_URL}: HTTP ${response.status}`);
  await Bun.write(`${zip}.part`, response);
  await $`mv ${zip}.part ${zip}`;
} else {
  console.log(`Using ${zip} from ${new Date(statSync(zip).mtimeMs).toLocaleString()}`);
}
if (age(xml) > age(zip)) {
  console.log("Unpacking Metadata.xml …");
  await $`unzip -o -q ${zip} Metadata.xml -d ${folder}`;
}

const path = libraryPath();
console.log(`Importing into ${path} …`);
const library = openLibrary(path);
const started = performance.now();
const summary = await importLaunchBox(library.db, Bun.file(xml).stream(), (records) =>
  process.stdout.write(`\r  ${records.toLocaleString("en")} records`),
);
library.db.run("PRAGMA optimize");
library.close();

const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`\rImported in ${seconds} s:`);
console.log(`  ${summary.platforms} platforms, ${summary.games.toLocaleString("en")} games, ${summary.genres} genres`);
console.log(`  ${summary.alternateNames.toLocaleString("en")} alternate names, ${summary.images.toLocaleString("en")} images`);
if (summary.removedImages) console.log(`  ${summary.removedImages.toLocaleString("en")} images no longer listed were removed`);
if (summary.orphans) console.log(`  ${summary.orphans.toLocaleString("en")} records pointed at unknown games and were skipped`);
const skipped = Object.entries(summary.skipped).map(([kind, count]) => `${count} ${kind}`);
if (skipped.length) console.log(`  Not imported: ${skipped.join(", ")}`);
