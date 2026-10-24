import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary, type Library } from "../library";
import { importDats, openDats } from "./dat";
import { fakeRom, makeSevenZip, makeZip, RAR5_SAMPLE } from "./fixtures";
import { hashBytes } from "./hash";
import { PLATFORMS } from "./platforms";
import { scan, type ScanSummary } from "./scan";

const SNES = "Super Nintendo Entertainment System";

const mario = fakeRom(10, 512 * 1024);
const zelda = fakeRom(11, 1024 * 1024);
const fzero = fakeRom(12, 512 * 1024);
const homebrew = fakeRom(13, 32 * 1024);
const starfox = fakeRom(17, 8192);

const datRom = (game: string, file: string, bytes: Uint8Array) => {
  const { crc32, md5, sha1 } = hashBytes(bytes);
  const crc = crc32.toString(16).toUpperCase().padStart(8, "0");
  return `game (\n\tname "${game}"\n\trom ( name "${file}" size ${bytes.length} crc ${crc} md5 ${md5} sha1 ${sha1} )\n)\n`;
};

const DATS: Record<string, string> = {
  [`no-intro/Nintendo - ${SNES}.dat`]: `clrmamepro (\n\tname "Nintendo - ${SNES}"\n\tversion "test"\n)\n` +
    datRom("Super Mario World (USA)", "Super Mario World (USA).sfc", mario) +
    datRom("Legend of Zelda, The - A Link to the Past (USA)", "Legend of Zelda, The - A Link to the Past (USA).sfc", zelda) +
    datRom("F-Zero (Europe)", "F-Zero (Europe).sfc", fzero) +
    datRom("Star Fox (USA)", "Star Fox (USA).sfc", starfox),
  "no-intro/Sega - Mega Drive - Genesis.dat": `clrmamepro (\n\tname "Sega - Mega Drive - Genesis"\n)\n` +
    `game (\n\tname "Rar Test (World)"\n\trom ( name "Rar Test (World).bin" size ${RAR5_SAMPLE.size} crc ${RAR5_SAMPLE.crc32.toString(16).toUpperCase()} )\n)\n`,
  "redump/Sony - PlayStation.dat": `clrmamepro (\n\tname "Sony - PlayStation"\n)\n` +
    `game (\n\tname "Final Fantasy VII (USA) (Disc 1)"\n\trom ( name "Final Fantasy VII (USA) (Disc 1).cue" size 10 crc 00000001 )\n)\n`,
};

let root: string;
let datFolder: string;
let library: Library;
let dats: Database;
let server: ReturnType<typeof Bun.serve>;

const titles = (lib: Library, slug: string) => {
  const name = PLATFORMS.find((p) => p.slug === slug)!.name;
  const id = lib.platforms().find((p) => p.name === name)?.id;
  return id === undefined ? [] : lib.gamesPage(id, 0, 100).map((game) => game.title);
};
const run = (extra: Partial<Parameters<typeof scan>[1]> = {}): Promise<ScanSummary> =>
  scan(library.db, { roots: [root, join(root, "..", "unplugged-drive")], dats, ...extra });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "beamrider-roms-"));
  datFolder = await mkdtemp(join(tmpdir(), "beamrider-dats-"));
  library = openLibrary(":memory:");
  dats = openDats(":memory:")!;

  // DATs, served locally instead of from GitHub.
  server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const dat = DATS[decodeURIComponent(new URL(req.url).pathname.slice(1))];
      return dat ? new Response(dat) : new Response("missing", { status: 404 });
    },
  });
  const results = await importDats(dats, datFolder, {
    baseUrl: server.url.href,
    platforms: PLATFORMS.filter((p) => ["snes", "psx", "megadrive"].includes(p.slug)),
  });
  expect(results.map((r) => [r.name, r.roms, r.error ?? null])).toEqual([
    [`Nintendo - ${SNES}`, 4, null],
    ["Sega - Mega Drive - Genesis", 1, null],
    ["Sony - PlayStation", 1, null],
  ]);

  // The collection.
  const write = (path: string, data: Uint8Array | string) => Bun.write(join(root, path), data);
  await write("snes/Super Mario World (USA).sfc", mario);
  await write("snes/Super Mario World (Europe).sfc", fakeRom(20, 4096));
  await write("snes/zelda renamed.zip", makeZip([{ name: "whatever.sfc", data: zelda, deflate: true }]));
  await write("snes/F-Zero (Europe) [h].smc", Buffer.concat([new Uint8Array(512), fzero]));
  await write("snes/Homebrew Thing (PD).sfc", homebrew);
  await write("starfox-source/sf.sfc", starfox);
  await makeSevenZip(join(root, "snes", "starfox.7z"), [join(root, "starfox-source", "sf.sfc")]);
  await rm(join(root, "starfox-source"), { recursive: true });
  await write("megadrive/rar game.rar", RAR5_SAMPLE.bytes);
  await write("snes/notes.txt", "not a game");
  await write("snes/.DS_Store", "hidden");
  await write("snes/media/Super Mario World (USA).png", "art, not a game");
  const ff = "psx/Final Fantasy VII (USA)";
  await write(`${ff}/Final Fantasy VII (USA) (Disc 1).cue`, 'FILE "Final Fantasy VII (USA) (Disc 1).bin" BINARY\n  TRACK 01 MODE2/2352\n');
  await write(`${ff}/Final Fantasy VII (USA) (Disc 1).bin`, new Uint8Array(4096));
  await write(`${ff}/Final Fantasy VII (USA) (Disc 2).cue`, 'FILE "Final Fantasy VII (USA) (Disc 2).bin" BINARY\n');
  await write(`${ff}/Final Fantasy VII (USA) (Disc 2).bin`, new Uint8Array(2048));
  await write(`${ff}/Final Fantasy VII (USA).m3u`, "Final Fantasy VII (USA) (Disc 1).cue\nFinal Fantasy VII (USA) (Disc 2).cue\n");
  await write("psx/Crash Bandicoot (USA).chd", new Uint8Array(1024));
  await write("megadrive/Sonic1Final.bin", fakeRom(14, 2048));
  await write("Holiday photos/beach.jpg", "not a platform");
  await write("Loose Game (USA).sfc", "outside any platform folder");
  await write(".hidden-in-root", "ignored");
  await write("mame/sf2.zip", makeZip([{ name: "sf2.bin", data: fakeRom(15, 64) }]));
});

afterAll(async () => {
  server.stop();
  library.close();
  dats.close();
  await rm(root, { recursive: true, force: true });
  await rm(datFolder, { recursive: true, force: true });
});

describe("scanning a collection", () => {
  test("builds a game per title from the files, identified by checksum or name", async () => {
    expect(library.platforms()).toEqual([]);
    const summary = await run();
    expect(summary).toMatchObject({
      files: 10,
      games: 9,
      hashed: 8,
      removed: 0,
      identified: { hash: 5, "dat-name": 1 },
      unidentified: 4,
      errors: [],
      unknownFolders: [join(root, "Holiday photos")],
      looseFiles: [join(root, "Loose Game (USA).sfc")],
      unsupported: [{ folder: join(root, "mame"), reason: "arcade sets are supported later" }],
      missingRoots: [join(root, "..", "unplugged-drive")],
    });

    expect(titles(library, "snes")).toEqual([
      "F-Zero", "Homebrew Thing", "The Legend of Zelda - A Link to the Past", "Star Fox", "Super Mario World",
    ]);
    expect(titles(library, "psx")).toEqual(["Crash Bandicoot", "Final Fantasy VII"]);
    expect(titles(library, "megadrive")).toEqual(["Rar Test", "Sonic1Final"]);
    expect(library.platforms().map((p) => [p.name, p.game_count])).toEqual([
      ["Mega Drive", 2], ["PlayStation", 2], ["SNES", 5],
    ]);

    const files = library.db.query(`SELECT f.path, f.entry, f.members, f.match_method, f.dat_name, f.title, f.region, f.tags,
      f.header_bytes, f.crc32, g.title AS game FROM rom_files f JOIN games g ON g.id = f.game_id ORDER BY f.path`).all() as Record<string, unknown>[];
    const file = (end: string) => files.find((row) => (row.path as string).endsWith(end))!;
    expect(file("Super Mario World (USA).sfc")).toMatchObject({ match_method: "hash", dat_name: "Super Mario World (USA)", region: "USA" });
    // Another region of the same title: a second file of the same game.
    expect(file("Super Mario World (Europe).sfc")).toMatchObject({ match_method: null, region: "Europe", game: "Super Mario World" });
    // Tags come from the name the file was identified by: F-Zero's DAT name has
    // none, though its file name has [h]; the m3u's DAT name has its disc.
    expect(file("[h].smc")).toMatchObject({ tags: null });
    expect(file(".m3u")).toMatchObject({ tags: JSON.stringify(["Disc 1"]) });
    expect(file("Homebrew Thing (PD).sfc")).toMatchObject({ tags: JSON.stringify(["PD"]) });
    expect(file("Super Mario World (USA).sfc")).toMatchObject({ tags: null });
    expect(file("zelda renamed.zip")).toMatchObject({ match_method: "hash", entry: "whatever.sfc", crc32: Bun.hash.crc32(zelda) });
    expect(file("[h].smc")).toMatchObject({ match_method: "hash", header_bytes: 512, dat_name: "F-Zero (Europe)" });
    expect(file("Homebrew Thing (PD).sfc")).toMatchObject({ match_method: null, title: "Homebrew Thing" });
    expect(file(".m3u")).toMatchObject({
      match_method: "dat-name", dat_name: "Final Fantasy VII (USA) (Disc 1)",
      members: JSON.stringify([
        "Final Fantasy VII (USA) (Disc 1).cue", "Final Fantasy VII (USA) (Disc 1).bin",
        "Final Fantasy VII (USA) (Disc 2).cue", "Final Fantasy VII (USA) (Disc 2).bin",
      ]),
    });
    expect(file("Crash Bandicoot (USA).chd")).toMatchObject({ match_method: null, region: "USA" });
    expect(file("starfox.7z")).toMatchObject({ match_method: "hash", entry: "sf.sfc", dat_name: "Star Fox (USA)" });
    expect(file("rar game.rar")).toMatchObject({ match_method: "hash", entry: "test.bin", dat_name: "Rar Test (World)" });
    // Not the cue sheets or tracks of the m3u, the art, the text file or hidden files.
    expect(files).toHaveLength(10);
  });

  test("a second scan hashes nothing and writes nothing", async () => {
    const before = library.db.query("SELECT id, scanned_at FROM rom_files ORDER BY id").all();
    const summary = await run();
    expect(summary).toMatchObject({ files: 10, hashed: 0, removed: 0, games: 9 });
    expect(library.db.query("SELECT id, scanned_at FROM rom_files ORDER BY id").all()).toEqual(before);
  });

  test("removed and renamed files are picked up, and games without files go", async () => {
    await rm(join(root, "snes/Homebrew Thing (PD).sfc"));
    await rename(join(root, "snes/Super Mario World (USA).sfc"), join(root, "snes/SMW.sfc"));
    const summary = await run();
    expect(summary).toMatchObject({ files: 9, hashed: 1, removed: 2, games: 8 });
    expect(titles(library, "snes")).toEqual(["F-Zero", "The Legend of Zelda - A Link to the Past", "Star Fox", "Super Mario World"]);
    // The renamed file is still identified by its checksum, and still with its Europe sibling.
    expect(library.db.query(`SELECT COUNT(*) AS n FROM rom_files f JOIN games g ON g.id = f.game_id
      WHERE g.title = 'Super Mario World'`).get()).toEqual({ n: 2 });
  });

  test("files under a root that's missing stay; files under a dropped root go", async () => {
    const elsewhere = join(root, "..", "unplugged-drive", "snes", "Earthbound.sfc");
    const snes = (library.db.query("SELECT id FROM platforms WHERE slug = 'snes'").get() as { id: number }).id;
    const game = library.db.query(`INSERT INTO games (platform_id, group_key, title, date_added)
      VALUES (?, 'earthbound', 'Earthbound', 'now') RETURNING id`).get(snes) as { id: number };
    library.db.run(`INSERT INTO rom_files (game_id, path, size, mtime_ms, title, scanned_at)
      VALUES (?, ?, 1, 1, 'Earthbound', 'now')`, [game.id, elsewhere]);
    await run();
    expect(titles(library, "snes")).toContain("Earthbound");
    await scan(library.db, { roots: [root], dats });
    expect(titles(library, "snes")).not.toContain("Earthbound");
  });

  test("a new folder of games shows up, and a whole root can be one platform", async () => {
    await mkdir(join(root, "gba"));
    await Bun.write(join(root, "gba", "Golden Sun (USA, Europe).gba"), fakeRom(16, 4096));
    const summary = await scan(library.db, { roots: [root, join(root, "gba")], dats });
    expect(summary.platforms.filter((p) => p.name === "Game Boy Advance")).toHaveLength(2);
    expect(titles(library, "gba")).toEqual(["Golden Sun"]);
  });

  test("without DATs, files are titled from their names", async () => {
    const plain = openLibrary(":memory:");
    const summary = await scan(plain.db, { roots: [root], dats: null });
    expect(summary.identified).toEqual({ hash: 0, "dat-name": 0 });
    expect(titles(plain, "snes")).toEqual(["F-Zero", "SMW", "starfox", "Super Mario World", "zelda renamed"]);
    expect(titles(plain, "psx")).toEqual(["Crash Bandicoot", "Final Fantasy VII"]);
    plain.close();
  });
});
