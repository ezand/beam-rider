# BeamRider web

A web version of the BeamRider frontend: a 3D carousel of platforms, then of each platform's games, built with React and CSS 3D transforms (no canvas or WebGL). The Bun server reads the library from SQLite, and the browser loads games a page at a time as the wheel turns, so it handles platforms with 100,000+ games.

The library holds your games only: the ROM scanner builds it from your files, identifying them with the No-Intro and Redump reference lists. Metadata and artwork come later from scrapers; the schema has neutral fields for them.

Keys: ← → browse (hold to speed up), PageUp/PageDown jump to the next letter, Enter select, Esc back. The mouse wheel also browses.

```bash
bun install
bun dev                # development server with hot reloading
bun test               # tests, including a 100,000-game platform
bun check              # type check
bun run build          # production build in dist/
bun start              # production server
bun run import:dats    # import the No-Intro and Redump reference lists
bun run scan           # scan your ROM folders
```

To set up a library: set `LIBRARY_ROM_ROOTS` in `.env`, then run `import:dats` and `scan`.

## Layout

- `src/components/Carousel.tsx` is a stateless port of the Godot spinner (`frontend/scripts/spinner.gd`).
- `src/App.tsx` drives the two-level navigation, like `frontend/scripts/main.gd`.
- `src/library/` is the client side of the library: API types (shared with the server), TanStack Query definitions and `useGamePages`, which loads pages of games around the selection.
- `src/server/` is the server side:
  - `schema.ts`: tables and migrations.
  - `library.ts`: the wheel's queries.
  - `art.ts`: card art thumbnails.
  - `scanner/`: the ROM scanner:
    - `platforms.ts`: the platforms BeamRider knows;
    - `dat.ts`: the DAT reference lists;
    - `names.ts`: dump names and title keys;
    - `archives.ts`: zip and 7z listings;
    - `hash.ts`: checksums;
    - `scan.ts`: the scan itself.
  - `config.ts`: settings.
- `scripts/` holds the commands.

## Settings

All are optional; see `.env.example`. Relative paths are from this folder.

- `LIBRARY_DB_PATH`: the library database. Default `data/library.db`.
- `LIBRARY_DATS_PATH`: the DAT reference database. Default `data/dats.db`.
- `LIBRARY_ROM_ROOTS`: your ROM folders, separated by `:` (`;` on Windows). Default `data/roms`.
- `LIBRARY_ROM_PLATFORMS`: platforms for folder names the scanner doesn't know, as `folder=platform` pairs (by slug or name) separated by `;`.
- `LIBRARY_MEDIA_PATH`: downloaded artwork. Default `data/media`.
- `LIBRARY_ART_REGIONS`: whose box art cards show when a game has several, best first. Default North America, USA, World, Europe, United Kingdom, Japan.

## Library database

If the database doesn't exist, it is created empty with the schema. The schema version is `PRAGMA user_version`; pending migrations are applied when it's opened.

- `platforms` are BeamRider's own, synced from `src/server/scanner/platforms.ts` whenever the library opens: slug, short name (SNES, PlayStation), maker and year. Your `color` and `sort_title` are kept. Only platforms with games appear on the wheel.
- `games` are your games: one per title on a platform, so regional versions and revisions are files of one game.
  - `group_key` is the title key the files are grouped by.
  - `sort_key` is generated: the sort title, or the title without a leading "The", "A" or "An", lowercased.
  - The other fields (release date, developer, publisher, players, rating, description) are neutral, for scrapers to fill. Favorite, hidden and play stats are yours.
  - A game is removed when its last file goes.
- `rom_files` are your game files: path, size, checksums, how each was identified, its DAT name, region and tags.
- `game_images` holds artwork from providers, with neutral types (`box-front`, `logo`, `screenshot`, …). `path` is set once a file is downloaded.
- `genres`/`game_genres` and `playlists`/`playlist_games`.

The wheel lists a platform's visible games in `sort_key, id` order through the index `games_wheel (platform_id, hide, sort_key)`. Pages and letter jumps read only that index. At 100,000 games, the slowest page (at the far end) and a letter jump each take about 3 ms.

The DATs are kept apart from the library, in `data/dats.db`, since they list games you don't have.

## Scanning your games

`bun run scan` finds your game files and builds the library's games from them.

**Folders.** Each folder in `LIBRARY_ROM_ROOTS` that's named like a platform, and each such folder inside one, is scanned. Names are compared ignoring case and punctuation:
- RetroPie and ES-DE short names, such as `snes`, `megadrive` or `psx`;
- platform names, both BeamRider's short ones ("SNES") and LaunchBox's full ones ("Super Nintendo Entertainment System");
- No-Intro and Redump names, such as "Nintendo - Super Nintendo Entertainment System".

Other folders are listed by the scan, so you can rename them or map them with `LIBRARY_ROM_PLATFORMS`. About 60 consoles, handhelds, disc systems and computers are supported. Arcade and Neo Geo folders are recognized but not scanned yet.

**Files.** In a platform folder, the scanner reads files with that platform's extensions, plus zip and 7z archives.
- Subfolders are included, apart from art folders such as `media` and `images`, and hidden files.
- A `.cue`, `.gdi` or `.m3u` is one game together with the files it lists, so a multi-disc game is one entry.

**Identifying games.** Each file is identified by the first of these that works:
1. **Its checksum in a DAT.** Archives are checked by the CRC32 in their directory, without unpacking. Copier headers (SNES, Atari 7800, Lynx, FDS) are removed before hashing.
2. **Its name as a DAT game name.** Disc images are identified this way, since they're too large to hash.

Its title comes from that DAT name, or else from the file name: "Legend of Zelda, The - A Link to the Past (USA) (Rev 1)" gives the title "The Legend of Zelda - A Link to the Past", region USA and tag Rev 1. Files with the same title key on a platform are one game. The key ignores case, punctuation, accents and a leading article, so other regions and revisions join the same game.

**Rescans.** Only new and changed files are hashed (`--full` hashes everything again), so a rescan of an unchanged collection takes seconds. Identification runs again each time, so a newer DAT import improves matches without rehashing.
- Files that are gone are removed.
- Files under a root that's missing, such as an unplugged drive, are kept until it's back.

**7z archives** need the 7-Zip command line tool (`7zz` or `7z`) to be identified by checksum; without it they're identified by name.

`bun run import:dats` downloads the DATs of the supported platforms from [libretro-database](https://github.com/libretro/libretro-database) (CC BY-SA 4.0) to `data/dats/`, and loads them into `data/dats.db` (about 100,000 entries, 20 seconds). Copies are reused for a week; `--refresh` downloads them again.

## Card art

Game cards show the game's best downloaded front box (`box-front` in `game_images`), by `LIBRARY_ART_REGIONS`. Until the image has loaded, or if there is none, the card shows the title.

Nothing is loaded at startup. The carousel renders an image only for the cards near the front, so art loads as the wheel turns.

Originals are often large scans, so cards load `GET /art/512/<path>?v=<crc32>` instead.
- **First request:** shrinks the original to fit 512 px as WebP (about 30 ms) and caches it in `<media>/thumbs/`.
- **After that:** it's served from disk, with headers that let the browser cache it for good. The version in the URL changes when an image is replaced.

## API

- `GET /api/platforms` lists the platforms with games, with their counts.
- `GET /api/platforms/:id/games?offset=&limit=` returns `{ offset, rows: [{ id, title, release_year, art }] }`. `art` is the card art URL, or null. `limit` is at most 200.
- `GET /api/platforms/:id/letter?game=&direction=1|-1` returns `{ index }`: where PageDown/PageUp goes from that game, or null.
- `GET /art/512/:shard/:file?v=` serves card art thumbnails.
