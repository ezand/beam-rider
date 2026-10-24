import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../library";
import { fakeRom } from "./fixtures";
import { acquireScanLock } from "./lock";
import { createScanManager, scanRoutes, type ScanSettings } from "./manager";

let folder: string;
let settings: ScanSettings;

const gameCount = () => {
  const library = openLibrary(settings.libraryPath);
  const n = (library.db.query("SELECT COUNT(*) AS n FROM games").get() as { n: number }).n;
  library.close();
  return n;
};

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "beamrider-manager-"));
  settings = {
    libraryPath: join(folder, "library.db"),
    datsPath: join(folder, "no-dats.db"),
    roots: [join(folder, "roms")],
    overrides: {},
    lockPath: join(folder, "library.db.scan-lock"),
  };
  // Enough files that a scan is still running when it's cancelled.
  for (let i = 0; i < 1500; i++) {
    await Bun.write(join(folder, "roms", "snes", `Game ${String(i).padStart(4, "0")} (USA).sfc`), fakeRom(i, 64));
  }
});
afterAll(() => rm(folder, { recursive: true, force: true }));

describe("the scan manager", () => {
  test("runs a scan in a worker and reports how it went", async () => {
    const manager = createScanManager(settings);
    expect(manager.status().state).toBe("idle");
    expect(manager.start()).toEqual({ started: true });
    expect(manager.status()).toMatchObject({ state: "running", finishedAt: null });
    // The server's thread stays free while the worker scans.
    const started = performance.now();
    await Bun.sleep(1);
    expect(performance.now() - started).toBeLessThan(100);

    await manager.idle();
    expect(manager.status()).toMatchObject({
      state: "done",
      hadDats: false,
      progress: { done: 1500, total: 1500 },
      summary: { files: 1500, games: 1500, cancelled: false },
      error: null,
    });
    expect(gameCount()).toBe(1500);
    expect(await Bun.file(settings.lockPath).exists()).toBe(false);
  });

  test("runs one scan at a time", async () => {
    const manager = createScanManager(settings);
    expect(manager.start()).toEqual({ started: true });
    expect(manager.start()).toEqual({ started: false, reason: "running" });
    // Nor a second manager in the same place, as another server would be.
    expect(createScanManager(settings).start()).toEqual({ started: false, reason: "locked", heldBy: process.pid });
    await manager.idle();
    expect(manager.start()).toEqual({ started: true });
    await manager.idle();
  });

  test("can be cancelled, leaving the library as it was found", async () => {
    await rm(settings.libraryPath, { force: true });
    const manager = createScanManager(settings);
    expect(manager.cancel()).toBe(false);
    manager.start({ full: true });
    expect(manager.cancel()).toBe(true);
    await manager.idle();
    const { state, summary } = manager.status();
    expect(state).toBe("cancelled");
    expect(summary!.cancelled).toBe(true);
    expect(summary!.files).toBeLessThan(1500);
    expect(gameCount()).toBe(summary!.games);
  });

  test("waits for a scan another process is running, and takes over a stale lock", async () => {
    const other = Bun.spawn(["sleep", "30"]);
    try {
      await Bun.write(settings.lockPath, String(other.pid));
      const manager = createScanManager(settings);
      expect(manager.start()).toEqual({ started: false, reason: "locked", heldBy: other.pid });
      other.kill();
      await other.exited;
      // Its process is gone, so the lock is stale.
      expect(manager.start()).toEqual({ started: true });
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

describe("the scan API", () => {
  test("starts, reports and cancels scans", async () => {
    const manager = createScanManager(settings);
    const server = Bun.serve({ port: 0, routes: scanRoutes(manager) });
    try {
      const call = async (method: string, path: string) => {
        const response = await fetch(new URL(path, server.url), { method });
        return { status: response.status, body: (await response.json()) as Record<string, any> };
      };
      expect(await call("GET", "/api/scan")).toMatchObject({ status: 200, body: { state: "idle" } });
      expect(await call("POST", "/api/scan/cancel")).toMatchObject({ status: 409, body: { error: "No scan is running" } });
      expect(await call("POST", "/api/scan?full=1")).toMatchObject({ status: 202, body: { state: "running" } });
      expect(await call("POST", "/api/scan")).toMatchObject({ status: 409, body: { error: "A scan is already running" } });
      expect(await call("POST", "/api/scan/cancel")).toMatchObject({ status: 202 });
      await manager.idle();
      expect(await call("GET", "/api/scan")).toMatchObject({ status: 200, body: { state: "cancelled" } });
    } finally {
      server.stop();
    }
  });
});
