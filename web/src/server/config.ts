import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";

/** The web app's folder. Relative paths in settings are resolved from here. */
export const WEB_ROOT = resolve(import.meta.dir, "../..");

/** The library database (LIBRARY_DB_PATH, default data/library.db). */
export const libraryPath = () => resolve(WEB_ROOT, process.env.LIBRARY_DB_PATH || "data/library.db");

/** Downloaded artwork, which cards show (LIBRARY_MEDIA_PATH, default data/media). */
export const mediaPath = () => resolve(WEB_ROOT, process.env.LIBRARY_MEDIA_PATH || "data/media");

/**
 * Region order for card art (LIBRARY_ART_REGIONS, comma-separated), or
 * undefined for the default.
 */
export const artRegions = () => {
  const regions = process.env.LIBRARY_ART_REGIONS?.split(",").map((r) => r.trim()).filter(Boolean);
  return regions?.length ? regions : undefined;
};

/**
 * ROM root folders (LIBRARY_ROM_ROOTS, separated by the OS path separator,
 * ":" on macOS and Linux; default data/roms).
 */
export const romRoots = () =>
  (process.env.LIBRARY_ROM_ROOTS || "data/roms")
    .split(delimiter)
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => resolve(WEB_ROOT, root.replace(/^~(?=$|\/)/, homedir())));

/**
 * Platforms for folders the scanner doesn't recognize (LIBRARY_ROM_PLATFORMS,
 * "folder=platform; ...", by slug or name), as folder -> platform.
 */
export const romPlatformOverrides = (): Record<string, string> =>
  Object.fromEntries(
    (process.env.LIBRARY_ROM_PLATFORMS ?? "")
      .split(";")
      .map((pair) => pair.split("=").map((part) => part.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && Boolean(pair[0]) && Boolean(pair[1])),
  );

/** The DAT reference database (LIBRARY_DATS_PATH, default data/dats.db). */
export const datsPath = () => resolve(WEB_ROOT, process.env.LIBRARY_DATS_PATH || "data/dats.db");

/** The lock file that keeps scans to one at a time, next to the library. */
export const scanLockPath = () => libraryPath() + ".scan-lock";
