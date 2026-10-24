import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { datName, PLATFORMS, type PlatformInfo } from "./platforms";

/**
 * Reference lists of known game dumps (DATs) from libretro-database, which
 * collects No-Intro, Redump and others and publishes them under CC BY-SA 4.0
 * (https://github.com/libretro/libretro-database). They're in clrmamepro's
 * text format:
 *
 *   clrmamepro ( name "Sega - 32X" version "2026.10.07" )
 *   game ( name "Doom (Europe)" rom ( name "Doom (Europe).32x" size 3145728 crc 53734E3A md5 ... sha1 ... ) )
 *
 * They're kept in a reference database of their own (data/dats.db), apart
 * from the library, which holds only the user's games.
 */

const DATS_SCHEMA = [
  // `path` is the DAT's path in libretro-database, such as
  // "no-intro/Nintendo - Super Nintendo Entertainment System.dat";
  // `platform` is the BeamRider platform slug it's for.
  `CREATE TABLE IF NOT EXISTS dats (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT,
    platform TEXT NOT NULL,
    imported_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dat_roms (
    dat_id INTEGER NOT NULL REFERENCES dats(id) ON DELETE CASCADE,
    game_name TEXT NOT NULL,
    rom_name TEXT NOT NULL,
    size INTEGER,
    crc32 INTEGER,
    md5 TEXT,
    sha1 TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS dat_roms_by_crc ON dat_roms(crc32, size)`,
  `CREATE INDEX IF NOT EXISTS dat_roms_by_sha1 ON dat_roms(sha1)`,
  `CREATE INDEX IF NOT EXISTS dat_roms_by_game ON dat_roms(dat_id, game_name)`,
  // Game details from libretro-database's metadat lists (developer, genre,
  // release year, ...), keyed by ROM CRC and game name. `source` is the
  // list's path, such as "developer/Sega - 32X.dat".
  `CREATE TABLE IF NOT EXISTS dat_meta (
    source TEXT NOT NULL,
    platform TEXT NOT NULL,
    game_name TEXT,
    crc32 INTEGER,
    field TEXT NOT NULL,
    value TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS dat_meta_by_crc ON dat_meta(platform, crc32)`,
  `CREATE INDEX IF NOT EXISTS dat_meta_by_name ON dat_meta(platform, game_name)`,
  `CREATE INDEX IF NOT EXISTS dat_meta_by_source ON dat_meta(source)`,
];

/** The libretro metadat lists imported, by folder. Each holds one field. */
export const META_LISTS = ["developer", "publisher", "genre", "releaseyear", "releasemonth", "maxusers", "franchise", "esrb"];

/**
 * Opens the DAT reference database at `path`, creating it unless `readonly`.
 * Returns null for a read-only open of a file that isn't there.
 */
export function openDats(path: string, { readonly = false } = {}): Database | null {
  if (readonly && path !== ":memory:" && !existsSync(path)) return null;
  const db = new Database(path, readonly ? { readonly: true } : { create: true });
  db.run("PRAGMA foreign_keys = ON");
  if (!readonly) for (const sql of DATS_SCHEMA) db.run(sql);
  return db;
}

export const DAT_BASE_URL = "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/";

export type DatRom = {
  game: string;
  name: string;
  size: number | null;
  crc32: number | null;
  md5: string | null;
  sha1: string | null;
};

export type Dat = { name: string; version: string | null; roms: DatRom[] };

/** Splits clrmamepro text into parentheses, quoted strings and words. */
function* tokens(text: string): Generator<string> {
  const pattern = /\s*(?:(\()|(\))|"((?:[^"\\]|\\.)*)"|([^\s()"]+))/gy;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match[1]) yield "(";
    else if (match[2]) yield ")";
    else if (match[3] !== undefined) yield `"${match[3].replace(/\\(.)/g, "$1")}`;
    else if (match[4] !== undefined) yield match[4];
    if (pattern.lastIndex >= text.length) break;
  }
}

const unquote = (token: string | undefined) => (token?.startsWith('"') ? token.slice(1) : (token ?? ""));

/** Parses a clrmamepro-format DAT. Unknown blocks and fields are skipped. */
export function parseDat(text: string): Dat {
  const dat: Dat = { name: "", version: null, roms: [] };
  const stream = tokens(text);
  const next = () => stream.next().value as string | undefined;

  /** Reads `key value` pairs up to the closing parenthesis; nested blocks go to `onBlock`. */
  const readBlock = (onField: (key: string, value: string) => void, onBlock?: (key: string) => void) => {
    for (let key = next(); key !== undefined && key !== ")"; key = next()) {
      const value = next();
      if (value === "(") {
        if (onBlock) onBlock(key);
        else skipBlock();
      } else if (value !== undefined) onField(key, unquote(value));
    }
  };
  const skipBlock = () => {
    for (let depth = 1, token = next(); token !== undefined; token = next()) {
      if (token === "(") depth++;
      else if (token === ")" && --depth === 0) return;
    }
  };

  for (let kind = next(); kind !== undefined; kind = next()) {
    if (next() !== "(") continue;
    if (kind === "clrmamepro") {
      readBlock((key, value) => {
        if (key === "name") dat.name = value;
        else if (key === "version") dat.version = value;
      });
    } else if (kind === "game" || kind === "machine") {
      let game = "";
      const roms: Omit<DatRom, "game">[] = [];
      readBlock(
        (key, value) => {
          if (key === "name") game = value;
        },
        (key) => {
          if (key !== "rom") return skipBlock();
          const rom: Omit<DatRom, "game"> = { name: "", size: null, crc32: null, md5: null, sha1: null };
          readBlock((field, value) => {
            if (field === "name") rom.name = value;
            else if (field === "size") rom.size = Number(value);
            else if (field === "crc") rom.crc32 = Number.parseInt(value, 16);
            else if (field === "md5") rom.md5 = value.toLowerCase();
            else if (field === "sha1") rom.sha1 = value.toLowerCase();
          });
          roms.push(rom);
        },
      );
      for (const rom of roms) dat.roms.push({ game, ...rom });
    } else {
      skipBlock();
    }
  }
  return dat;
}

export type DatMeta = { game: string | null; crc32: number | null; field: string; value: string };

/**
 * Parses a metadat list: games named by `comment`, each with fields (such
 * as `developer "Nintendo"`) and the CRCs of its ROMs.
 */
export function parseMetadat(text: string): DatMeta[] {
  const out: DatMeta[] = [];
  const stream = tokens(text);
  const next = () => stream.next().value as string | undefined;
  const skipBlock = () => {
    for (let depth = 1, token = next(); token !== undefined; token = next()) {
      if (token === "(") depth++;
      else if (token === ")" && --depth === 0) return;
    }
  };
  for (let kind = next(); kind !== undefined; kind = next()) {
    if (next() !== "(") continue;
    if (kind !== "game") {
      skipBlock();
      continue;
    }
    let game: string | null = null;
    const fields: [string, string][] = [];
    const crcs: number[] = [];
    for (let key = next(); key !== undefined && key !== ")"; key = next()) {
      const value = next();
      if (value === "(") {
        if (key !== "rom") {
          skipBlock();
          continue;
        }
        for (let field = next(); field !== undefined && field !== ")"; field = next()) {
          const fieldValue = unquote(next());
          if (field === "crc") crcs.push(Number.parseInt(fieldValue, 16));
        }
      } else if (value !== undefined) {
        if (key === "comment" || key === "name") game ??= unquote(value);
        else if (key !== "description") fields.push([key, unquote(value)]);
      }
    }
    for (const [field, value] of fields) {
      if (crcs.length === 0) out.push({ game, crc32: null, field, value });
      for (const crc32 of crcs) out.push({ game, crc32, field, value });
    }
  }
  return out;
}

export type DatImportResult = { path: string; name: string; version: string | null; roms: number; error?: string };

/**
 * A libretro-database file, from `folder` if fetched less than `maxAgeMs`
 * ago, else downloaded there. Null if libretro-database doesn't have it.
 */
async function datFile(path: string, folder: string, baseUrl: string, maxAgeMs: number): Promise<string | null> {
  const local = join(folder, path);
  const file = Bun.file(local);
  if ((await file.exists()) && Date.now() - file.lastModified < maxAgeMs) return file.text();
  const response = await fetch(baseUrl + path.split("/").map(encodeURIComponent).join("/"));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await mkdir(dirname(local), { recursive: true });
  await Bun.write(`${local}.part`, response);
  await rename(`${local}.part`, local);
  return Bun.file(local).text();
}

/**
 * Downloads the DATs of `platforms` (all of PLATFORMS by default) to
 * `folder` (reusing copies younger than `maxAgeMs`) and loads them into the
 * DAT database `db` (from openDats), replacing what each had before.
 */
export async function importDats(
  db: Database,
  folder: string,
  { baseUrl = DAT_BASE_URL, maxAgeMs = 7 * 24 * 3600 * 1000, platforms = PLATFORMS, onDat }: {
    baseUrl?: string;
    maxAgeMs?: number;
    platforms?: PlatformInfo[];
    onDat?: (result: DatImportResult) => void;
  } = {},
): Promise<DatImportResult[]> {
  const upsertDat = db.query<{ id: number }, [string, string, string | null, string, string]>(`
    INSERT INTO dats (path, name, version, platform, imported_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (path) DO UPDATE SET name = excluded.name, version = excluded.version,
      platform = excluded.platform, imported_at = excluded.imported_at
    RETURNING id`);
  const clearRoms = db.query(`DELETE FROM dat_roms WHERE dat_id = ?`);
  const insertRom = db.query(`
    INSERT INTO dat_roms (dat_id, game_name, rom_name, size, crc32, md5, sha1) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  const results: DatImportResult[] = [];
  for (const platform of platforms) {
    for (const path of platform.dats) {
      const result: DatImportResult = { path, name: datName(path), version: null, roms: 0 };
      try {
        const text = await datFile(path, folder, baseUrl, maxAgeMs);
        if (text === null) throw new Error("HTTP 404");
        const dat = parseDat(text);
        db.transaction(() => {
          const now = new Date().toISOString();
          const id = upsertDat.get(path, dat.name || result.name, dat.version, platform.slug, now)!.id;
          clearRoms.run(id);
          for (const rom of dat.roms) insertRom.run(id, rom.game, rom.name, rom.size, rom.crc32, rom.md5, rom.sha1);
        })();
        result.version = dat.version;
        result.roms = dat.roms.length;
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
      }
      results.push(result);
      onDat?.(result);
    }
  }
  return results;
}

export type MetaImportResult = { platform: string; lists: number; entries: number; errors: string[] };

/**
 * Downloads libretro's metadat lists (META_LISTS) for `platforms` and loads
 * them into `dat_meta`, replacing what each list had. Lists libretro doesn't
 * have for a platform are skipped.
 */
export async function importMetadata(
  db: Database,
  folder: string,
  { baseUrl = DAT_BASE_URL, maxAgeMs = 7 * 24 * 3600 * 1000, platforms = PLATFORMS, onPlatform }: {
    baseUrl?: string;
    maxAgeMs?: number;
    platforms?: PlatformInfo[];
    onPlatform?: (result: MetaImportResult) => void;
  } = {},
): Promise<MetaImportResult[]> {
  const clear = db.query(`DELETE FROM dat_meta WHERE source = ?`);
  const insert = db.query(`INSERT INTO dat_meta (source, platform, game_name, crc32, field, value) VALUES (?, ?, ?, ?, ?, ?)`);
  const results: MetaImportResult[] = [];
  for (const platform of platforms) {
    const result: MetaImportResult = { platform: platform.slug, lists: 0, entries: 0, errors: [] };
    // The lists are named like the platform's DATs.
    for (const name of new Set(platform.dats.map(datName))) {
      for (const list of META_LISTS) {
        const path = `${list}/${name}.dat`;
        try {
          const text = await datFile(path, folder, baseUrl, maxAgeMs);
          if (text === null) continue;
          const entries = parseMetadat(text);
          db.transaction(() => {
            clear.run(path);
            for (const e of entries) insert.run(path, platform.slug, e.game, e.crc32, e.field, e.value);
          })();
          result.lists++;
          result.entries += entries.length;
        } catch (error) {
          result.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    results.push(result);
    onPlatform?.(result);
  }
  return results;
}
