import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createArtHandler } from "./art";

/** A solid-color RGB PNG, so the tests don't need image files. */
function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
    const out = new DataView(new ArrayBuffer(12 + data.length));
    out.setUint32(0, data.length);
    new Uint8Array(out.buffer).set(body, 4);
    out.setUint32(8 + data.length, Bun.hash.crc32(body) as number);
    return new Uint8Array(out.buffer);
  };
  const header = new DataView(new ArrayBuffer(13));
  header.setUint32(0, width);
  header.setUint32(4, height);
  header.setUint8(8, 8); // bit depth
  header.setUint8(9, 2); // RGB
  const row = new Uint8Array(1 + width * 3).fill(200);
  row[0] = 0; // no filter
  const pixels = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) pixels.set(row, y * row.length);
  return new Uint8Array([
    ...[137, 80, 78, 71, 13, 10, 26, 10],
    ...chunk("IHDR", new Uint8Array(header.buffer)),
    ...chunk("IDAT", new Uint8Array(deflateSync(pixels))),
    ...chunk("IEND", new Uint8Array()),
  ]);
}

let mediaRoot: string;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "beamrider-art-"));
  await mkdir(join(mediaRoot, "ab"), { recursive: true });
  await Bun.write(join(mediaRoot, "ab", "abcd-box.png"), png(1200, 1600));
  await Bun.write(join(mediaRoot, "ab", "abcd-small.png"), png(100, 80));
  await Bun.write(join(mediaRoot, "ab", "abcd-broken.jpg"), "not an image");
  await Bun.write(join(mediaRoot, "secret.png"), png(10, 10));
  server = Bun.serve({ port: 0, routes: { "/art/:size/:shard/:file": createArtHandler(mediaRoot) } });
});

afterAll(async () => {
  server.stop();
  await rm(mediaRoot, { recursive: true, force: true });
});

const get = (path: string) => fetch(new URL(path, server.url));

describe("art thumbnails", () => {
  test("shrink to fit 512 px, as WebP that can be cached for good", async () => {
    const response = await get("/art/512/ab/abcd-box.png?v=7");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("immutable");
    const { width, height, format } = await new Bun.Image(await response.bytes()).metadata();
    expect({ width, height, format }).toEqual({ width: 384, height: 512, format: "webp" });
    expect(await Bun.file(join(mediaRoot, "thumbs/512/ab/abcd-box.png-7.webp")).exists()).toBe(true);
  });

  test("never enlarge small images", async () => {
    const response = await get("/art/512/ab/abcd-small.png");
    const { width, height } = await new Bun.Image(await response.bytes()).metadata();
    expect({ width, height }).toEqual({ width: 100, height: 80 });
  });

  test("are made once for concurrent requests", async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => get("/art/512/ab/abcd-box.png?v=8")));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    const sizes = await Promise.all(responses.map(async (response) => (await response.bytes()).length));
    expect(new Set(sizes).size).toBe(1);
  });

  test("refuse anything outside the media folder or the known sizes", async () => {
    for (const path of [
      "/art/512/ab/missing.png",
      "/art/256/ab/abcd-box.png",
      "/art/512/../secret.png",
      "/art/512/ab/..%2Fsecret.png",
      "/art/512/AB/abcd-box.png",
      "/art/512/ab/abcd-box.png?v=../x",
      "/art/512/ab/abcd-box.txt",
    ]) {
      expect([path, (await get(path)).status]).toEqual([path, 404]);
    }
  });

  test("report images that can't be decoded", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      expect((await get("/art/512/ab/abcd-broken.jpg")).status).toBe(415);
    } finally {
      console.error = original;
    }
  });
});
