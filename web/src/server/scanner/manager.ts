import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { acquireScanLock, type ScanLock } from "./lock";
import type { ScanProgress, ScanSummary } from "./scan";

/**
 * Runs the server's scans: one at a time, each in a worker (worker.ts), and
 * keeps their status for the API. The folders to scan come from the server's
 * settings, never from a request.
 */

export type ScanSettings = {
  libraryPath: string;
  datsPath: string;
  roots: string[];
  overrides: Record<string, string>;
  /** The lock file shared with `bun run scan`. */
  lockPath: string;
};

export type WorkerRequest =
  | ({ type: "start"; full: boolean } & Omit<ScanSettings, "lockPath">)
  | { type: "cancel" };

export type WorkerReply =
  | { type: "progress"; progress: ScanProgress }
  | { type: "done"; summary: ScanSummary; hadDats: boolean }
  | { type: "failed"; error: string };

export type ScanState = "idle" | "running" | "done" | "cancelled" | "failed";

export type ScanStatus = {
  state: ScanState;
  startedAt: string | null;
  finishedAt: string | null;
  progress: ScanProgress | null;
  /** The finished scan's summary. */
  summary: ScanSummary | null;
  /** Whether that scan had DATs to identify files with. */
  hadDats: boolean | null;
  error: string | null;
};

export type StartResult = { started: true } | { started: false; reason: "running" | "locked"; heldBy?: number };

export function createScanManager(settings: ScanSettings) {
  let status: ScanStatus = {
    state: "idle", startedAt: null, finishedAt: null, progress: null, summary: null, hadDats: null, error: null,
  };
  let worker: Worker | null = null;
  let lock: ScanLock | null = null;
  let cancelling = false;
  /** Waiters for the running scan to finish (used by tests and shutdown). */
  let finished: (() => void)[] = [];

  const finish = (update: Partial<ScanStatus>) => {
    status = { ...status, ...update, finishedAt: new Date().toISOString() };
    worker?.terminate();
    worker = null;
    lock?.release();
    lock = null;
    for (const resolve of finished) resolve();
    finished = [];
  };

  return {
    status: (): ScanStatus => status,

    /** Starts a scan unless one is running here or in another process. */
    start({ full = false }: { full?: boolean } = {}): StartResult {
      if (worker) return { started: false, reason: "running" };
      mkdirSync(dirname(settings.lockPath), { recursive: true });
      const result = acquireScanLock(settings.lockPath);
      if ("heldBy" in result) return { started: false, reason: "locked", heldBy: result.heldBy };
      lock = result.lock;
      cancelling = false;
      status = {
        state: "running", startedAt: new Date().toISOString(), finishedAt: null,
        progress: null, summary: null, hadDats: null, error: null,
      };

      worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const message = event.data;
        if (message.type === "progress") status = { ...status, progress: message.progress };
        else if (message.type === "done") {
          finish({
            state: message.summary.cancelled || cancelling ? "cancelled" : "done",
            summary: message.summary,
            hadDats: message.hadDats,
          });
        } else finish({ state: "failed", error: message.error });
      };
      worker.onerror = (event) => finish({ state: "failed", error: event.message || "the scan stopped unexpectedly" });
      const { lockPath: _, ...paths } = settings;
      worker.postMessage({ type: "start", full, ...paths } satisfies WorkerRequest);
      return { started: true };
    },

    /** Asks the running scan to stop after the files in progress. */
    cancel(): boolean {
      if (!worker) return false;
      cancelling = true;
      worker.postMessage({ type: "cancel" } satisfies WorkerRequest);
      return true;
    },

    /** Resolves when no scan is running. */
    idle(): Promise<void> {
      return worker ? new Promise((resolve) => finished.push(resolve)) : Promise.resolve();
    },
  };
}

export type ScanManager = ReturnType<typeof createScanManager>;

/** The scan API's routes, for Bun.serve. */
export function scanRoutes(manager: ScanManager) {
  return {
    "/api/scan": {
      GET: () => Response.json(manager.status()),
      POST: async (req: Request) => {
        const full = new URL(req.url).searchParams.get("full") === "1";
        const result = manager.start({ full });
        if (result.started) return Response.json(manager.status(), { status: 202 });
        const message = result.reason === "locked"
          ? `A scan is running in another process (${result.heldBy})`
          : "A scan is already running";
        return Response.json({ error: message, status: manager.status() }, { status: 409 });
      },
    },
    "/api/scan/cancel": {
      POST: () => manager.cancel()
        ? Response.json(manager.status(), { status: 202 })
        : Response.json({ error: "No scan is running", status: manager.status() }, { status: 409 }),
    },
  };
}
