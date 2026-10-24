import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initial, openLibrary, type Library } from "./library";
import { PLATFORMS } from "./scanner/platforms";
import { migrate, SCHEMA_VERSION } from "./schema";

const STRESS_GAMES = 100_000;

/** The id of a platform (synced from PLATFORMS when the library opens). */
function platformId(library: Library, slug: string): number {
  return (library.db.query("SELECT id FROM platforms WHERE slug = ?").get(slug) as { id: number }).id;
}

let nextKey = 0;

/** Adds a game, as the scanner would. Titles may repeat; group keys don't. */
function addGame(library: Library, platform: number, title: string, extra: { sortTitle?: string; hide?: number; date?: string } = {}) {
  return (library.db
    .query(`INSERT INTO games (platform_id, group_key, title, sort_title, hide, release_date, date_added)
      VALUES (?, ?, ?, ?, ?, ?, 'now') RETURNING id, sort_key`)
    .get(platform, `key ${nextKey++}`, title, extra.sortTitle ?? null, extra.hide ?? 0, extra.date ?? null)) as {
    id: number;
    sort_key: string;
  };
}

/** Seeded generator, so failures reproduce. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Like the Godot frontend's stress test platform, with repeated titles and hidden games. */
function seedStressGames(library: Library, platform: number, count: number) {
  const words = ["Super", "Mega", "The Ultra", "Hyper", "A Turbo", "Final", "Dark", "Cosmic", "Neon",
    "Iron", "Crystal", "Shadow", "Golden", "Wild", "Zany", "Xeno", "Quest", "Racer", "Legend"];
  const next = random(64);
  const insert = library.db.prepare(`INSERT INTO games (platform_id, group_key, title, release_date, hide, date_added)
    VALUES (?, ?, ?, ?, ?, 'now')`);
  library.db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const word = words[Math.floor(next() * words.length)]!;
      const title = `${word} ${words[Math.floor(next() * words.length)]} ${Math.floor(next() * 20)}`;
      const year = 1977 + Math.floor(next() * 28);
      insert.run(platform, `stress ${i}`, title, String(year), next() < 0.02 ? 1 : 0);
    }
  })();
}

/** Every visible game of a platform in wheel order, the slow way. */
function fullList(library: Library, platform: number) {
  return library.db
    .query<{ id: number; sort_key: string }, [number]>(
      "SELECT id, sort_key FROM games WHERE platform_id = ? AND hide = 0 ORDER BY sort_key, id",
    )
    .all(platform);
}

/** _jump_letter from frontend/scripts/main.gd, run over the full list. */
function bruteForceJump(keys: string[], from: number, direction: 1 | -1): number {
  const count = keys.length;
  const at = (i: number) => initial(keys[((i % count) + count) % count]!);
  const current = at(from);
  let index = from;
  for (let i = 0; i < count; i++) {
    index = (((index + direction) % count) + count) % count;
    if (at(index) !== current) break;
  }
  if (index === from) return from;
  if (direction < 0) {
    const letter = at(index);
    while (((index - 1 + count) % count) !== from && at(index - 1) === letter) {
      index = (index - 1 + count) % count;
    }
  }
  return index;
}

function time(run: () => void, repeats = 20): number {
  run();
  const started = performance.now();
  for (let i = 0; i < repeats; i++) run();
  return (performance.now() - started) / repeats;
}

describe("schema", () => {
  test("migrates a new database, and does nothing the second time", () => {
    const library = openLibrary(":memory:");
    const version = library.db.query("PRAGMA user_version").get() as { user_version: number };
    expect(version.user_version).toBe(SCHEMA_VERSION);
    expect(migrate(library.db)).toBe(SCHEMA_VERSION);
    expect(library.platforms()).toEqual([]);
    library.close();
  });

  test("sort keys drop leading articles unless a sort title is given", () => {
    const library = openLibrary(":memory:");
    const snes = platformId(library, "snes");
    const key = (title: string, sortTitle?: string) => addGame(library, snes, title, { sortTitle }).sort_key;
    expect(key("The Legend of Zelda")).toBe("legend of zelda");
    expect(key("A Boy and His Blob")).toBe("boy and his blob");
    expect(key("An American Tail")).toBe("american tail");
    expect(key("  Metroid ")).toBe("metroid");
    expect(key("The")).toBe("the");
    expect(key("Theme Park")).toBe("theme park");
    expect(key("Another World")).toBe("another world");
    expect(key("The Legend of Zelda", "Zelda 1")).toBe("zelda 1");
    expect(key("The Legend of Zelda", "  ")).toBe("legend of zelda");
    library.close();
  });

  test("release years come from release dates", () => {
    const library = openLibrary(":memory:");
    const { id } = addGame(library, platformId(library, "nes"), "Metroid", { date: "1986-08-06" });
    expect(library.db.query("SELECT release_year FROM games WHERE id = ?").get(id)).toEqual({ release_year: 1986 });
    library.close();
  });

  test("a game holds one title per platform", () => {
    const library = openLibrary(":memory:");
    const insert = () => library.db.run(
      "INSERT INTO games (platform_id, group_key, title, date_added) VALUES (?, 'metroid', 'Metroid', 'now')",
      [platformId(library, "nes")],
    );
    insert();
    expect(insert).toThrow("UNIQUE");
    library.close();
  });

  test("deleting a game deletes its files and images", () => {
    const library = openLibrary(":memory:");
    const { db } = library;
    const { id } = addGame(library, platformId(library, "nes"), "Metroid");
    db.run(`INSERT INTO rom_files (game_id, path, size, mtime_ms, title, scanned_at) VALUES (?, '/m.nes', 1, 1, 'Metroid', 'now')`, [id]);
    db.run(`INSERT INTO game_images (game_id, type, provider) VALUES (?, 'box-front', 'test')`, [id]);
    db.run("DELETE FROM games WHERE id = ?", [id]);
    expect(db.query("SELECT (SELECT COUNT(*) FROM rom_files) + (SELECT COUNT(*) FROM game_images) AS n").get()).toEqual({ n: 0 });
    library.close();
  });
});

describe("platforms", () => {
  test("follow the platform table, and keep the user's settings", async () => {
    const folder = await mkdtemp(join(tmpdir(), "beamrider-library-"));
    try {
      const path = join(folder, "library.db");
      const library = openLibrary(path);
      const snes = "SELECT name, maker, year, color FROM platforms WHERE slug = 'snes'";
      expect(library.db.query("SELECT COUNT(*) AS n FROM platforms").get()).toEqual({ n: PLATFORMS.length });
      expect(library.db.query(snes).get()).toEqual({ name: "SNES", maker: "Nintendo", year: 1990, color: null });
      library.db.run(`UPDATE platforms SET color = '#6a4fb3', name = 'Old name', custom_name = 'Super Famicom'
        WHERE slug = 'snes'`);
      library.close();
      // Opening again restores the name from the code and keeps the user's settings.
      const reopened = openLibrary(path);
      expect(reopened.db.query(snes).get()).toEqual({ name: "SNES", maker: "Nintendo", year: 1990, color: "#6a4fb3" });
      expect(reopened.db.query("SELECT custom_name FROM platforms WHERE slug = 'snes'").get())
        .toEqual({ custom_name: "Super Famicom" });
      reopened.close();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  test("are the ones with visible games, sorted by sort title or name", () => {
    const library = openLibrary(":memory:");
    const { db } = library;
    db.run("UPDATE platforms SET sort_title = 'Nintendo SNES', color = '#6a4fb3' WHERE slug = 'snes'");
    addGame(library, platformId(library, "snes"), "F-Zero");
    addGame(library, platformId(library, "snes"), "Secret", { hide: 1 });
    addGame(library, platformId(library, "atari2600"), "Pitfall!");
    addGame(library, platformId(library, "megadrive"), "Sonic");
    addGame(library, platformId(library, "nes"), "Hidden only", { hide: 1 });
    expect(library.platforms().map((p) => [p.name, p.game_count])).toEqual([
      ["Atari 2600", 1],
      ["Mega Drive", 1],
      ["SNES", 1],
    ]);
    expect(library.platforms()[0]).toEqual({
      id: platformId(library, "atari2600"), name: "Atari 2600", manufacturer: "Atari", release_year: 1977, color: null, game_count: 1,
    });
    library.close();
  });

  test("show a custom name in place of the code's, and sort by it", () => {
    const library = openLibrary(":memory:");
    addGame(library, platformId(library, "megadrive"), "Sonic");
    addGame(library, platformId(library, "atari2600"), "Pitfall!");
    library.db.run("UPDATE platforms SET custom_name = 'Genesis' WHERE slug = 'megadrive'");
    library.db.run("UPDATE platforms SET custom_name = '  ' WHERE slug = 'atari2600'");
    expect(library.platforms().map((p) => p.name)).toEqual(["Atari 2600", "Genesis"]);
    library.db.run("UPDATE platforms SET custom_name = 'Video Computer System' WHERE slug = 'atari2600'");
    expect(library.platforms().map((p) => p.name)).toEqual(["Genesis", "Video Computer System"]);
    library.close();
  });
});

describe("card art", () => {
  function seedArt(options?: Parameters<typeof openLibrary>[1]) {
    const library = openLibrary(":memory:", options);
    const nes = platformId(library, "nes");
    const ids = ["Alpha", "Bravo not downloaded", "Charlie logo only"].map((title) => addGame(library, nes, title).id);
    const image = library.db.prepare(
      "INSERT INTO game_images (game_id, type, region, provider, url, crc32, path) VALUES (?1, ?2, ?3, 'test', 'http://x/' || ?4, ?4, ?5)",
    );
    image.run(ids[0]!, "box-front", "Japan", 11, "jp/jp.jpg");
    image.run(ids[0]!, "box-front", "North America", 22, "na/na.jpg");
    image.run(ids[0]!, "box-front", "World", 33, null);
    image.run(ids[1]!, "box-front", "North America", 55, null);
    image.run(ids[2]!, "logo", null, 66, "lo/logo.png");
    return { library, nes };
  }

  test("is the best downloaded front box, by region", () => {
    const { library, nes } = seedArt();
    expect(library.gamesPage(nes, 0, 10).map((game) => [game.title, game.art])).toEqual([
      ["Alpha", "/art/512/na/na.jpg?v=22"],
      ["Bravo not downloaded", null],
      ["Charlie logo only", null],
    ]);
    library.close();
  });

  test("follows the configured region order", () => {
    const { library, nes } = seedArt({ artRegions: ["Japan"] });
    expect(library.gamesPage(nes, 0, 1)[0]!.art).toBe("/art/512/jp/jp.jpg?v=11");
    library.close();
  });
});

describe(`a platform with ${STRESS_GAMES.toLocaleString("en")} games`, () => {
  let library: Library;
  let stress: number;
  let small: number;
  let keys: string[];
  let ids: number[];

  beforeAll(() => {
    library = openLibrary(":memory:");
    small = platformId(library, "nes");
    stress = platformId(library, "snes");
    addGame(library, small, "Metroid");
    seedStressGames(library, stress, STRESS_GAMES);
    // Front box art for every game, half of it downloaded, so the timing
    // below includes the art lookup.
    library.db.run(`INSERT INTO game_images (game_id, type, region, provider, crc32, path)
      SELECT id, 'box-front', 'North America', 'test', id,
        CASE WHEN id % 2 = 0 THEN substr('0' || id, -2) || '/' || id || '.jpg' END
      FROM games WHERE platform_id = ?`, [stress]);
    const list = fullList(library, stress);
    keys = list.map((row) => row.sort_key);
    ids = list.map((row) => row.id);
  });

  test("pages add up to the full sorted list, without hidden games", () => {
    const paged: number[] = [];
    for (let offset = 0; ; offset += 200) {
      const rows = library.gamesPage(stress, offset, 200);
      if (rows.length === 0) break;
      paged.push(...rows.map((row) => row.id));
    }
    expect(paged).toEqual(ids);
    const art = library.gamesPage(stress, 0, 200).map((row) => row.art);
    expect(art.filter(Boolean).length).toBeGreaterThan(50);
    expect(art.every((url, i) => (url === null) === (ids[i]! % 2 === 1))).toBe(true);
    expect(ids.length).toBeLessThan(STRESS_GAMES);
    expect(library.platforms().find((p) => p.id === stress)!.game_count).toBe(ids.length);
  });

  test("pages are capped and clamped", () => {
    expect(library.gamesPage(stress, 0, 10_000)).toHaveLength(200);
    expect(library.gamesPage(stress, -5, 3).map((row) => row.id)).toEqual(ids.slice(0, 3));
    expect(library.gamesPage(stress, ids.length, 100)).toEqual([]);
  });

  test("letter jumps match the Godot frontend's, both ways and across the wrap", () => {
    const next = random(7);
    const starts = [0, 1, ids.length - 1, ids.length - 2];
    for (let i = 0; i < 300; i++) starts.push(Math.floor(next() * ids.length));
    // The API returns null where the Godot version would stay put.
    const expected = (from: number, direction: 1 | -1) => {
      const index = bruteForceJump(keys, from, direction);
      return index === from ? null : index;
    };
    for (const from of starts) {
      expect([from, library.letterJump(stress, ids[from]!, 1)]).toEqual([from, expected(from, 1)]);
      expect([from, library.letterJump(stress, ids[from]!, -1)]).toEqual([from, expected(from, -1)]);
    }
  });

  test("letter jumps on tiny lists", () => {
    const metroid = fullList(library, small)[0]!.id;
    expect(library.letterJump(small, metroid, 1)).toBeNull();
    const same = platformId(library, "gb");
    for (const title of ["Mario", "Metroid", "Mother"]) addGame(library, same, title);
    const mario = fullList(library, same)[0]!.id;
    expect(library.letterJump(same, mario, 1)).toBeNull();
    expect(library.letterJump(same, mario, -1)).toBeNull();
    // Not a game of that platform.
    expect(library.letterJump(small, mario, 1)).toBeNull();
  });

  test("the page query walks the wheel index without sorting", () => {
    const plan = library.db
      .query<{ detail: string }, [number]>(
        "EXPLAIN QUERY PLAN SELECT id, title, release_year FROM games WHERE platform_id = ? AND hide = 0 ORDER BY sort_key, id LIMIT 100 OFFSET 89000",
      )
      .all(stress)
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("games_wheel");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  test("a page at the far end, with art, and a letter jump each take under 5 ms", () => {
    const page = time(() => library.gamesPage(stress, ids.length - 100, 100));
    const jump = time(() => library.letterJump(stress, ids[ids.length - 1]!, -1));
    console.log(`page with art at offset ${ids.length - 100}: ${page.toFixed(2)} ms, letter jump: ${jump.toFixed(2)} ms`);
    expect(page).toBeLessThan(5);
    expect(jump).toBeLessThan(5);
  });
});
