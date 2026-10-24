import type { Database } from "bun:sqlite";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { listZip, readZipEntry, type ArchiveEntry } from "./archives";
import { fileStart, hashBytes, hashFile, headerBytes, MAX_HASH_BYTES } from "./hash";
import { extension, matchKey, parseRomName, stem } from "./names";
import { ARCHIVE_EXTENSIONS, platformForFolder, type PlatformInfo } from "./platforms";
import { listSevenZip } from "./sevenzip";

/**
 * The ROM scanner: finds the user's game files, identifies each one, and
 * builds the library's games from them. A game is a title on a platform, so
 * regional versions and revisions of it are files of one game.
 *
 * 1. Platform folders are the roots, or their subfolders, whose names the
 *    platform table knows (platformForFolder).
 * 2. Files a .cue, .gdi or .m3u lists become part of that file's game.
 * 3. Changed files are hashed (unchanged ones keep their stored hashes).
 * 4. Each file is identified by its checksum in a DAT, or else by its name as
 *    a DAT game. Its title comes from that DAT name, or else from its file
 *    name, and the file joins the game with that title on the platform.
 * 5. Games left without files are removed.
 *
 * Identification runs on every file each scan, from stored hashes, so a new
 * DAT import improves matches without rehashing anything.
 */

export type MatchMethod = "hash" | "dat-name";

export type ScanOptions = {
  roots: string[];
  /** The DAT reference database (openDats), or null to go by file names only. */
  dats: Database | null;
  /** Folder name -> platform slug or name, for folders the table doesn't know. */
  overrides?: Record<string, string>;
  /** Hash every file again, not just changed ones. */
  full?: boolean;
  concurrency?: number;
  /**
   * Stops the scan between files. Files found so far keep their games, and
   * files that are gone are still removed; the rest wait for the next scan.
   */
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
};

export type ScanProgress = { done: number; total: number; hashed: number };

export type ScanSummary = {
  missingRoots: string[];
  platforms: { name: string; folder: string; files: number }[];
  unknownFolders: string[];
  /** Files directly in a root rather than in a platform folder, which aren't scanned. */
  looseFiles: string[];
  unsupported: { folder: string; reason: string }[];
  files: number;
  games: number;
  hashed: number;
  removed: number;
  /** Files identified in a DAT, by how. */
  identified: Record<MatchMethod, number>;
  /** Files no DAT identified; they're titled from their file names. */
  unidentified: number;
  /** Whether the scan was stopped before it got through every file. */
  cancelled: boolean;
  errors: { path: string; error: string }[];
};

type Candidate = { path: string; size: number; mtimeMs: number; members: string[] };

type StoredFile = {
  id: number;
  game_id: number;
  path: string;
  size: number;
  mtime_ms: number;
  data_size: number | null;
  entry: string | null;
  members: string | null;
  crc32: number | null;
  md5: string | null;
  sha1: string | null;
  header_bytes: number;
  match_method: MatchMethod | null;
  dat_name: string | null;
  tags: string | null;
};

type Fingerprint = Pick<StoredFile, "entry" | "crc32" | "md5" | "sha1" | "header_bytes"> & { size: number };

const IGNORED_DIRECTORIES = new Set(["media", "images", "videos", "manuals", "saves", "states", "screenshots", "snap", "thumbnails"]);

/** Files listed by a .cue, .gdi or .m3u, relative to it. */
async function listedFiles(path: string): Promise<string[]> {
  const kind = extension(path);
  const lines = (await Bun.file(path).text()).split(/\r?\n/);
  if (kind === "m3u") return lines.map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (kind === "cue") {
    return lines.flatMap((line) => {
      const match = line.match(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/i);
      return match ? [match[1] ?? match[2]!] : [];
    });
  }
  if (kind === "gdi") {
    return lines.slice(1).flatMap((line) => {
      const match = line.trim().match(/^\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))/);
      return match ? [match[1] ?? match[2]!] : [];
    });
  }
  return [];
}

/** The game files under a platform folder, with the files .cue/.gdi/.m3u bring along folded in. */
async function findCandidates(folder: string, platform: PlatformInfo): Promise<Candidate[]> {
  const wanted = new Set([...platform.extensions, ...ARCHIVE_EXTENSIONS]);
  const files = new Map<string, { size: number; mtimeMs: number }>();
  const walk = async (directory: string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name.startsWith(".")) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(item.name.toLowerCase())) await walk(path);
      } else if (item.isFile() || item.isSymbolicLink()) {
        const info = await stat(path).catch(() => null);
        if (info?.isFile()) files.set(path, { size: info.size, mtimeMs: Math.trunc(info.mtimeMs) });
      }
    }
  };
  await walk(folder);

  // Every file a list mentions belongs to that list's game, including
  // lists in lists (an .m3u of .cue files).
  const lists = [...files.keys()].filter((path) => ["cue", "gdi", "m3u"].includes(extension(path)));
  const members = new Map<string, string[]>();
  const memberOf = new Set<string>();
  for (const list of lists) {
    const listed = (await listedFiles(list).catch(() => [])).map((name) => resolve(dirname(list), name));
    members.set(list, listed);
    for (const path of listed) memberOf.add(path);
  }
  const allMembers = (list: string, seen = new Set<string>()): string[] =>
    (members.get(list) ?? []).flatMap((path) => {
      if (seen.has(path)) return [];
      seen.add(path);
      return [path, ...allMembers(path, seen)];
    });

  const candidates: Candidate[] = [];
  for (const [path, info] of files) {
    if (memberOf.has(path) || !wanted.has(extension(path))) continue;
    const listed = allMembers(path);
    const size = listed.reduce((total, member) => total + (files.get(member)?.size ?? 0), info.size);
    candidates.push({ path, size, mtimeMs: info.mtimeMs, members: listed.map((member) => relative(dirname(path), member)) });
  }
  return candidates;
}

export async function scan(db: Database, options: ScanOptions): Promise<ScanSummary> {
  const summary: ScanSummary = {
    missingRoots: [], platforms: [], unknownFolders: [], looseFiles: [], unsupported: [], files: 0, games: 0,
    hashed: 0, removed: 0,
    identified: { hash: 0, "dat-name": 0 }, unidentified: 0, cancelled: false, errors: [],
  };
  const now = new Date().toISOString();

  // Platform folders.
  const roots = options.roots.map((root) => resolve(root));
  const folders: { folder: string; platform: PlatformInfo }[] = [];
  const addFolder = (folder: string, platform: PlatformInfo) => {
    if (platform.unsupported) summary.unsupported.push({ folder, reason: platform.unsupported });
    else folders.push({ folder, platform });
  };
  for (const root of roots) {
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) {
      summary.missingRoots.push(root);
      continue;
    }
    const own = platformForFolder(basename(root), options.overrides);
    if (own) {
      addFolder(root, own);
      continue;
    }
    for (const item of await readdir(root, { withFileTypes: true })) {
      if (item.name.startsWith(".")) continue;
      if (!item.isDirectory()) {
        if (item.isFile()) summary.looseFiles.push(join(root, item.name));
        continue;
      }
      const platform = platformForFolder(item.name, options.overrides);
      if (platform) addFolder(join(root, item.name), platform);
      else summary.unknownFolders.push(join(root, item.name));
    }
  }

  // Library queries. Platforms are synced from PLATFORMS when the library opens.
  const platformId = db.query<{ id: number }, [string]>(`SELECT id FROM platforms WHERE slug = ?`);
  const storedQuery = db.query<StoredFile, [number]>(`
    SELECT f.* FROM rom_files f JOIN games g ON g.id = f.game_id WHERE g.platform_id = ?`);
  const gamesQuery = db.query<{ id: number; group_key: string }, [number]>(`
    SELECT id, group_key FROM games WHERE platform_id = ?`);
  const insertGame = db.query<{ id: number }, [number, string, string, string | null, string]>(`
    INSERT INTO games (platform_id, group_key, title, release_date, date_added) VALUES (?, ?, ?, ?, ?) RETURNING id`);
  const upsertFile = db.query(`
    INSERT INTO rom_files (game_id, path, entry, members, size, mtime_ms, data_size, crc32, md5, sha1,
      header_bytes, match_method, dat_name, title, region, tags, scanned_at)
    VALUES ($game_id, $path, $entry, $members, $size, $mtime_ms, $data_size, $crc32, $md5, $sha1,
      $header_bytes, $match_method, $dat_name, $title, $region, $tags, $scanned_at)
    ON CONFLICT (path) DO UPDATE SET game_id = excluded.game_id,
      entry = excluded.entry, members = excluded.members, size = excluded.size, mtime_ms = excluded.mtime_ms,
      data_size = excluded.data_size, crc32 = excluded.crc32, md5 = excluded.md5, sha1 = excluded.sha1,
      header_bytes = excluded.header_bytes, match_method = excluded.match_method, dat_name = excluded.dat_name,
      title = excluded.title, region = excluded.region, tags = excluded.tags, scanned_at = excluded.scanned_at`);
  const deleteFile = db.query(`DELETE FROM rom_files WHERE id = ?`);

  // DAT lookups, if there's a DAT database.
  const { dats } = options;
  const bySha1 = dats?.query<{ game_name: string }, [string, string]>(`
    SELECT r.game_name FROM dat_roms r JOIN dats d ON d.id = r.dat_id
    WHERE d.platform = ?1 AND r.sha1 = ?2 LIMIT 1`);
  const byCrc = dats?.query<{ game_name: string }, [string, number, number]>(`
    SELECT r.game_name FROM dat_roms r JOIN dats d ON d.id = r.dat_id
    WHERE d.platform = ?1 AND r.crc32 = ?2 AND r.size = ?3 LIMIT 1`);
  const byDatName = dats?.query<{ game_name: string }, [string, string]>(`
    SELECT r.game_name FROM dats d JOIN dat_roms r ON r.dat_id = d.id
    WHERE d.platform = ?1 AND r.game_name = ?2 LIMIT 1`);

  // Gather the work first, so progress has a total.
  type Job = { candidate: Candidate; platform: PlatformInfo; platformId: number; stored?: StoredFile };
  const jobs: Job[] = [];
  const seen = new Set<string>();
  for (const { folder, platform } of folders) {
    const id = platformId.get(platform.slug)?.id;
    if (id === undefined) continue;
    let candidates: Candidate[];
    try {
      candidates = await findCandidates(folder, platform);
    } catch (error) {
      summary.errors.push({ path: folder, error: String(error) });
      continue;
    }
    const stored = new Map(storedQuery.all(id).map((row) => [row.path, row]));
    for (const candidate of candidates) {
      seen.add(candidate.path);
      jobs.push({ candidate, platform, platformId: id, stored: stored.get(candidate.path) });
    }
    summary.platforms.push({ name: platform.name, folder, files: candidates.length });
  }

  // The games of each platform, by group key, loaded on first use.
  const games = new Map<number, Map<string, number>>();
  const gamesFor = (platform: number) => {
    let keys = games.get(platform);
    if (!keys) {
      keys = new Map(gamesQuery.all(platform).map((game) => [game.group_key, game.id]));
      games.set(platform, keys);
    }
    return keys;
  };

  const inDat = (slug: string, crc32: number | null, size: number) =>
    crc32 !== null && byCrc !== undefined && byCrc.get(slug, crc32, size) !== null;

  /** Hashes a file, or the game file in an archive. Null when it isn't hashed (discs, big files). */
  async function fingerprint(job: Job): Promise<Fingerprint | null> {
    const { candidate, platform } = job;
    const kind = extension(candidate.path);
    if (ARCHIVE_EXTENSIONS.includes(kind)) {
      const entries: ArchiveEntry[] = kind === "zip" ? await listZip(candidate.path) : await listSevenZip(candidate.path);
      if (!entries.length) return null;
      const roms = entries.filter((entry) => platform.extensions.includes(extension(entry.name)));
      const entry = [...(roms.length ? roms : entries)].sort((a, b) => b.size - a.size)[0]!;
      const listed: Fingerprint = { entry: entry.name, crc32: entry.crc32, md5: null, sha1: null, header_bytes: 0, size: entry.size };
      if (inDat(platform.slug, entry.crc32, entry.size)) return listed;
      // A headered dump: read it from the zip and hash it without the header.
      if (kind === "zip" && platform.header && entry.size <= 64 * 1024 * 1024) {
        const bytes = await readZipEntry(candidate.path, entry);
        const header = headerBytes(platform.header, bytes, bytes.length);
        if (header) return { ...hashBytes(bytes.subarray(header)), entry: entry.name, header_bytes: header };
      }
      return listed;
    }
    if (platform.kind === "disc" || candidate.members.length || candidate.size > MAX_HASH_BYTES) return null;
    const header = headerBytes(platform.header, await fileStart(candidate.path), candidate.size);
    const hashes = await hashFile(candidate.path, header);
    // A file that looks headered but is listed whole is tried both ways.
    if (header && !inDat(platform.slug, hashes.crc32, hashes.size)) {
      const whole = await hashFile(candidate.path);
      if (inDat(platform.slug, whole.crc32, whole.size)) return { ...whole, entry: null, header_bytes: 0 };
    }
    return { ...hashes, entry: null, header_bytes: header };
  }

  /** Works out what a file is, and which game it belongs to. */
  function identify(job: Job, print: Fingerprint | null) {
    const { candidate, platform } = job;
    let method: MatchMethod | null = null;
    let datName: string | null = null;

    if (print) {
      const hit = (print.sha1 && bySha1?.get(platform.slug, print.sha1)) ||
        (print.crc32 !== null && byCrc?.get(platform.slug, print.crc32, print.size));
      if (hit) (method = "hash"), (datName = hit.game_name);
    }
    const names = [stem(candidate.path)];
    if (print?.entry) names.push(stem(print.entry));
    // An .m3u is often named without the "(Disc 1)" its first disc has.
    if (extension(candidate.path) === "m3u" && candidate.members[0]) names.push(stem(candidate.members[0]));
    if (!method && byDatName) {
      for (const name of names) {
        const hit = byDatName.get(platform.slug, name);
        if (hit) {
          method = "dat-name";
          datName = hit.game_name;
          break;
        }
      }
    }
    if (method) summary.identified[method]++;
    else summary.unidentified++;

    const parsed = parseRomName(datName ?? names[0]!);
    const key = matchKey(parsed.title);
    const keys = gamesFor(job.platformId);
    let gameId = keys.get(key);
    if (gameId === undefined) {
      const year = parsed.tags.find((tag) => /^(19|20)\d\d$/.test(tag)) ?? null;
      gameId = insertGame.get(job.platformId, key, parsed.title, year, now)!.id;
      keys.set(key, gameId);
    }
    return { gameId, method, datName, parsed };
  }

  async function run(job: Job) {
    const { candidate, stored } = job;
    const changed = !stored || stored.size !== candidate.size || stored.mtime_ms !== candidate.mtimeMs;
    let print: Fingerprint | null;
    if (!changed && !options.full) {
      print = stored.crc32 === null && stored.sha1 === null ? null : {
        entry: stored.entry, crc32: stored.crc32, md5: stored.md5, sha1: stored.sha1,
        header_bytes: stored.header_bytes, size: stored.data_size ?? candidate.size,
      };
    } else {
      print = await fingerprint(job);
      if (print) summary.hashed++;
    }
    const result = identify(job, print);
    const members = candidate.members.length ? JSON.stringify(candidate.members) : null;
    const tags = result.parsed.tags.length ? JSON.stringify(result.parsed.tags) : null;
    // Unchanged files that identify the same way need no write.
    if (
      stored && !changed && !options.full && stored.game_id === result.gameId &&
      stored.match_method === result.method && stored.dat_name === result.datName && stored.members === members &&
      stored.tags === tags
    ) return;
    upsertFile.run({
      game_id: result.gameId, path: candidate.path, entry: print?.entry ?? null, members,
      size: candidate.size, mtime_ms: candidate.mtimeMs, data_size: print?.size ?? null, crc32: print?.crc32 ?? null,
      md5: print?.md5 ?? null, sha1: print?.sha1 ?? null, header_bytes: print?.header_bytes ?? 0,
      match_method: result.method, dat_name: result.datName, title: result.parsed.title, region: result.parsed.region,
      tags, scanned_at: now,
    });
  }

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length && !options.signal?.aborted) {
      const job = jobs[next++]!;
      try {
        await run(job);
      } catch (error) {
        summary.errors.push({ path: job.candidate.path, error: error instanceof Error ? error.message : String(error) });
      }
      summary.files++;
      options.onProgress?.({ done: ++done, total: jobs.length, hashed: summary.hashed });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
  summary.cancelled = done < jobs.length;

  // Files that are gone: under a scanned platform folder but not found, or
  // under no configured root at all. Files under a root that's missing (an
  // unplugged drive) are kept. Then games without files go too.
  const scannedFolders = folders.map(({ folder }) => folder + sep);
  const configured = roots.map((root) => root + sep);
  const missing = summary.missingRoots.map((root) => root + sep);
  db.transaction(() => {
    for (const row of db.query<{ id: number; path: string }, []>(`SELECT id, path FROM rom_files`).all()) {
      if (seen.has(row.path)) continue;
      const underScanned = scannedFolders.some((folder) => row.path.startsWith(folder));
      const underRoot = configured.some((root) => row.path.startsWith(root));
      const underMissing = missing.some((root) => row.path.startsWith(root));
      if (underScanned || (!underRoot && !underMissing)) {
        deleteFile.run(row.id);
        summary.removed++;
      }
    }
    db.run(`DELETE FROM games WHERE NOT EXISTS (SELECT 1 FROM rom_files f WHERE f.game_id = games.id)`);
  })();
  summary.games = (db.query(`SELECT COUNT(*) AS n FROM games`).get() as { n: number }).n;
  return summary;
}
