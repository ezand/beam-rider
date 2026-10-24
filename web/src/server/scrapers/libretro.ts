import { datName } from "../scanner/platforms";
import { datNames, fileHashes } from "./files";
import type { FoundImage, GameField, ImageType, Scraper } from "./types";

/**
 * libretro: free and keyless.
 *
 * - Artwork from libretro-thumbnails (https://thumbnails.libretro.com):
 *   `<system>/Named_Boxarts/<game>.png`, named exactly like the DATs (system
 *   "Nintendo - Super Nintendo Entertainment System", game "Super Mario
 *   World (USA)"), so it's found from the names the scanner identified.
 * - Details from libretro-database's metadat lists (`dat_meta` in the DAT
 *   database, loaded by `bun run import:dats`), keyed by ROM CRC: developer,
 *   publisher, genre, release date, players, franchise, ESRB rating. They
 *   cover mostly cartridge systems.
 */

export const LIBRETRO_THUMBNAILS = "https://thumbnails.libretro.com/";

const FOLDERS: [ImageType, string][] = [
  ["box-front", "Named_Boxarts"],
  ["title-screen", "Named_Titles"],
  ["screenshot", "Named_Snaps"],
  ["logo", "Named_Logos"],
];

/** libretro-thumbnails' file names replace these characters with "_". */
export const thumbnailName = (name: string) => name.replace(/[&*/:`<>?\\|"]/g, "_");

export const libretro: Scraper = {
  id: "libretro",
  name: "libretro",
  configured: () => true,

  async scrape(target, { http, dats, settings }) {
    const base = settings.urls?.libretro ?? LIBRETRO_THUMBNAILS;
    const systems = [...new Set(target.platform.dats.map(datName))];
    const names = datNames(target);

    // Artwork: the first name each image exists under, best region first.
    const images: FoundImage[] = [];
    let found: string | null = null;
    for (const [type, folder] of FOLDERS) {
      search: for (const system of systems) {
        for (const { name, region } of names) {
          const url = `${base}${encodeURIComponent(system)}/${folder}/${encodeURIComponent(thumbnailName(name))}.png`;
          if (await http.exists("libretro", url)) {
            images.push({ type, url, region });
            found ??= name;
            break search;
          }
        }
      }
    }

    // Details, by the CRCs of the game's files (or of the DAT entries they
    // matched), then by DAT name.
    const fields: Partial<Record<GameField, string>> = {};
    const genres: string[] = [];
    if (dats) {
      const byCrc = dats.query<{ field: string; value: string; game_name: string }, [string, number]>(`
        SELECT field, value, game_name FROM dat_meta WHERE platform = ?1 AND crc32 = ?2`);
      const byName = dats.query<{ field: string; value: string; game_name: string }, [string, string]>(`
        SELECT field, value, game_name FROM dat_meta WHERE platform = ?1 AND game_name = ?2`);
      let rows: { field: string; value: string; game_name: string }[] = [];
      search: for (const file of target.files) {
        for (const { crc32 } of fileHashes(file, target.platform.slug, dats)) {
          if (crc32 !== null) rows = byCrc.all(target.platform.slug, crc32);
          if (rows.length) break search;
        }
        if (file.datName) rows = byName.all(target.platform.slug, file.datName);
        if (rows.length) break;
      }
      // "???" marks an unknown part, as in "Nintendo ???" (an unknown Nintendo team).
      const value = (field: string) =>
        rows.find((row) => row.field === field)?.value?.replace(/\s*\?{3,}\s*/g, " ").trim() || undefined;
      fields.developer = value("developer");
      fields.publisher = value("publisher");
      const year = value("releaseyear");
      const month = value("releasemonth");
      if (year) fields.release_date = month ? `${year}-${month.padStart(2, "0")}` : year;
      const users = value("users");
      if (users) fields.players = users;
      fields.series = value("franchise");
      const esrb = value("esrb_rating");
      if (esrb) fields.rating = `ESRB ${esrb}`;
      for (const genre of (value("genre") ?? "").split(/\s*[/,]\s*/)) if (genre) genres.push(genre);
      if (rows.length) found ??= rows[0]!.game_name;
    }
    for (const key of Object.keys(fields) as GameField[]) if (fields[key] === undefined) delete fields[key];

    if (!images.length && !Object.keys(fields).length && !genres.length) return null;
    return { externalId: found, fields, genres, images };
  },
};
