import { beforeAll, describe, expect, test } from "bun:test";
import { initial, openLibrary, type Library } from "./library";
import { migrate, SCHEMA_VERSION } from "./schema";

const STRESS_GAMES = 100_000;

function sortKeyOf(library: Library, title: string, sortTitle: string | null = null): string {
  const { db } = library;
  db.run("INSERT OR IGNORE INTO platforms (id, name) VALUES (999, 'Sort keys')");
  const row = db
    .query<{ sort_key: string }, { title: string; sortTitle: string | null }>(
      "INSERT INTO games (platform_id, title, sort_title) VALUES (999, $title, $sortTitle) RETURNING sort_key",
    )
    .get({ title, sortTitle });
  return row!.sort_key;
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

/** Like the Godot frontend's stress test platform, with repeats and hidden games. */
function seedStressPlatform(library: Library, id: number, count: number) {
  const words = ["Super", "Mega", "The Ultra", "Hyper", "A Turbo", "Final", "Dark", "Cosmic", "Neon",
    "Iron", "Crystal", "Shadow", "Golden", "Wild", "Zany", "Xeno", "Quest", "Racer", "Legend"];
  const next = random(64);
  const { db } = library;
  db.run("INSERT INTO platforms (id, name, color) VALUES (?, ?, ?)", [id, "Stress Test", "#00b3a4"]);
  const insert = db.prepare(
    "INSERT INTO games (platform_id, title, release_date, hide) VALUES (?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const word = words[Math.floor(next() * words.length)]!;
      const title = `${word} ${words[Math.floor(next() * words.length)]} ${Math.floor(next() * 20)}`;
      const year = 1977 + Math.floor(next() * 28);
      insert.run(id, title, String(year), next() < 0.02 ? 1 : 0);
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
    expect(sortKeyOf(library, "The Legend of Zelda")).toBe("legend of zelda");
    expect(sortKeyOf(library, "A Boy and His Blob")).toBe("boy and his blob");
    expect(sortKeyOf(library, "An American Tail")).toBe("american tail");
    expect(sortKeyOf(library, "  Metroid ")).toBe("metroid");
    expect(sortKeyOf(library, "The")).toBe("the");
    expect(sortKeyOf(library, "Theme Park")).toBe("theme park");
    expect(sortKeyOf(library, "Another World")).toBe("another world");
    expect(sortKeyOf(library, "The Legend of Zelda", "Zelda 1")).toBe("zelda 1");
    expect(sortKeyOf(library, "The Legend of Zelda", "  ")).toBe("legend of zelda");
    library.close();
  });

  test("release years come from release dates", () => {
    const library = openLibrary(":memory:");
    library.db.run("INSERT INTO platforms (id, name, release_date) VALUES (1, 'NES', '1983-07-15')");
    expect(library.platforms()[0]!.release_year).toBe(1983);
    library.close();
  });

  test("deleting a platform deletes its games", () => {
    const library = openLibrary(":memory:");
    const { db } = library;
    db.run("INSERT INTO platforms (id, name) VALUES (1, 'NES')");
    db.run("INSERT INTO games (platform_id, title) VALUES (1, 'Metroid'), (1, 'Kid Icarus')");
    db.run("DELETE FROM platforms WHERE id = 1");
    expect(db.query("SELECT COUNT(*) AS n FROM games").get()).toEqual({ n: 0 });
    library.close();
  });
});

describe("platforms", () => {
  test("are sorted by sort title or name, with visible game counts", () => {
    const library = openLibrary(":memory:");
    const { db } = library;
    db.run(`INSERT INTO platforms (id, name, sort_title, color) VALUES
      (1, 'Super Nintendo', 'Nintendo SNES', '#6a4fb3'), (2, 'Atari 2600', NULL, NULL), (3, 'mega drive', NULL, NULL)`);
    db.run(`INSERT INTO games (platform_id, title, hide) VALUES (1, 'F-Zero', 0), (1, 'Secret', 1), (2, 'Pitfall!', 0)`);
    expect(library.platforms().map((p) => [p.name, p.game_count])).toEqual([
      ["Atari 2600", 1],
      ["mega drive", 0],
      ["Super Nintendo", 1],
    ]);
    library.close();
  });
});

describe("card art", () => {
  function seedArt(options?: Parameters<typeof openLibrary>[1]) {
    const library = openLibrary(":memory:", options);
    const { db } = library;
    db.run("INSERT INTO platforms (id, name) VALUES (1, 'NES')");
    db.run(`INSERT INTO games (id, platform_id, title) VALUES
      (1, 1, 'Alpha scanned'), (2, 1, 'Bravo reconstructed'), (3, 1, 'Charlie not downloaded'), (4, 1, 'Delta logo only')`);
    const image = db.prepare(
      "INSERT INTO game_images (game_id, type, region, source, source_name, crc32, path) VALUES (?, ?, ?, 'launchbox', ?, ?, ?)",
    );
    image.run(1, "Box - Front", "Japan", "jp.jpg", 11, "jp/jp.jpg");
    image.run(1, "Box - Front", "North America", "na.jpg", 22, "na/na.jpg");
    image.run(1, "Box - Front", "World", "world.jpg", 33, null);
    image.run(1, "Box - Front - Reconstructed", "North America", "rec.jpg", 44, "re/rec.jpg");
    image.run(2, "Box - Front - Reconstructed", null, "rec2.jpg", null, "re/rec2.jpg");
    image.run(3, "Box - Front", "North America", "later.jpg", 55, null);
    image.run(4, "Clear Logo", null, "logo.png", 66, "lo/logo.png");
    return library;
  }

  test("is the best downloaded front box: scans first, then by region", () => {
    const library = seedArt();
    expect(library.gamesPage(1, 0, 10).map((game) => [game.title, game.art])).toEqual([
      ["Alpha scanned", "/art/512/na/na.jpg?v=22"],
      ["Bravo reconstructed", "/art/512/re/rec2.jpg?v=0"],
      ["Charlie not downloaded", null],
      ["Delta logo only", null],
    ]);
    library.close();
  });

  test("follows the configured region order", () => {
    const library = seedArt({ artRegions: ["Japan"] });
    expect(library.gamesPage(1, 0, 1)[0]!.art).toBe("/art/512/jp/jp.jpg?v=11");
    library.close();
  });
});

describe(`a platform with ${STRESS_GAMES.toLocaleString("en")} games`, () => {
  let library: Library;
  let keys: string[];
  let ids: number[];

  beforeAll(() => {
    library = openLibrary(":memory:");
    library.db.run("INSERT INTO platforms (id, name) VALUES (1, 'Small')");
    library.db.run("INSERT INTO games (platform_id, title) VALUES (1, 'Metroid')");
    seedStressPlatform(library, 2, STRESS_GAMES);
    // Front box art for every game, half of it downloaded, so the timing
    // below includes the art lookup.
    library.db.run(`INSERT INTO game_images (game_id, type, region, source, source_name, crc32, path)
      SELECT id, 'Box - Front', 'North America', 'launchbox', id || '.jpg', id,
        CASE WHEN id % 2 = 0 THEN substr('0' || id, -2) || '/' || id || '.jpg' END
      FROM games WHERE platform_id = 2`);
    const list = fullList(library, 2);
    keys = list.map((row) => row.sort_key);
    ids = list.map((row) => row.id);
  });

  test("pages add up to the full sorted list, without hidden games", () => {
    const paged: number[] = [];
    for (let offset = 0; ; offset += 200) {
      const rows = library.gamesPage(2, offset, 200);
      if (rows.length === 0) break;
      paged.push(...rows.map((row) => row.id));
    }
    expect(paged).toEqual(ids);
    const art = library.gamesPage(2, 0, 200).map((row) => row.art);
    expect(art.filter(Boolean).length).toBeGreaterThan(50);
    expect(art.every((url, i) => (url === null) === (ids[i]! % 2 === 1))).toBe(true);
    expect(ids.length).toBeLessThan(STRESS_GAMES);
    expect(library.platforms().find((p) => p.id === 2)!.game_count).toBe(ids.length);
  });

  test("pages are capped and clamped", () => {
    expect(library.gamesPage(2, 0, 10_000)).toHaveLength(200);
    expect(library.gamesPage(2, -5, 3).map((row) => row.id)).toEqual(ids.slice(0, 3));
    expect(library.gamesPage(2, ids.length, 100)).toEqual([]);
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
      expect([from, library.letterJump(2, ids[from]!, 1)]).toEqual([from, expected(from, 1)]);
      expect([from, library.letterJump(2, ids[from]!, -1)]).toEqual([from, expected(from, -1)]);
    }
  });

  test("letter jumps on tiny lists", () => {
    const metroid = fullList(library, 1)[0]!.id;
    expect(library.letterJump(1, metroid, 1)).toBeNull();
    library.db.run("INSERT INTO platforms (id, name) VALUES (3, 'Same letter')");
    library.db.run("INSERT INTO games (platform_id, title) VALUES (3, 'Mario'), (3, 'Metroid'), (3, 'Mother')");
    const mario = fullList(library, 3)[0]!.id;
    expect(library.letterJump(3, mario, 1)).toBeNull();
    expect(library.letterJump(3, mario, -1)).toBeNull();
    // Not a game of that platform, or hidden.
    expect(library.letterJump(1, mario, 1)).toBeNull();
  });

  test("the page query walks the wheel index without sorting", () => {
    const plan = library.db
      .query<{ detail: string }, []>(
        "EXPLAIN QUERY PLAN SELECT id, title, release_year FROM games WHERE platform_id = 2 AND hide = 0 ORDER BY sort_key, id LIMIT 100 OFFSET 99000",
      )
      .all()
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("games_wheel");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  test("a page at the far end, with art, and a letter jump each take under 5 ms", () => {
    const page = time(() => library.gamesPage(2, ids.length - 100, 100));
    const jump = time(() => library.letterJump(2, ids[ids.length - 1]!, -1));
    console.log(`page with art at offset ${ids.length - 100}: ${page.toFixed(2)} ms, letter jump: ${jump.toFixed(2)} ms`);
    expect(page).toBeLessThan(5);
    expect(jump).toBeLessThan(5);
  });
});
