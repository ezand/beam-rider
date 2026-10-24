import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadImages, mediaFile, pendingImages, type ImageSelection } from "./images";
import { openLibrary, type Library } from "./library";

const FILES: Record<string, Uint8Array<ArrayBuffer>> = {
  "aaaa-box.jpg": new TextEncoder().encode("box art"),
  "bbbb-logo.png": new TextEncoder().encode("logo"),
  "cccc-shot.png": new TextEncoder().encode("screenshot"),
  "dddd-box.jpg": new TextEncoder().encode("another box"),
};

/** A stand-in for the LaunchBox image host, with a few ways to misbehave. */
let server: ReturnType<typeof Bun.serve>;
const requests: string[] = [];
let rateLimitsLeft = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
      requests.push(name);
      if (rateLimitsLeft > 0) {
        rateLimitsLeft--;
        return new Response("slow down", { status: 429, headers: { "Retry-After": "0" } });
      }
      // A damaged transfer: different bytes every time.
      if (name === "ffff-flaky.jpg") return new Response(crypto.getRandomValues(new Uint8Array(16)));
      const file = FILES[name];
      return file ? new Response(file) : new Response("missing", { status: 404 });
    },
  });
});
afterAll(() => server.stop());

function seed(): Library {
  const library = openLibrary(":memory:");
  const { db } = library;
  db.run("INSERT INTO platforms (id, name) VALUES (1, 'NES')");
  db.run(`INSERT INTO games (id, platform_id, title, community_rating_count) VALUES
    (1, 1, 'Popular', 900), (2, 1, 'Obscure', 3)`);
  const image = db.prepare(
    "INSERT INTO game_images (game_id, type, source, source_name, crc32) VALUES (?, ?, 'launchbox', ?, ?)",
  );
  const crc = (name: string) => Bun.hash.crc32(FILES[name] ?? new Uint8Array()) as number;
  image.run(1, "Box - Front", "aaaa-box.jpg", crc("aaaa-box.jpg"));
  image.run(1, "Clear Logo", "bbbb-logo.png", crc("bbbb-logo.png"));
  image.run(2, "Screenshot - Gameplay", "cccc-shot.png", crc("cccc-shot.png"));
  image.run(2, "Box - Front", "dddd-box.jpg", 12345); // stale CRC, but the same bytes every time
  image.run(2, "Box - Front - Reconstructed", "eeee-gone.jpg", 1); // 404
  image.run(2, "Box - Front", "ffff-flaky.jpg", 1); // damaged every time
  return library;
}

const selection: ImageSelection = {
  types: ["Box - Front", "Box - Front - Reconstructed"], topGames: 1, retryFailed: false,
};

describe("image downloads", () => {
  test("pick box fronts for every game and everything for the top games", () => {
    const library = seed();
    expect(pendingImages(library.db, selection).map((image) => image.source_name)).toEqual([
      "aaaa-box.jpg", "bbbb-logo.png", "dddd-box.jpg", "eeee-gone.jpg", "ffff-flaky.jpg",
    ]);
    expect(pendingImages(library.db, { ...selection, limit: 1 })).toHaveLength(1);
    library.close();
  });

  test("download, check CRCs, record failures, and resume", async () => {
    const library = seed();
    const { db } = library;
    const mediaRoot = await mkdtemp(join(tmpdir(), "beamrider-media-"));
    try {
      const options = { mediaRoot, baseUrl: server.url.href, retryDelayMs: 1, concurrency: 2 };
      rateLimitsLeft = 2;
      const result = await downloadImages(db, pendingImages(db, selection), options);
      expect(result).toMatchObject({ done: 3, failed: 2, total: 5 });

      expect(db.query("SELECT source_name, path, bytes, error FROM game_images ORDER BY source_name").all()).toEqual([
        { source_name: "aaaa-box.jpg", path: "aa/aaaa-box.jpg", bytes: 7, error: null },
        { source_name: "bbbb-logo.png", path: "bb/bbbb-logo.png", bytes: 4, error: null },
        { source_name: "cccc-shot.png", path: null, bytes: null, error: null },
        { source_name: "dddd-box.jpg", path: "dd/dddd-box.jpg", bytes: 11, error: null },
        { source_name: "eeee-gone.jpg", path: null, bytes: null, error: "HTTP 404" },
        { source_name: "ffff-flaky.jpg", path: null, bytes: null, error: "CRC32 mismatch" },
      ]);
      expect(await Bun.file(join(mediaRoot, mediaFile("aaaa-box.jpg"))).text()).toBe("box art");
      expect(await Bun.file(join(mediaRoot, "ff/ffff-flaky.jpg")).exists()).toBe(false);
      expect(await Bun.file(join(mediaRoot, "ff/ffff-flaky.jpg.part")).exists()).toBe(false);

      // A second run has nothing left, unless failures are retried.
      expect(pendingImages(db, selection)).toEqual([]);
      requests.length = 0;
      const retry = await downloadImages(db, pendingImages(db, { ...selection, retryFailed: true }), options);
      expect(retry).toMatchObject({ done: 0, failed: 2 });
      expect(requests.filter((name) => name === "eeee-gone.jpg")).toHaveLength(1);
      expect(requests.filter((name) => name === "ffff-flaky.jpg")).toHaveLength(5);
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
      library.close();
    }
  });

  test("stopping finishes the downloads in progress and leaves the rest", async () => {
    const library = seed();
    const mediaRoot = await mkdtemp(join(tmpdir(), "beamrider-media-"));
    try {
      const stop = new AbortController();
      const result = await downloadImages(library.db, pendingImages(library.db, selection), {
        mediaRoot, baseUrl: server.url.href, concurrency: 1, signal: stop.signal,
        onProgress: () => stop.abort(),
      });
      expect(result.done + result.failed).toBe(1);
      expect(pendingImages(library.db, selection)).toHaveLength(4);
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
      library.close();
    }
  });
});
