# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the BeamRider frontend, the Godot app in `frontend/`. Paths below are relative to this folder (the Godot project root, `res://`). See the root `CLAUDE.md` for the repository layout.

## Project state

BeamRider is a 3D frontend for browsing retro games. So far it is a single main scene with a spinner menu. No games launch yet.

**Aim for a simple setup for the user.** Give every setting a sensible default so the app works without opening the settings, and treat missing data (no art, a folder that doesn't exist, an empty setting) as a normal case with a standard rendering, not an error.

- `scenes/main.tscn` is the main scene. It holds the camera, lighting, environment (glow + SSR), a reflective floor, the `Spinner`, and a `CanvasLayer` UI.
- `scripts/spinner.gd` (`class_name Spinner`) is a virtualized carousel. Items sit on an arc and the selected one rests at the node's origin facing +Z. Only the ~15 items near the front exist as nodes; they are pooled and re-bound as the wheel turns, so cost doesn't grow with list size (tested at 10,000 items: 43 nodes, ~0.1–0.3 ms per frame). Feed it with `set_source(count, provider, start_index)`, where `provider(index) -> Dictionary` returns `name`, optional `subtitle`, `color`, and optional `art` (Texture2D; replaces the labels on the card face), and is called only when an item becomes visible. `set_items(array)` is a wrapper for in-memory lists. `move(steps)` and `jump_to(index)` change the selection, and `selection_changed(index)` fires; `settled(index)` fires once the wheel has (nearly) stopped, and on `set_source`. `refresh(index)` re-asks the provider for an on-screen item (or all with -1), e.g. when its art has loaded. Keep it this way: never create a node per list entry.
- `scripts/main.gd` drives the two-level navigation (platforms → games). It reads all data from the library database: the platform list at startup, and a platform's game list when you enter it. That query runs on a `WorkerThreadPool` task during the shrink tween, so the main thread never waits on it. Left/right are polled each frame with an accelerating hold-repeat (not OS key repeat). PageUp/PageDown and gamepad shoulders jump to the next letter, Enter/Esc go in and out, F11 or Alt+Enter toggles fullscreen, and F3 shows a performance overlay. Levels swap with a shrink/grow tween. Tab or gamepad Start opens the settings overlay. Picking a game only emits `game_launch_requested(platform, game)` for now.
- The UI is two columns: `%Browse` (title, info, hints) and `%Details`, a `DetailsPanel` (`scripts/ui/details_panel.gd`, built in code). Main centres the spinner in the browse column by projecting the column's centre through the camera (`_place_spinner`, on resize), so it fits any aspect ratio. The panel fades out when the selection changes and shows the item's art and info on `settled`; for games it reads the scraped fields with `get_game(id)`. Missing fields are left out.

### Settings and metadata

- `scripts/settings.gd` (`Settings`) persists user settings in `user://settings.cfg` (ConfigFile). Every value has a default, and only values that differ from it are written. Each section holds one provider config, `{ type, ...that type's fields }`, read with `get_config(section)` and written with `set_config`; defaults come from `default_config(section, type)`, which uses each field's `default`. Add new settings the same way: a default in code, read with the file value on top.
- Sections: `platform_metadata` and `game_metadata` (MetadataSources types), `scraper` (Scrapers types). Defaults are local folders `<user data>/metadata/platforms` and `<user data>/metadata/games`, which may not exist. Then cards show name and color.
- `scripts/metadata/metadata_source.gd` (`MetadataSource`) is the abstract source: `read_file(relative_path)`, `read_first(base_path, extensions)`, `check()` for the settings screen. Reads run on worker threads and may block. `LocalFolderSource` is the only implementation (mounted SMB/NFS shares work through it). To add one (FTP, HTTP...), subclass it with `TYPE`, `DISPLAY_NAME` and `FIELDS` constants and add it to `MetadataSources.types()`; the settings UI builds its fields from `FIELDS` (`kind`: `folder` or plain text).
- Layout within a source: platform art is `<Platform>.<ext>`, game art is `<Platform>/<Game>.<ext>` (png, jpg, jpeg, webp). Names go through `MetadataSource.file_name()`, which replaces ``&*/:`<>?\|"`` with `_` like the libretro thumbnail sets.
- `scripts/metadata/art_loader.gd` (`ArtLoader`) is a Node that loads and decodes art on worker threads (newest request first, old requests dropped, images scaled to ≤512 px with mipmaps) and caches textures, including misses, in an LRU. `request(key)` never blocks; `art_loaded(key)` fires when a texture arrives. Main has one loader per source and maps keys to item indexes to refresh just that card.
- `scripts/ui/settings_menu.gd` (`SettingsMenu`) is the settings overlay, built in code, with Metadata and Scraper tabs. Its `SECTIONS` list maps each settings section to a registry; forms are built from the type's fields (`kind`: `text`, `password`, `folder`, `choice`). It edits copies of the configs and writes them only on Save, which emits `saved`; Main then recreates the sources. Metadata sources are checked as you type; scrapers only with "Test connection" (on a worker thread) because that needs the network.

### Scraping

- `scripts/scraper/scraper.gd` (`Scraper`) is the abstract provider: `supports_platform`, `scrape_game(game, platform)`, `scrape_platform(platform)`, `download(url)`, `check()`, all blocking and run off the main thread, returning `Scraper.Result` (status FOUND / NOT_FOUND / ERROR / STOP, normalized `metadata`, `media` kind → URL). Media kinds are `GAME_MEDIA` / `PLATFORM_MEDIA`. Call `_wait_turn()` before each request; it enforces `min_interval`. `COMMON_FIELDS` (which media kind becomes card art) are added to every provider's `FIELDS`. Register providers in `Scrapers.types()`.
- `scripts/scraper/screenscraper.gd` (`ScreenScraper`) implements ScreenScraper API v2: `jeuInfos.php` by ROM file name (plus checksums/size if known), falling back to `jeuRecherche.php` by name; platform media from `systemesListe.php`; region/language preference; 1.2 s minimum between requests, slower if `ssuser.maxrequestspermin` says so; 401/403/423/426/430/431 stop the run. `SYSTEM_IDS` maps platform keys to ScreenScraper ids (from Skyscraper's `platforms_idmap.csv`). It needs developer credentials: BeamRider's come from `SCREENSCRAPER_DEV_ID` / `SCREENSCRAPER_DEV_PASSWORD` via `Env`, and the settings fields override them. User credentials are optional. Passwords are stored in plain text in settings.cfg.
- `scripts/scraper/scrape_job.gd` (`ScrapeJob`) is one blocking pass over the library: platform art (if missing), then games never scraped (`only_unscraped`). It writes metadata via `GameLibrary.save_scrape` on its own DB connection, and art through `MetadataSource.write_file` into the configured metadata sources under the same keys the cards use. It never overwrites existing art, and stops after STOP or 5 errors in a row. It reports through the `on_event` callable.
- `scripts/scraper/library_scraper.gd` (`LibraryScraper`) runs a job on a WorkerThreadPool task and re-emits events as signals on the main thread. Main forgets the ArtLoader cache entry and refreshes the card when art is saved, and shows progress bottom right.
- `scripts/env.gd` (`Env`) holds secrets that must not be committed. `Env.value(key)` reads an environment variable, else `res://.env` (gitignored; keys listed in `.env.example`). Exported builds don't include `.env`, so set the environment variables there.
- `scripts/net/http_fetch.gd` (`HttpFetch`) is a blocking HTTPClient GET for worker threads (follows redirects). TLS isn't ready inside `SceneTree._init`, so tool scripts that use it should run after the first frame.
- Command line: `godot --headless --path . --script res://tools/scrape_library.gd -- [--all]` uses the saved settings.

### Library database

- SQLite through the godot-sqlite addon (v4.9, `addons/godot-sqlite`). Only the desktop binaries (macOS, Windows, Linux x86_64) are included, and `gdsqlite.gdextension` lists only those. The iOS binaries in the release are huge, so take Android/iOS/web binaries from the release only when needed.
- The database lives at `user://library.db` (the `database_path` export on Main), not in the repo. On macOS that is `~/Library/Application Support/Godot/app_userdata/BeamRider/library.db`.
- `scripts/library/game_library.gd` (`GameLibrary`) owns the schema (`SCHEMA`, `SCHEMA_VERSION` in `PRAGMA user_version`) and all queries. It has two tables: `platforms` (id, key, name, maker, year, color, sort_order) and `games` (id, platform_id, name, sort_name, year, file, plus scraped description, developer, publisher, genre, players, rating, scraped_at, scrape_status), indexed on `games(platform_id, sort_name)`. Platform `key` is the RetroPie-style folder name (`nes`, `megadrive`, `psx`) that scrapers map to their own ids; game `file` is the ROM file name (No-Intro / Redump naming), which scrapers match on. The database runs in WAL mode so the scraper's connection can write while the UI reads. `sort_name` is lowercased with a leading "the/a/an" removed, and letter jumps use it.
- Query rules: one query per view, selecting only the columns the spinner needs, kept in memory; fetch details with `get_game(id)` for the selection only. Converting rows to Dictionaries is the main cost (10,000 rows ≈ 30–40 ms), so run large queries off the main thread.
- `scripts/library/library_builder.gd` (`LibraryBuilder`) stands in for the future backend. It builds the database from `data/library.json` plus a generated "Stress Test" platform (`stress_test_games` export on Main, 0 = off). Main runs it automatically when the database is missing or `SCHEMA_VERSION` changed. Remove that auto-build once a real backend owns the database. To rebuild manually: `godot --headless --path . --script res://tools/build_library.gd -- --stress=10000`, or delete `library.db`.
- `data/library.json` is the seed data: platforms (`key`, `name`, `maker`, `year`, `color`, `games`) with games (`name`, `year`, `file`). Games use full official titles and real No-Intro / Redump file names so scrapers can find them. The generated Stress Test platform has key `stress-test`, which no scraper supports, so it costs no requests.
- Changing `SCHEMA_VERSION` rebuilds the database from seed data, which also discards scraped metadata (scraped art stays in the metadata folders).

The `godot_ai` addon (MCP server for the editor) is installed and enabled. It adds the `_mcp_game_helper` autoload. When testing through it, send left/right navigation as frame-timed `input_sequence` steps: separate key press and release calls are far enough apart to trigger the hold-repeat. Enter, Esc and Tab are read in `_unhandled_input`, so they need real key events (`input_key`), not actions. A game run from the editor stops rendering while its window is in the background, so its screenshots go stale. To capture reliably, run a small `SceneTree` script with `godot --path . --windowed --script ...` that instances `main.tscn` and saves `root.get_texture().get_image()`.

Project settings worth knowing: the window starts fullscreen, 3D uses 4× MSAA, and the default font uses MSDF so text stays sharp at any resolution.

## Engine configuration (from `project.godot`)

- Godot 4.7, Forward Plus renderer.
- 3D physics uses Jolt Physics (not the default Godot Physics).
- Windows uses the D3D12 rendering driver.
- Stretch mode is `canvas_items` with aspect `expand`.

## Commands

No build, lint, or test tooling is set up. Run these from `frontend/` (or pass `--path frontend` from the repo root), assuming the `godot` binary is on PATH (on macOS it is usually inside `Godot.app/Contents/MacOS/Godot`):

- Open the editor: `godot -e --path .`
- Run the project: `godot --path .`
- Run a specific scene: `godot --path . res://path/to/scene.tscn`
- Import resources and check scripts headlessly: `godot --headless --path . --import`
- Export: `godot --headless --path . --export-release <preset>` with preset `Windows`, `Linux` or `macOS` (from `export_presets.cfg`; output goes to the gitignored `build/`). This needs the Godot 4.7 export templates (Editor → Manage Export Templates). The presets exclude `addons/godot_ai/` and `tools/`; godot_ai's own export plugin strips its `_mcp_game_helper` autoload. macOS builds are universal (which is why `import_etc2_astc` is on in `project.godot`) and ad-hoc signed only, so they need a Developer ID and notarization before they can run on other Macs. `--export-pack` works without templates, but a bare pack can't load the sqlite extension.

## Conventions

- The repo-root `.editorconfig` sets UTF-8 only, and the root `.gitattributes` normalizes line endings. Both apply to every app.
- `.godot/` is the editor cache and is gitignored by `frontend/.gitignore`. Don't edit or commit it. `*.import` files are tracked.
- Prefer editing `project.godot` through the editor UI, as its header advises. Hand edits are fine for small, well-understood settings.
