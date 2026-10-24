/**
 * Runs a library job (a scan, or a scrape) off the server's main thread, so
 * hashing, archive listing and downloads don't hold up requests. The worker
 * opens its own connections to the library and the DATs (SQLite's WAL mode
 * lets it write while the server reads). Messages are typed in manager.ts.
 */

import { openLibrary } from "../library";
import { scrape } from "../scrapers/scrape";
import { openDats } from "./dat";
import type { WorkerReply, WorkerRequest } from "./manager";
import { scan } from "./scan";

declare var self: Worker;

const stop = new AbortController();
const reply = (message: WorkerReply) => self.postMessage(message);

/** Passes progress on, at most every 200 ms and always at the end. */
const throttle = () => {
  let last = 0;
  return (progress: { done: number; total: number }) => {
    const now = performance.now();
    if (now - last < 200 && progress.done < progress.total) return;
    last = now;
    reply({ type: "progress", progress });
  };
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    stop.abort();
    return;
  }
  const library = openLibrary(request.libraryPath);
  const dats = openDats(request.datsPath, { readonly: true });
  const scrapeGames = (gameIds: number[] | undefined, full: boolean) =>
    scrape(library.db, {
      dats,
      settings: request.scrape,
      providers: request.scrapers,
      mediaRoot: request.mediaPath,
      gameIds,
      full,
      signal: stop.signal,
      onProgress: throttle(),
    });
  try {
    let scraped = null;
    if (request.job === "scan") {
      const summary = await scan(library.db, {
        roots: request.roots,
        overrides: request.overrides,
        full: request.full,
        dats,
        signal: stop.signal,
        onProgress: throttle(),
      });
      reply({ type: "scanned", summary, hadDats: dats !== null });
      if (request.scrapeAfterScan && summary.newGames.length && !stop.signal.aborted) {
        reply({ type: "phase", phase: "scrape" });
        scraped = await scrapeGames(summary.newGames, false);
      }
    } else {
      scraped = await scrapeGames(undefined, request.full);
    }
    library.db.run("PRAGMA optimize");
    reply({ type: "done", scrape: scraped });
  } catch (error) {
    reply({ type: "failed", error: error instanceof Error ? error.message : String(error) });
  } finally {
    library.close();
    dats?.close();
  }
};
