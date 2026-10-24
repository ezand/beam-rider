import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../library";
import { fakeRom } from "./fixtures";
import { acquireScanLock } from "./lock";
import { createJobManager, jobRoutes, type JobSettings } from "./manager";

let folder: string;
let settings: JobSettings;
/** Stands in for libretro-thumbnails, knowing one game. */
let thumbnails: ReturnType<typeof Bun.serve>;

const gameCount = () => {
  const library = openLibrary(settings.libraryPath);
  const n = (library.db.query("SELECT COUNT(*) AS n FROM games").get() as { n: number }).n;
  library.close();
  return n;
};

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "beamrider-manager-"));
  thumbnails = Bun.serve({
    port: 0,
    fetch: (req) => decodeURIComponent(new URL(req.url).pathname).endsWith("/Named_Boxarts/Game 0000 (USA).png")
      ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } })
      : new Response(null, { status: 404 }),
  });
  settings = {
    libraryPath: join(folder, "library.db"),
    datsPath: join(folder, "no-dats.db"),
    mediaPath: join(folder, "media"),
    roots: [join(folder, "roms")],
    overrides: {},
    scrapers: ["libretro"],
    scrape: { urls: { libretro: thumbnails.url.href } },
    scrapeAfterScan: false,
    lockPath: join(folder, "library.db.scan-lock"),
  };
  // Enough files that a scan is still running when it's cancelled.
  for (let i = 0; i < 1500; i++) {
    await Bun.write(join(folder, "roms", "snes", `Game ${String(i).padStart(4, "0")} (USA).sfc`), fakeRom(i, 64));
  }
});
afterAll(async () => {
  thumbnails.stop();
  await rm(folder, { recursive: true, force: true });
});

describe("the scan manager", () => {
  test("runs a scan in a worker and reports how it went", async () => {
    const manager = createJobManager(settings);
    expect(manager.status().state).toBe("idle");
    expect(manager.start("scan")).toEqual({ started: true });
    expect(manager.status()).toMatchObject({ state: "running", finishedAt: null });
    // The server's thread stays free while the worker scans.
    const started = performance.now();
    await Bun.sleep(1);
    expect(performance.now() - started).toBeLessThan(100);

    await manager.idle();
    expect(manager.status()).toMatchObject({
      state: "done",
      job: "scan",
      phase: null,
      hadDats: false,
      progress: { done: 1500, total: 1500 },
      scan: { files: 1500, games: 1500, cancelled: false },
      scrape: null,
      error: null,
    });
    expect(gameCount()).toBe(1500);
    expect(await Bun.file(settings.lockPath).exists()).toBe(false);
  });

  test("runs one scan at a time", async () => {
    const manager = createJobManager(settings);
    expect(manager.start("scan")).toEqual({ started: true });
    expect(manager.start("scan")).toEqual({ started: false, reason: "running" });
    // Nor a second manager in the same place, as another server would be.
    expect(createJobManager(settings).start("scan")).toEqual({ started: false, reason: "locked", heldBy: process.pid });
    await manager.idle();
    expect(manager.start("scan")).toEqual({ started: true });
    await manager.idle();
  });

  test("can be cancelled, leaving the library as it was found", async () => {
    await rm(settings.libraryPath, { force: true });
    const manager = createJobManager(settings);
    expect(manager.cancel()).toBe(false);
    manager.start("scan", { full: true });
    expect(manager.cancel()).toBe(true);
    await manager.idle();
    const { state, scan: summary } = manager.status();
    expect(state).toBe("cancelled");
    expect(summary!.cancelled).toBe(true);
    expect(summary!.files).toBeLessThan(1500);
    expect(gameCount()).toBe(summary!.games);
  });

  test("scrapes the library, or a scan's new games", async () => {
    // A small collection of its own: three games, one of them on libretro.
    const own = { ...settings, libraryPath: join(folder, "scrape.db"), roots: [join(folder, "scrape-roms")] };
    for (const name of ["Game 0000 (USA)", "Other Game (Europe)", "Third Game (Japan)"]) {
      await Bun.write(join(folder, "scrape-roms", "snes", `${name}.sfc`), fakeRom(name.length, 64));
    }
    const scanner = createJobManager(own);
    scanner.start("scan");
    await scanner.idle();
    expect(scanner.status()).toMatchObject({ state: "done", scan: { games: 3 }, scrape: null });

    const manager = createJobManager(own);
    expect(manager.start("scrape")).toEqual({ started: true });
    expect(manager.status()).toMatchObject({ job: "scrape", phase: "scrape" });
    await manager.idle();
    expect(manager.status()).toMatchObject({
      state: "done", job: "scrape", scan: null,
      scrape: { games: 3, providers: { libretro: { found: 1, notFound: 2 } }, images: { downloaded: 1 } },
    });

    // A scan scrapes only the games it adds.
    await Bun.write(join(folder, "scrape-roms", "snes", "Late Arrival (USA).sfc"), fakeRom(9999, 64));
    const scanning = createJobManager({ ...own, scrapeAfterScan: true });
    scanning.start("scan");
    await scanning.idle();
    expect(scanning.status()).toMatchObject({
      state: "done", job: "scan", scan: { newGames: [expect.any(Number)] }, scrape: { games: 1 },
    });
  });

  test("waits for a scan another process is running, and takes over a stale lock", async () => {
    const other = Bun.spawn(["sleep", "30"]);
    try {
      await Bun.write(settings.lockPath, String(other.pid));
      const manager = createJobManager(settings);
      expect(manager.start("scan")).toEqual({ started: false, reason: "locked", heldBy: other.pid });
      other.kill();
      await other.exited;
      // Its process is gone, so the lock is stale.
      expect(manager.start("scan")).toEqual({ started: true });
      await manager.idle();
      expect(manager.status().state).toBe("done");
    } finally {
      other.kill();
    }
  });

  test("the lock is the one `bun run scan` takes", () => {
    const first = acquireScanLock(settings.lockPath);
    expect("lock" in first).toBe(true);
    expect(acquireScanLock(settings.lockPath)).toEqual({ heldBy: process.pid });
    if ("lock" in first) first.lock.release();
    const second = acquireScanLock(settings.lockPath);
    expect("lock" in second).toBe(true);
    // Leave it free for the other tests.
    if ("lock" in second) second.lock.release();
  });
});

describe("the scan and scrape API", () => {
  test("starts, reports and cancels jobs", async () => {
    const manager = createJobManager(settings);
    const server = Bun.serve({ port: 0, routes: jobRoutes(manager) });
    try {
      const call = async (method: string, path: string) => {
        const response = await fetch(new URL(path, server.url), { method });
        return { status: response.status, body: (await response.json()) as Record<string, any> };
      };
      expect(await call("GET", "/api/scan")).toMatchObject({ status: 200, body: { state: "idle" } });
      expect(await call("POST", "/api/scan/cancel")).toMatchObject({ status: 409, body: { error: "Nothing is running" } });
      expect(await call("POST", "/api/scan?full=1")).toMatchObject({ status: 202, body: { state: "running", job: "scan" } });
      expect(await call("POST", "/api/scrape")).toMatchObject({ status: 409, body: { error: "A scan or scrape is already running" } });
      expect(await call("GET", "/api/scrape")).toMatchObject({ status: 200, body: { job: "scan" } });
      expect(await call("POST", "/api/scrape/cancel")).toMatchObject({ status: 202 });
      await manager.idle();
      expect(await call("GET", "/api/scan")).toMatchObject({ status: 200, body: { state: "cancelled" } });
    } finally {
      server.stop();
    }
  });
});
