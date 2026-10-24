import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Serves downloaded artwork at sizes for the wheel. The originals (box scans
 * of 1 MB and more) are too big to decode by the dozen while it spins, so
 * each is shrunk to fit ART_SIZES and encoded as WebP the first time it's
 * asked for, then served from a cache on disk under `thumbs/`.
 *
 * URLs look like `/art/512/41/41ba4239-....jpg?v=<crc32>`. The version comes
 * from the database, so a replaced image gets a new URL, and every response
 * can be cached for good.
 */

/**
 * Longest side, in pixels, of the sizes the server makes: 512 for the wheel
 * and showcase, 64 for the blurred backdrop, where detail is lost anyway.
 */
export const ART_SIZES = [64, 512] as const;
export type ArtSize = (typeof ART_SIZES)[number];

const SHARD = /^[0-9a-z]{2}$/;
const FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(jpe?g|png|webp|gif|bmp)$/i;
const VERSION = /^\d{1,10}$/;

/** The URL of an image's thumbnail, from its `game_images` path and CRC. */
export function artUrl(path: string, version: number | null, size: ArtSize = 512): string {
  return `/art/${size}/${path}?v=${version ?? 0}`;
}

export function createArtHandler(mediaRoot: string) {
  /** Thumbnails being made, so concurrent requests for one share the work. */
  const pending = new Map<string, Promise<boolean>>();

  async function makeThumbnail(source: string, target: string, size: number): Promise<boolean> {
    const original = Bun.file(source);
    if (!(await original.exists())) return false;
    await mkdir(dirname(target), { recursive: true });
    const partial = `${target}.part`;
    await original.image().resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).write(partial);
    await rename(partial, target);
    return true;
  }

  return async (req: Request & { params: { size: string; shard: string; file: string } }) => {
    const { size, shard, file } = req.params;
    const version = new URL(req.url).searchParams.get("v") ?? "0";
    if (
      !ART_SIZES.includes(Number(size) as ArtSize) ||
      !SHARD.test(shard) ||
      !FILE.test(file) ||
      !VERSION.test(version)
    ) {
      return new Response("Not found", { status: 404 });
    }

    const target = join(mediaRoot, "thumbs", size, shard, `${file}-${version}.webp`);
    if (!(await Bun.file(target).exists())) {
      let job = pending.get(target);
      if (!job) {
        job = makeThumbnail(join(mediaRoot, shard, file), target, Number(size))
          .catch((error) => {
            console.error(`Could not make a thumbnail of ${shard}/${file}:`, error);
            throw error;
          })
          .finally(() => pending.delete(target));
        pending.set(target, job);
      }
      try {
        if (!(await job)) return new Response("Not found", { status: 404 });
      } catch {
        return new Response("Unreadable image", { status: 415 });
      }
    }
    return new Response(Bun.file(target), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  };
}
