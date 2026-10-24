import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Http } from "./http";

/**
 * Downloads scraped images into the media folder. Files are named by a hash
 * of their URL, in folders by its first two characters
 * (`ab/libretro-ab12….png`), the layout the /art route serves. They're
 * written to a temporary name first, so a half-written file is never used.
 */

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Downloads `url` for `provider`. Null if it's gone; throws on other
 * failures. Games can share an image (a cover used for two releases), so a
 * file already saved for the same URL is reused, and each download writes
 * to its own temporary file.
 */
export async function downloadImage(
  http: Http,
  provider: string,
  url: string,
  mediaRoot: string,
): Promise<{ path: string; bytes: number } | null> {
  const hash = new Bun.CryptoHasher("sha1").update(url).digest("hex");
  const prefix = `${hash.slice(0, 2)}/${provider}-${hash}.`;
  for (const extension of Object.values(EXTENSIONS)) {
    const existing = Bun.file(join(mediaRoot, prefix + extension));
    if (await existing.exists()) return { path: prefix + extension, bytes: existing.size };
  }
  const response = await http.request(provider, url);
  if (!response) return null;
  const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const extension = EXTENSIONS[type] ?? url.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i)?.[1]?.toLowerCase().replace("jpeg", "jpg");
  if (!extension) throw new Error(`not an image (${type || "no type"}): ${url}`);
  const path = prefix + extension;
  const target = join(mediaRoot, path);
  await mkdir(dirname(target), { recursive: true });
  const partial = `${target}.${crypto.randomUUID()}.part`;
  const bytes = await Bun.write(partial, response);
  await rename(partial, target);
  return { path, bytes };
}
