import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listZip, parseSevenZipListing, readZipEntry } from "./archives";
import { importMetadata, openDats, parseDat, parseMetadat } from "./dat";
import { fakeRom, makeSevenZip, makeZip, RAR5_SAMPLE } from "./fixtures";
import { fileStart, hashBytes, hashFile, headerBytes } from "./hash";
import { extension, matchKey, parseRomName, stem } from "./names";
import { PLATFORMS, platformForFolder } from "./platforms";
import { listSevenZip } from "./sevenzip";

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "beamrider-scan-parts-"));
});
afterAll(() => rm(folder, { recursive: true, force: true }));

describe("dump names", () => {
  test("split into title, region and tags", () => {
    expect(parseRomName("Legend of Zelda, The - A Link to the Past (USA) (Rev 1)")).toEqual({
      title: "The Legend of Zelda - A Link to the Past", region: "USA", tags: ["Rev 1"],
    });
    expect(parseRomName("Super Mario World (USA, Europe)")).toEqual({ title: "Super Mario World", region: "USA, Europe", tags: [] });
    expect(parseRomName("Final Fantasy VII (Europe) (Disc 2)")).toMatchObject({ region: "Europe", tags: ["Disc 2"] });
    expect(parseRomName("Turrican (1990)(Rainbow Arts)(Disk 1 of 2)[cr]")).toEqual({
      title: "Turrican", region: null, tags: ["1990", "Rainbow Arts", "Disk 1 of 2", "cr"],
    });
    expect(parseRomName("Sonic the Hedgehog")).toEqual({ title: "Sonic the Hedgehog", region: null, tags: [] });
    expect(parseRomName("Mario, The (Beta)").title).toBe("The Mario");
    expect(parseRomName("(Proto) Thing").title).toBe("(Proto) Thing");
  });

  test("give the same key as other spellings of the title", () => {
    const pairs: [string, string][] = [
      ["Legend of Zelda, The - A Link to the Past", "The Legend of Zelda: A Link to the Past"],
      ["Legend of Zelda, The - The Wind Waker", "The Legend of Zelda: The Wind Waker"],
      ["Donkey Kong Country 2 - Diddy's Kong Quest", "Donkey Kong Country 2: Diddy's Kong Quest"],
      ["Super Mario Bros.", "Super Mario Bros"],
      ["Pokemon - Emerald Version", "Pokémon: Emerald Version"],
      ["Ren & Stimpy Show, The", "The Ren and Stimpy Show"],
      ["Castlevania - Symphony of the Night", "Castlevania: Symphony of the Night"],
    ];
    for (const [dump, other] of pairs) {
      expect([dump, matchKey(parseRomName(dump).title)]).toEqual([dump, matchKey(other)]);
    }
    expect(matchKey("Contra")).not.toBe(matchKey("Super Contra"));
  });

  test("file names", () => {
    expect(stem("/roms/snes/Super Mario World (USA).sfc")).toBe("Super Mario World (USA)");
    expect(extension("Game.Name.SFC")).toBe("sfc");
    expect(extension(".hidden")).toBe("");
  });
});

describe("platform folders", () => {
  test("are recognized by slug, short name, platform name or DAT name", () => {
    expect(platformForFolder("snes")?.slug).toBe("snes");
    expect(platformForFolder("Super Nintendo Entertainment System")?.slug).toBe("snes");
    expect(platformForFolder("Nintendo - Super Nintendo Entertainment System")?.slug).toBe("snes");
    expect(platformForFolder("MegaDrive")?.slug).toBe("megadrive");
    expect(platformForFolder("Genesis")?.slug).toBe("megadrive");
    expect(platformForFolder("sg-1000")?.slug).toBe("sg-1000");
    expect(platformForFolder("holiday photos")).toBeUndefined();
    expect(platformForFolder("my snes", { "My SNES": "snes" })?.slug).toBe("snes");
    expect(platformForFolder("my snes", { "My SNES": "Super Nintendo Entertainment System" })?.slug).toBe("snes");
  });

  test("have unique slugs, names and aliases", () => {
    const seen = new Map<string, string>();
    for (const platform of PLATFORMS) {
      const names = [platform.slug, platform.name, platform.providers.launchbox ?? platform.slug, ...platform.folders];
      const aliases = new Set(names.map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, "")));
      for (const alias of aliases) {
        expect([alias, seen.get(alias) ?? platform.slug]).toEqual([alias, platform.slug]);
        seen.set(alias, platform.slug);
      }
    }
  });
});

describe("DATs", () => {
  test("parse clrmamepro format, with games of several files", () => {
    const dat = parseDat(`clrmamepro (
	name "Nintendo - Super Nintendo Entertainment System"
	version "2026.10.07"
)

game (
	name "Super Mario World (USA)"
	description "Super Mario World (USA)"
	rom ( name "Super Mario World (USA).sfc" size 524288 crc B19ED489 md5 CDD3C8C37322978CA8669B34BC89C804 sha1 6B47BB75D16514B6A476AA0C73A683A2A4C18765 )
)
game (
	name "Ballz \\"3D\\" (Disc 1) [!]"
	rom ( name "Ballz (Track 1).bin" size 100 crc 00000001 )
	rom ( name "Ballz.cue" size 10 crc 00000002 )
	sample ( name "ignored" )
)
`);
    expect(dat.name).toBe("Nintendo - Super Nintendo Entertainment System");
    expect(dat.version).toBe("2026.10.07");
    expect(dat.roms).toEqual([
      { game: "Super Mario World (USA)", name: "Super Mario World (USA).sfc", size: 524288, crc32: 0xb19ed489,
        md5: "cdd3c8c37322978ca8669b34bc89c804", sha1: "6b47bb75d16514b6a476aa0c73a683a2a4c18765" },
      { game: 'Ballz "3D" (Disc 1) [!]', name: "Ballz (Track 1).bin", size: 100, crc32: 1, md5: null, sha1: null },
      { game: 'Ballz "3D" (Disc 1) [!]', name: "Ballz.cue", size: 10, crc32: 2, md5: null, sha1: null },
    ]);
  });
});

describe("libretro's metadat lists", () => {
  const developer = `clrmamepro (
	name "Nintendo - Super Nintendo Entertainment System"
)

game (
	comment "Super Mario World (USA)"
	developer "Nintendo EAD"
	rom ( crc B19ED489 )
)

game (
	comment "Two Releases (Europe)"
	developer "Someone"
	rom ( crc 00000001 )
	rom ( crc 00000002 )
)

game (
	comment "No CRC (Japan)"
	developer "Nobody"
	serial "SHVC-XX"
)
`;

  test("parse into a field per game and CRC", () => {
    expect(parseMetadat(developer)).toEqual([
      { game: "Super Mario World (USA)", crc32: 0xb19ed489, field: "developer", value: "Nintendo EAD" },
      { game: "Two Releases (Europe)", crc32: 1, field: "developer", value: "Someone" },
      { game: "Two Releases (Europe)", crc32: 2, field: "developer", value: "Someone" },
      { game: "No CRC (Japan)", crc32: null, field: "developer", value: "Nobody" },
      { game: "No CRC (Japan)", crc32: null, field: "serial", value: "SHVC-XX" },
    ]);
  });

  test("import for the platforms that have them, replacing what was there", async () => {
    const served: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = decodeURIComponent(new URL(req.url).pathname.slice(1));
        served.push(path);
        return path === "developer/Nintendo - Super Nintendo Entertainment System.dat"
          ? new Response(developer)
          : new Response("missing", { status: 404 });
      },
    });
    try {
      const dats = openDats(":memory:")!;
      const snes = PLATFORMS.filter((p) => p.slug === "snes");
      const run = () => importMetadata(dats, join(folder, "meta"), { baseUrl: server.url.href, platforms: snes, maxAgeMs: 0 });
      expect(await run()).toEqual([{ platform: "snes", lists: 1, entries: 5, errors: [] }]);
      expect(await run()).toEqual([{ platform: "snes", lists: 1, entries: 5, errors: [] }]);
      expect(dats.query("SELECT COUNT(*) AS n FROM dat_meta").get()).toEqual({ n: 5 });
      expect(dats.query("SELECT value FROM dat_meta WHERE platform = 'snes' AND crc32 = ?").get(0xb19ed489))
        .toEqual({ value: "Nintendo EAD" });
      expect(served).toContain("genre/Nintendo - Super Nintendo Entertainment System.dat");
      dats.close();
    } finally {
      server.stop();
    }
  });
});

describe("archives", () => {
  test("zip listings come from the central directory, and entries can be read", async () => {
    const rom = fakeRom(1, 70_000);
    const path = join(folder, "game.zip");
    await Bun.write(path, makeZip([
      { name: "Game (USA).sfc", data: rom, deflate: true },
      { name: "readme.txt", data: new TextEncoder().encode("hi") },
      { name: "Ünïcode.nes", data: rom.subarray(0, 10) },
    ]));
    const entries = await listZip(path);
    expect(entries.map(({ name, size, crc32 }) => ({ name, size, crc32 }))).toEqual([
      { name: "Game (USA).sfc", size: 70_000, crc32: Bun.hash.crc32(rom) as number },
      { name: "readme.txt", size: 2, crc32: Bun.hash.crc32("hi") as number },
      { name: "Ünïcode.nes", size: 10, crc32: Bun.hash.crc32(rom.subarray(0, 10)) as number },
    ]);
    expect(await readZipEntry(path, entries[0]!)).toEqual(rom);
    expect(new TextDecoder().decode(await readZipEntry(path, entries[1]!))).toBe("hi");
  });

  test("zips made by the zip tool read the same", async () => {
    if (!Bun.which("zip")) return;
    const rom = fakeRom(2, 5000);
    await Bun.write(join(folder, "tool", "Tool Game (Japan).gb"), rom);
    await Bun.$`zip -q -j ${join(folder, "tool.zip")} ${join(folder, "tool", "Tool Game (Japan).gb")}`;
    const [entry, ...rest] = await listZip(join(folder, "tool.zip"));
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ name: "Tool Game (Japan).gb", size: 5000, crc32: Bun.hash.crc32(rom) as number });
    expect(await readZipEntry(join(folder, "tool.zip"), entry!)).toEqual(rom);
  });

  test("non-zips are refused", async () => {
    await Bun.write(join(folder, "fake.zip"), "this is not a zip");
    expect(listZip(join(folder, "fake.zip"))).rejects.toThrow("not a zip");
  });

  test("7z archives are listed by the built-in 7-Zip", async () => {
    const rom = fakeRom(4, 9000);
    await Bun.write(join(folder, "seven", "Seven Game (Europe).md"), rom);
    await Bun.write(join(folder, "seven", "readme.txt"), "hello");
    const archive = join(folder, "seven.7z");
    await makeSevenZip(archive, [join(folder, "seven", "Seven Game (Europe).md"), join(folder, "seven", "readme.txt")]);
    expect(await listSevenZip(archive)).toEqual([
      { name: "Seven Game (Europe).md", size: 9000, crc32: Bun.hash.crc32(rom) as number },
      { name: "readme.txt", size: 5, crc32: Bun.hash.crc32("hello") as number },
    ]);
  });

  test("RAR archives are listed too", async () => {
    const archive = join(folder, "sample.rar");
    await Bun.write(archive, RAR5_SAMPLE.bytes);
    expect(await listSevenZip(archive)).toEqual([
      { name: RAR5_SAMPLE.entry, size: RAR5_SAMPLE.size, crc32: RAR5_SAMPLE.crc32 },
    ]);
  });

  test("files 7-Zip can't read are refused, and it keeps working after", async () => {
    await Bun.write(join(folder, "broken.7z"), "this is not an archive");
    expect(listSevenZip(join(folder, "broken.7z"))).rejects.toThrow("7-Zip");
    expect(listSevenZip(join(folder, "missing.rar"))).rejects.toThrow("7-Zip");
    expect(await listSevenZip(join(folder, "sample.rar"))).toHaveLength(1);
  });

  test("7-Zip listings parse, even with progress output in front", () => {
    const output = `  0M Scan /roms/\b\b\b\b\b\b     \b\b\b\b\bPath = Game (Europe).md
Folder = -
Size = 1048576
Packed Size = 400000
CRC = 0A1B2C3D

Path = extras
Folder = +
Size = 0
`;
    expect(parseSevenZipListing(output)).toEqual([{ name: "Game (Europe).md", size: 1048576, crc32: 0x0a1b2c3d }]);
  });
});

describe("hashing", () => {
  test("streams CRC32, MD5 and SHA-1, optionally after a header", async () => {
    const rom = fakeRom(3, 3 * 1024 * 1024 + 512);
    const path = join(folder, "big.smc");
    await Bun.write(path, rom);
    expect(await hashFile(path)).toEqual(hashBytes(rom));
    expect(await hashFile(path, 512)).toEqual(hashBytes(rom.subarray(512)));
  });

  test("detects copier headers", async () => {
    const snes = PLATFORMS.find((p) => p.slug === "snes")!;
    const lynx = PLATFORMS.find((p) => p.slug === "atarilynx")!;
    const start = new TextEncoder().encode("LYNX\0\0\0\0");
    expect(headerBytes(snes.header, new Uint8Array(16), 512 * 1024 + 512)).toBe(512);
    expect(headerBytes(snes.header, new Uint8Array(16), 512 * 1024)).toBe(0);
    expect(headerBytes(lynx.header, start, 128 * 1024 + 64)).toBe(64);
    expect(headerBytes(lynx.header, new Uint8Array(16), 128 * 1024)).toBe(0);
    const path = join(folder, "start.bin");
    await Bun.write(path, start);
    expect(await fileStart(path, 4)).toEqual(start.subarray(0, 4));
  });
});
