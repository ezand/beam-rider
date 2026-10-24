import type { ScrapeSummary } from "../src/server/scrapers/scrape";

/** Prints what a scrape found, for `bun run scrape` and `bun run scan`. */
export function printScrapeSummary(summary: ScrapeSummary, seconds: string) {
  const count = (n: number) => n.toLocaleString("en");
  console.log(`\nScraped ${count(summary.games)} games in ${seconds} s.`);
  for (const [provider, counts] of Object.entries(summary.providers)) {
    const ran = counts.found + counts.notFound + counts.errors;
    if (!ran) continue;
    console.log(`  ${provider}: found ${count(counts.found)}, not found ${count(counts.notFound)}` +
      (counts.errors ? `, ${count(counts.errors)} failed` : ""));
  }
  console.log(`  Images: ${count(summary.images.downloaded)} downloaded` +
    (summary.images.failed ? `, ${count(summary.images.failed)} failed` : ""));
  if (summary.cancelled) console.log("Stopped early; the next scrape carries on.");
  if (summary.errors.length) {
    console.log(`\n${summary.errors.length} lookups failed:`);
    for (const { gameId, provider, error } of summary.errors.slice(0, 10)) console.log(`  game ${gameId}, ${provider}: ${error}`);
  }
}
