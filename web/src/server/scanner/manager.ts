import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ScrapeProgress, ScrapeSummary } from "../scrapers/scrape";
import type { ScrapeSettings } from "../scrapers/types";
import { acquireScanLock, type ScanLock } from "./lock";
import type { ScanProgress, ScanSummary } from "./scan";

/**
 * Runs the server's library jobs, scans and scrapes: one at a time, each in a
 * worker (worker.ts), and keeps their status for the API. A scan also
 * scrapes the games it added, if `scrapeAfterScan`. The folders to scan and
 * the scrapers to use come from the server's settings, never from a request.
 */

export type JobSettings = {
  libraryPath: string;
  datsPath: string;
  mediaPath: string;
  roots: string[];
  overrides: Record<string, string>;
  /** Scraper ids to use (default all) and their settings. */
  scrapers?: string[];
  scrape: ScrapeSettings;
  /** Scrape the games a scan adds. */
  scrapeAfterScan: boolean;
  /** The lock file shared with `bun run scan` and `bun run scrape`. */
  lockPath: string;
};

export type JobKind = "scan" | "scrape";

export type WorkerRequest =
  | ({ type: "start"; job: JobKind; full: boolean } & Omit<JobSettings, "lockPath">)
  | { type: "cancel" };

export type WorkerReply =
  | { type: "phase"; phase: JobKind }
  | { type: "progress"; progress: ScanProgress | ScrapeProgress }
  | { type: "scanned"; summary: ScanSummary; hadDats: boolean }
  | { type: "done"; scrape: ScrapeSummary | null }
  | { type: "failed"; error: string };

export type JobState = "idle" | "running" | "done" | "cancelled" | "failed";

export type JobStatus = {
  state: JobState;
  /** The job started: a scan (which may go on to scrape), or a scrape. */
  job: JobKind | null;
  /** What the running job is doing now. */
  phase: JobKind | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress: ScanProgress | ScrapeProgress | null;
  /** The scan's summary, once it's done. */
  scan: ScanSummary | null;
  /** The scrape's summary, once it's done. */
  scrape: ScrapeSummary | null;
  /** Whether the scan had DATs to identify files with. */
  hadDats: boolean | null;
  error: string | null;
};

export type StartResult = { started: true } | { started: false; reason: "running" | "locked"; heldBy?: number };

const IDLE: JobStatus = {
  state: "idle", job: null, phase: null, startedAt: null, finishedAt: null, progress: null,
  scan: null, scrape: null, hadDats: null, error: null,
};

export function createJobManager(settings: JobSettings) {
  let status: JobStatus = IDLE;
  let worker: Worker | null = null;
  let lock: ScanLock | null = null;
  let cancelling = false;
  /** Waiters for the running job to finish (used by tests and shutdown). */
  let finished: (() => void)[] = [];

  const finish = (update: Partial<JobStatus>) => {
    status = { ...status, ...update, phase: null, finishedAt: new Date().toISOString() };
    worker?.terminate();
    worker = null;
    lock?.release();
    lock = null;
    for (const resolve of finished) resolve();
    finished = [];
  };

  return {
    status: (): JobStatus => status,

    /** Starts a job unless one is running here or in another process. */
    start(job: JobKind, { full = false }: { full?: boolean } = {}): StartResult {
      if (worker) return { started: false, reason: "running" };
      mkdirSync(dirname(settings.lockPath), { recursive: true });
      const result = acquireScanLock(settings.lockPath);
      if ("heldBy" in result) return { started: false, reason: "locked", heldBy: result.heldBy };
      lock = result.lock;
      cancelling = false;
      status = { ...IDLE, state: "running", job, phase: job, startedAt: new Date().toISOString() };

      worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const message = event.data;
        if (message.type === "phase") status = { ...status, phase: message.phase, progress: null };
        else if (message.type === "progress") status = { ...status, progress: message.progress };
        else if (message.type === "scanned") status = { ...status, scan: message.summary, hadDats: message.hadDats };
        else if (message.type === "done") {
          const stopped = cancelling || status.scan?.cancelled || message.scrape?.cancelled;
          finish({ state: stopped ? "cancelled" : "done", scrape: message.scrape });
        } else finish({ state: "failed", error: message.error });
      };
      worker.onerror = (event) => finish({ state: "failed", error: event.message || "the job stopped unexpectedly" });
      const { lockPath: _, ...rest } = settings;
      worker.postMessage({ type: "start", job, full, ...rest } satisfies WorkerRequest);
      return { started: true };
    },

    /** Asks the running job to stop after the files or games in progress. */
    cancel(): boolean {
      if (!worker) return false;
      cancelling = true;
      worker.postMessage({ type: "cancel" } satisfies WorkerRequest);
      return true;
    },

    /** Resolves when no job is running. */
    idle(): Promise<void> {
      return worker ? new Promise((resolve) => finished.push(resolve)) : Promise.resolve();
    },
  };
}

export type JobManager = ReturnType<typeof createJobManager>;

/** The scan and scrape API's routes, for Bun.serve. Either GET shows the current job. */
export function jobRoutes(manager: JobManager) {
  const start = (job: JobKind) => (req: Request) => {
    const full = new URL(req.url).searchParams.get("full") === "1";
    const result = manager.start(job, { full });
    if (result.started) return Response.json(manager.status(), { status: 202 });
    const message = result.reason === "locked"
      ? `A scan or scrape is running in another process (${result.heldBy})`
      : "A scan or scrape is already running";
    return Response.json({ error: message, status: manager.status() }, { status: 409 });
  };
  const cancel = () => manager.cancel()
    ? Response.json(manager.status(), { status: 202 })
    : Response.json({ error: "Nothing is running", status: manager.status() }, { status: 409 });
  const status = () => Response.json(manager.status());
  return {
    "/api/scan": { GET: status, POST: start("scan") },
    "/api/scan/cancel": { POST: cancel },
    "/api/scrape": { GET: status, POST: start("scrape") },
    "/api/scrape/cancel": { POST: cancel },
  };
}
