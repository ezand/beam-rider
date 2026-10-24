/**
 * Scrapes the library's games: details, descriptions and artwork from the
 * configured scrapers (LIBRARY_SCRAPERS, default libretro, Hasheous and
 * Wikipedia). Each scraper only looks up games it hasn't seen before.
 *
 *   bun run scrape [--full] [--only libretro,wikipedia]
 *
 * --full looks every game up again. Run `bun run import:dats` first for
 * libretro's details and for looking discs up by their DAT entries.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { datsPath, libraryPath, mediaPath, scanLockPath, scraperIds, scrapeSettings } from "../src/server/config";
import { openLibrary } from "../src/server/library";
import { openDats } from "../src/server/scanner/dat";
import { acquireScanLock } from "../src/server/scanner/lock";
import { scrape, scraperOrder } from "../src/server/scrapers/scrape";
import { printScrapeSummary } from "./report";

const { values } = parseArgs({
  options: { full: { type: "boolean", default: false }, only: { type: "string" } },
});

mkdirSync(dirname(libraryPath()), { recursive: true });
const locked = acquireScanLock(scanLockPath());
if ("heldBy" in locked) {
  console.error(`A scan or scrape is already running (process ${locked.heldBy}).`);
  process.exit(1);
}
const library = openLibrary(libraryPath());
const dats = openDats(datsPath(), { readonly: true });
if (!dats) console.log("No DATs imported: libretro has no details to give, and discs can't be looked up. Run `bun run import:dats`.");

const settings = scrapeSettings();
const providers = values.only?.split(",").map((id) => id.trim()).filter(Boolean) ?? scraperIds();
const order = scraperOrder(providers, settings);
console.log(`Scraping with ${order.map((s) => s.name).join(", ")}${settings.hasheousClientKey ? " (Hasheous with IGDB)" : ""} …`);

const stop = new AbortController();
process.on("SIGINT", () => {
  if (stop.signal.aborted) process.exit(130);
  console.log("\nStopping after the games in progress (Ctrl+C again to quit now) …");
  stop.abort();
});

const started = performance.now();
let lastPrint = 0;
const summary = await scrape(library.db, {
  dats,
  settings,
  providers,
  mediaRoot: mediaPath(),
  full: values.full,
  signal: stop.signal,
  onProgress({ done, total }) {
    const now = performance.now();
    if (now - lastPrint < 500 && done < total) return;
    lastPrint = now;
    process.stdout.write(`\r  ${done.toLocaleString("en")} / ${total.toLocaleString("en")} games   `);
  },
});
library.close();
dats?.close();
locked.lock.release();
printScrapeSummary(summary, ((performance.now() - started) / 1000).toFixed(1));
