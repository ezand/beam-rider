import type { Header } from "./platforms";

/**
 * Checksums of game files, as DATs list them: CRC32, MD5 and SHA-1 in one
 * pass over the file, optionally skipping a header at the start.
 */

export type Hashes = { crc32: number; md5: string; sha1: string; size: number };

/** Files bigger than this (disc images) aren't hashed; they're identified by name. */
export const MAX_HASH_BYTES = 512 * 1024 * 1024;

/** Hashes `path`, leaving out its first `skip` bytes. */
export async function hashFile(path: string, skip = 0): Promise<Hashes> {
  const md5 = new Bun.CryptoHasher("md5");
  const sha1 = new Bun.CryptoHasher("sha1");
  let crc32 = 0;
  let size = 0;
  let toSkip = skip;
  for await (let chunk of Bun.file(path).stream()) {
    if (toSkip > 0) {
      const dropped = Math.min(toSkip, chunk.length);
      chunk = chunk.subarray(dropped);
      toSkip -= dropped;
      if (chunk.length === 0) continue;
    }
    crc32 = Bun.hash.crc32(chunk, crc32);
    md5.update(chunk);
    sha1.update(chunk);
    size += chunk.length;
  }
  return { crc32, md5: md5.digest("hex"), sha1: sha1.digest("hex"), size };
}

/** Hashes bytes already in memory, such as a file read from an archive. */
export function hashBytes(bytes: Uint8Array): Hashes {
  return {
    crc32: Bun.hash.crc32(bytes),
    md5: new Bun.CryptoHasher("md5").update(bytes).digest("hex"),
    sha1: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
    size: bytes.length,
  };
}

/** How many header bytes a file starting with `start` and of `size` bytes has, for `header`. */
export function headerBytes(header: Header | undefined, start: Uint8Array, size: number): number {
  return header && size > header.bytes && header.detect(start, size) ? header.bytes : 0;
}

/** The first bytes of a file, enough for header detection. */
export async function fileStart(path: string, bytes = 512): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(path).slice(0, bytes).arrayBuffer());
}
