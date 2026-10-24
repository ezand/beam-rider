import { resolve } from "node:path";

/** The web app's folder. Relative paths in settings are resolved from here. */
export const WEB_ROOT = resolve(import.meta.dir, "../..");

/** The library database (LIBRARY_DB_PATH, default data/library.db). */
export const libraryPath = () => resolve(WEB_ROOT, process.env.LIBRARY_DB_PATH || "data/library.db");

/** Downloaded artwork (LIBRARY_MEDIA_PATH, default data/media). */
export const mediaPath = () => resolve(WEB_ROOT, process.env.LIBRARY_MEDIA_PATH || "data/media");

/**
 * Region order for card art (LIBRARY_ART_REGIONS, comma-separated), or
 * undefined for the default.
 */
export const artRegions = () => {
  const regions = process.env.LIBRARY_ART_REGIONS?.split(",").map((r) => r.trim()).filter(Boolean);
  return regions?.length ? regions : undefined;
};
