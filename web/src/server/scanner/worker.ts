/**
 * Runs a scan off the server's main thread, so hashing and archive listing
 * don't hold up requests. The worker opens its own connections to the
 * library and the DATs (SQLite's WAL mode lets it write while the server
 * reads). Messages are typed in manager.ts.
 */

import { openLibrary } from "../library";
import { openDats } from "./dat";
import type { WorkerReply, WorkerRequest } from "./manager";
import { scan } from "./scan";

declare var self: Worker;

const stop = new AbortController();
const reply = (message: WorkerReply) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    stop.abort();
    return;
  }
  const library = openLibrary(request.libraryPath);
  const dats = openDats(request.datsPath, { readonly: true });
  try {
    let lastProgress = 0;
    const summary = await scan(library.db, {
      roots: request.roots,
      overrides: request.overrides,
      full: request.full,
      dats,
      signal: stop.signal,
      onProgress(progress) {
        const now = performance.now();
        if (now - lastProgress < 200 && progress.done < progress.total) return;
        lastProgress = now;
        reply({ type: "progress", progress });
      },
    });
    library.db.run("PRAGMA optimize");
    reply({ type: "done", summary, hadDats: dats !== null });
  } catch (error) {
    reply({ type: "failed", error: error instanceof Error ? error.message : String(error) });
  } finally {
    library.close();
    dats?.close();
  }
};
