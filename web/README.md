# BeamRider web

A web version of the BeamRider frontend: a 3D carousel of platforms, then of each platform's games, built with React and CSS 3D transforms (no canvas or WebGL). The Bun server reads the library from SQLite, and the browser loads games a page at a time as the wheel turns, so it handles platforms with 100,000+ games.

Keys: ← → browse (hold to speed up), PageUp/PageDown jump to the next letter, Enter select, Esc back. The mouse wheel also browses.

```bash
bun install
bun dev                    # development server with hot reloading
bun test                   # tests, including a 100,000-game platform
bun check                  # type check
bun run build              # production build in dist/
bun start                  # production server
bun run import:launchbox   # import the LaunchBox Games Database
bun run import:images      # download artwork
```

## Layout

- `src/components/Carousel.tsx` is a stateless port of the Godot spinner (`frontend/scripts/spinner.gd`).
- `src/App.tsx` drives the two-level navigation, like `frontend/scripts/main.gd`.
- `src/library/` is the client side of the library: API types (shared with the server), TanStack Query definitions and `useGamePages`, which loads pages of games around the selection.
- `src/server/` is the server side:
  - `schema.ts`: tables and migrations.
  - `library.ts`: the wheel's queries.
  - `art.ts`: card art thumbnails.
  - `launchbox.ts`: the LaunchBox importer.
  - `images.ts`: the image downloader.
  - `config.ts`: settings.
- `scripts/` holds the import commands.

## Settings

All are optional; see `.env.example`. Relative paths are from this folder.

- `LIBRARY_DB_PATH`: the library database. Default `data/library.db`.
- `LIBRARY_MEDIA_PATH`: downloaded artwork. Default `data/media`.
- `LIBRARY_ART_REGIONS`: whose box art cards show when a game has several, best first. Default North America, United States, World, Europe, United Kingdom, Japan.

## Library database

If the database doesn't exist, it is created empty with the schema, and the app shows an empty library until it's populated. The schema version is `PRAGMA user_version`; the server applies pending migrations on startup.

The schema follows LaunchBox:

- `platform_categories` is a tree (Consoles › Nintendo …), and `platform_category_platforms` places platforms in it (a platform can be in several categories).
- `platforms` has LaunchBox's fields plus BeamRider's `color` for the card.
- `games` belong to one platform and have LaunchBox's fields: title and optional `sort_title`, release date, developer, publisher, series, ratings, favorite/completed/broken/hide flags, play stats.
  - `sort_key` is generated: the sort title, or the title without a leading "The", "A" or "An", lowercased.
  - `release_year` is generated from `release_date`.
  - `launchbox_db_id` matches a game to the LaunchBox Games Database.
- `platform_alternate_names` and `game_alternate_names`.
- `game_images` lists every known image of a game (type, region, source, CRC32). `path` is set, relative to the media folder, once the file is downloaded.
- `genres` and `game_genres` (many to many), `additional_applications` (extra discs, alternate versions) and `playlists` with `playlist_games`.

The wheel lists a platform's games where `hide = 0`, in `sort_key, id` order, using the index `games_wheel (platform_id, hide, sort_key)`. Pages and letter jumps read only that index. At 100,000 games, the slowest page (at the far end) and a letter jump each take about 3 ms.

## Importing the LaunchBox Games Database

`bun run import:launchbox` downloads [Metadata.zip](https://gamesdb.launchbox-app.com/Metadata.zip) to `data/launchbox/` and imports it: about 190 platforms, 190,000 games and 1.3 million image entries, in about 30 seconds.
- The download is reused for 24 hours; `--refresh` forces a new one.
- The import is an upsert, so run it again for LaunchBox's updates. Your own fields (favorites, play stats, sort titles, card colors) and downloaded images are kept, and only images LaunchBox replaced are fetched again.

`bun run import:images` downloads artwork. Every image is listed in `game_images`, but by default it downloads only:
- every front box image (`Box - Front` and `Box - Front - Reconstructed`), about 230,000 files and ~240 GB;
- every image of the 50 most rated games (about 3,000 files).

It checks free space first (`--force` skips that) and shows progress. Stop it with Ctrl+C at any time; the next run carries on where it stopped. Expect about 3–4 hours at 20 MB/s.
- Options: `--types`, `--top`, `--limit`, `--concurrency` (default 8), `--retry-failed`.
- Failures are recorded in `game_images.error`.
- LaunchBox's CRC32 is out of date for some images; such an image is accepted when two downloads give identical bytes.

LaunchBox publishes no license for this data, so keep it local: `data/` is gitignored.

## Card art

Game cards show the game's best downloaded front box: a scan before a reconstruction, then by `LIBRARY_ART_REGIONS`. Until the image has loaded, or if there is none, the card shows the title.

Nothing is loaded at startup. The carousel renders an image only for the cards near the front, so art loads as the wheel turns.

The originals are large scans, so cards load `GET /art/512/<path>?v=<crc32>` instead.
- **First request:** shrinks the original to fit 512 px as WebP (about 30 ms) and caches it in `<media>/thumbs/`.
- **After that:** it's served from disk, with headers that let the browser cache it for good. The version in the URL changes when LaunchBox replaces an image.

## API

- `GET /api/platforms` lists platforms with visible game counts.
- `GET /api/platforms/:id/games?offset=&limit=` returns `{ offset, rows: [{ id, title, release_year, art }] }`. `art` is the card art URL, or null. `limit` is at most 200.
- `GET /api/platforms/:id/letter?game=&direction=1|-1` returns `{ index }`: where PageDown/PageUp goes from that game, or null.
- `GET /art/512/:shard/:file?v=` serves card art thumbnails.
