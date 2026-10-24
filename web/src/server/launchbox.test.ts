import { describe, expect, test } from "bun:test";
import { importLaunchBox } from "./launchbox";
import { openLibrary } from "./library";

/** A small Metadata.xml in LaunchBox's layout: games first, then the rest. */
function metadata({ zeldaTitle = "The Legend of Zelda", logoCrc = "222" } = {}) {
  return `<?xml version="1.0" standalone="yes"?>
<LaunchBox>
  <Game>
    <Name>${zeldaTitle}</Name>
    <ReleaseDate>1986-02-21T00:00:00+00:00</ReleaseDate>
    <Overview>Link &amp; the Triforce.

Second paragraph.</Overview>
    <MaxPlayers>1</MaxPlayers>
    <ReleaseType>Released</ReleaseType>
    <Cooperative>false</Cooperative>
    <DatabaseID>10</DatabaseID>
    <CommunityRating>4.5</CommunityRating>
    <Platform>Nintendo Entertainment System</Platform>
    <ESRB>E - Everyone</ESRB>
    <CommunityRatingCount>963</CommunityRatingCount>
    <Genres>Action; Adventure</Genres>
    <Developer>Nintendo</Developer>
    <Publisher>Nintendo</Publisher>
  </Game>
  <Game>
    <Name>Contra</Name>
    <ReleaseYear>1987</ReleaseYear>
    <MaxPlayers>-1</MaxPlayers>
    <Cooperative>true</Cooperative>
    <DatabaseID>11</DatabaseID>
    <Platform>Nintendo Entertainment System</Platform>
    <CommunityRatingCount>753</CommunityRatingCount>
    <Genres>Shooter</Genres>
  </Game>
  <Game>
    <Name>Sonic the Hedgehog</Name>
    <DatabaseID>12</DatabaseID>
    <Platform>Sega Genesis</Platform>
    <CommunityRatingCount>930</CommunityRatingCount>
    <Genres></Genres>
  </Game>
  <Platform>
    <Name>Nintendo Entertainment System</Name>
    <Emulated>true</Emulated>
    <ReleaseDate>1983-07-15T00:00:00+00:00</ReleaseDate>
    <Manufacturer>Nintendo</Manufacturer>
    <MaxControllers>2 (up to 4)</MaxControllers>
    <Category>Consoles</Category>
  </Platform>
  <Platform>
    <Name>Sega Genesis</Name>
    <Category>Consoles</Category>
  </Platform>
  <PlatformAlternateName>
    <Name>Nintendo Entertainment System</Name>
    <Alternate>Famicom</Alternate>
  </PlatformAlternateName>
  <Emulator>
    <Name>RetroArch</Name>
  </Emulator>
  <GameAlternateName>
    <AlternateName>Zelda no Densetsu</AlternateName>
    <DatabaseID>10</DatabaseID>
    <Region>Japan</Region>
  </GameAlternateName>
  <GameAlternateName>
    <AlternateName>Nobody</AlternateName>
    <DatabaseID>999</DatabaseID>
  </GameAlternateName>
  <GameImage>
    <DatabaseID>10</DatabaseID>
    <FileName>aaaa-box.jpg</FileName>
    <Type>Box - Front</Type>
    <Region>North America</Region>
    <CRC32>111</CRC32>
  </GameImage>
  <GameImage>
    <DatabaseID>10</DatabaseID>
    <FileName>bbbb-logo.png</FileName>
    <Type>Clear Logo</Type>
    <CRC32>${logoCrc}</CRC32>
  </GameImage>
  <GameImage>
    <DatabaseID>11</DatabaseID>
    <FileName>cccc-shot.png</FileName>
    <Type>Screenshot - Gameplay</Type>
    <CRC32>333</CRC32>
  </GameImage>
</LaunchBox>`;
}

/** Streams `xml` in small chunks, so records and characters span chunks. */
function stream(xml: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(xml);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + 37));
      offset += 37;
    },
  });
}

describe("LaunchBox import", () => {
  test("maps platforms, games, genres, names and images", async () => {
    const library = openLibrary(":memory:");
    const { db } = library;
    const summary = await importLaunchBox(db, stream(metadata()));
    expect(summary).toMatchObject({
      platforms: 2, games: 3, genres: 3, alternateNames: 1, images: 3, orphans: 1, skipped: { Emulator: 1 },
    });

    expect(
      db.query("SELECT name, release_date, manufacturer, max_controllers, emulated FROM platforms ORDER BY name").all(),
    ).toEqual([
      { name: "Nintendo Entertainment System", release_date: "1983-07-15", manufacturer: "Nintendo", max_controllers: "2 (up to 4)", emulated: 1 },
      { name: "Sega Genesis", release_date: null, manufacturer: null, max_controllers: null, emulated: 0 },
    ]);
    expect(db.query("SELECT name FROM platform_alternate_names").all()).toEqual([{ name: "Famicom" }]);
    expect(
      db.query(`SELECT c.name AS category, p.name AS platform FROM platform_category_platforms l
        JOIN platform_categories c ON c.id = l.category_id JOIN platforms p ON p.id = l.platform_id ORDER BY p.name`).all(),
    ).toEqual([
      { category: "Consoles", platform: "Nintendo Entertainment System" },
      { category: "Consoles", platform: "Sega Genesis" },
    ]);

    const zelda = db.query("SELECT * FROM games WHERE launchbox_db_id = 10").get() as Record<string, unknown>;
    expect(zelda).toMatchObject({
      title: "The Legend of Zelda", sort_key: "legend of zelda", release_date: "1986-02-21", release_year: 1986,
      notes: "Link & the Triforce.\n\nSecond paragraph.", max_players: 1, cooperative: 0,
      community_star_rating: 4.5, community_rating_count: 963, rating: "E - Everyone", developer: "Nintendo",
    });
    expect(db.query("SELECT release_date, max_players, cooperative FROM games WHERE launchbox_db_id = 11").get())
      .toEqual({ release_date: "1987", max_players: null, cooperative: 1 });
    expect(
      db.query(`SELECT g.name FROM game_genres gg JOIN genres g ON g.id = gg.genre_id
        WHERE gg.game_id = ? ORDER BY g.name`).all(zelda.id as number),
    ).toEqual([{ name: "Action" }, { name: "Adventure" }]);
    expect(db.query("SELECT name, region FROM game_alternate_names").all())
      .toEqual([{ name: "Zelda no Densetsu", region: "Japan" }]);
    expect(db.query("SELECT type, region, source, source_name, crc32, path FROM game_images ORDER BY source_name").all()).toEqual([
      { type: "Box - Front", region: "North America", source: "launchbox", source_name: "aaaa-box.jpg", crc32: 111, path: null },
      { type: "Clear Logo", region: null, source: "launchbox", source_name: "bbbb-logo.png", crc32: 222, path: null },
      { type: "Screenshot - Gameplay", region: null, source: "launchbox", source_name: "cccc-shot.png", crc32: 333, path: null },
    ]);
    expect(library.platforms().map((p) => [p.name, p.game_count])).toEqual([
      ["Nintendo Entertainment System", 2],
      ["Sega Genesis", 1],
    ]);
    library.close();
  });

  test("a second import updates LaunchBox's fields and keeps the user's", async () => {
    const library = openLibrary(":memory:");
    const { db } = library;
    await importLaunchBox(db, stream(metadata()));
    db.run("UPDATE games SET favorite = 1, play_count = 7, sort_title = 'Zelda 1' WHERE launchbox_db_id = 10");
    db.run("UPDATE platforms SET color = '#c8102e' WHERE name = 'Nintendo Entertainment System'");
    db.run("UPDATE game_images SET path = 'aa/aaaa-box.jpg', bytes = 5 WHERE source_name IN ('aaaa-box.jpg', 'bbbb-logo.png')");

    // Zelda is renamed, the logo is replaced (new CRC) and the screenshot is gone.
    const changed = metadata({ zeldaTitle: "The Legend of Zelda (Rev 1)", logoCrc: "999" })
      .replace(/<GameImage>\s*<DatabaseID>11<\/DatabaseID>[\s\S]*?<\/GameImage>/, "");
    const summary = await importLaunchBox(db, stream(changed));
    expect(summary.removedImages).toBe(1);

    expect(db.query("SELECT COUNT(*) AS n FROM games").get()).toEqual({ n: 3 });
    expect(db.query("SELECT title, favorite, play_count, sort_key FROM games WHERE launchbox_db_id = 10").get())
      .toEqual({ title: "The Legend of Zelda (Rev 1)", favorite: 1, play_count: 7, sort_key: "zelda 1" });
    expect(db.query("SELECT color FROM platforms WHERE name = 'Nintendo Entertainment System'").get())
      .toEqual({ color: "#c8102e" });
    expect(db.query("SELECT source_name, crc32, path FROM game_images ORDER BY source_name").all()).toEqual([
      { source_name: "aaaa-box.jpg", crc32: 111, path: "aa/aaaa-box.jpg" },
      { source_name: "bbbb-logo.png", crc32: 999, path: null },
    ]);
    expect(db.query("SELECT COUNT(*) AS n FROM game_genres").get()).toEqual({ n: 3 });
    library.close();
  });

  test("a broken file rolls the whole import back", async () => {
    const library = openLibrary(":memory:");
    const broken = metadata().replace("</LaunchBox>", "<Game><Name>Unclosed</Game>");
    expect(importLaunchBox(library.db, stream(broken))).rejects.toThrow();
    await Bun.sleep(0);
    expect(library.db.query("SELECT COUNT(*) AS n FROM games").get()).toEqual({ n: 0 });
    library.close();
  });
});
