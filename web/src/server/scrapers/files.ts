import type { Database } from "bun:sqlite";
import { stem } from "../scanner/names";
import type { ScrapeFile, ScrapeTarget } from "./types";

/** Regions in the order scrapers prefer a game's files by. */
const REGION_ORDER = ["usa", "world", "europe", "uk", "australia", "canada", "japan"];

const regionRank = (region: string | null) => {
  const parts = (region ?? "").toLowerCase().split(",").map((part) => part.trim());
  const ranks = parts.map((part) => REGION_ORDER.indexOf(part)).filter((rank) => rank >= 0);
  return ranks.length ? Math.min(...ranks) : REGION_ORDER.length;
};

/** The game's files, best region first: USA, World, Europe, …, Japan, then the rest. */
export function filesByRegion(files: ScrapeFile[]): ScrapeFile[] {
  return [...files].sort((a, b) => regionRank(a.region) - regionRank(b.region));
}

/** The names a game's files go by in DATs, best region first, without repeats. */
export function datNames(target: ScrapeTarget): { name: string; region: string | null }[] {
  const seen = new Set<string>();
  const names: { name: string; region: string | null }[] = [];
  for (const file of filesByRegion(target.files)) {
    const name = file.datName ?? stem(file.fileName);
    if (!seen.has(name)) {
      seen.add(name);
      names.push({ name, region: file.region });
    }
  }
  return names;
}

export type Hashes = { sha1: string | null; md5: string | null; crc32: number | null; size: number | null };

/**
 * Checksums to look a file up by, best first: its own, then, for a file
 * identified by name, those of the DAT entry it matched. Its own checksum
 * isn't in the DAT (else it would have matched by checksum), so providers
 * that work from DATs more likely know the entry's. Discs aren't hashed and
 * have only the entry's. A disc's DAT entry lists several files (tracks, cue
 * sheet); the largest is the disc.
 */
export function fileHashes(file: ScrapeFile, platform: string, dats: Database | null): Hashes[] {
  const candidates: Hashes[] = [];
  if (file.sha1 || file.md5 || file.crc32 !== null) {
    candidates.push({ sha1: file.sha1, md5: file.md5, crc32: file.crc32, size: file.size });
  }
  if (file.datName && file.matchMethod !== "hash" && dats) {
    const rom = dats.query<Hashes, [string, string]>(`
      SELECT r.sha1, r.md5, r.crc32, r.size FROM dat_roms r JOIN dats d ON d.id = r.dat_id
      WHERE d.platform = ?1 AND r.game_name = ?2
      ORDER BY r.size DESC LIMIT 1`).get(platform, file.datName);
    if (rom) candidates.push(rom);
  }
  return candidates;
}
