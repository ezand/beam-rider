# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

BeamRider is a 3D frontend for browsing retro games. So far it is a single main scene with a spinner menu. No games launch yet.

- `scenes/main.tscn` is the main scene. It holds the camera, lighting, environment (glow + SSR), a reflective floor, the `Spinner`, and a `CanvasLayer` UI.
- `scripts/spinner.gd` (`class_name Spinner`) is a virtualized carousel. Items sit on an arc and the selected one rests at the node's origin facing +Z. Only the ~15 items near the front exist as nodes; they are pooled and re-bound as the wheel turns, so cost doesn't grow with list size (tested at 10,000 items: 43 nodes, ~0.1–0.3 ms per frame). Feed it with `set_source(count, provider, start_index)`, where `provider(index) -> Dictionary` returns `name`, optional `subtitle`, and `color`, and is called only when an item becomes visible. `set_items(array)` is a wrapper for in-memory lists. `move(steps)` and `jump_to(index)` change the selection, and `selection_changed(index)` fires. Keep it this way: never create a node per list entry.
- `scripts/main.gd` drives the two-level navigation (platforms → games). It reads all data from the library database: the platform list at startup, and a platform's game list when you enter it. That query runs on a `WorkerThreadPool` task during the shrink tween, so the main thread never waits on it. Left/right are polled each frame with an accelerating hold-repeat (not OS key repeat). PageUp/PageDown and gamepad shoulders jump to the next letter, Enter/Esc go in and out, F11 or Alt+Enter toggles fullscreen, and F3 shows a performance overlay. Levels swap with a shrink/grow tween. Picking a game only emits `game_launch_requested(platform, game)` for now.

### Library database

- SQLite through the godot-sqlite addon (v4.9, `addons/godot-sqlite`). Only the desktop binaries (macOS, Windows, Linux x86_64) are included, and `gdsqlite.gdextension` lists only those. The iOS binaries in the release are huge, so take Android/iOS/web binaries from the release only when needed.
- The database lives at `user://library.db` (the `database_path` export on Main), not in the repo. On macOS that is `~/Library/Application Support/Godot/app_userdata/BeamRider/library.db`.
- `scripts/library/game_library.gd` (`GameLibrary`) owns the schema (`SCHEMA`, `SCHEMA_VERSION` in `PRAGMA user_version`) and all queries. It has two tables: `platforms` (id, name, maker, year, color, sort_order) and `games` (id, platform_id, name, sort_name, year), indexed on `games(platform_id, sort_name)`. `sort_name` is lowercased with a leading "the/a/an" removed, and letter jumps use it.
- Query rules: one query per view, selecting only the columns the spinner needs, kept in memory; fetch details with `get_game(id)` for the selection only. Converting rows to Dictionaries is the main cost (10,000 rows ≈ 30–40 ms), so run large queries off the main thread.
- `scripts/library/library_builder.gd` (`LibraryBuilder`) stands in for the future backend. It builds the database from `data/library.json` plus a generated "Stress Test" platform (`stress_test_games` export on Main, 0 = off). Main runs it automatically when the database is missing or `SCHEMA_VERSION` changed. Remove that auto-build once a real backend owns the database. To rebuild manually: `godot --headless --path . --script res://tools/build_library.gd -- --stress=10000`, or delete `library.db`.
- `data/library.json` is the seed data: platforms (`name`, `maker`, `year`, `color`, `games`) with games (`name`, `year`).

The `godot_ai` addon (MCP server for the editor) is installed and enabled. It adds the `_mcp_game_helper` autoload. When testing through it, send navigation as frame-timed `input_sequence` steps: separate key press and release calls are far enough apart to trigger the hold-repeat.

Project settings worth knowing: the window starts fullscreen, 3D uses 4× MSAA, and the default font uses MSDF so text stays sharp at any resolution.

## Engine configuration (from `project.godot`)

- Godot 4.7, Forward Plus renderer.
- 3D physics uses Jolt Physics (not the default Godot Physics).
- Windows uses the D3D12 rendering driver.
- Stretch mode is `canvas_items` with aspect `expand`.

## Commands

No build, lint, or test tooling is set up. Assuming the `godot` binary is on PATH (on macOS it is usually inside `Godot.app/Contents/MacOS/Godot`):

- Open the editor: `godot -e --path .`
- Run the project: `godot --path .`
- Run a specific scene: `godot --path . res://path/to/scene.tscn`
- Import resources and check scripts headlessly: `godot --headless --path . --import`

## Conventions

- `.editorconfig` sets UTF-8 only. `.gitattributes` normalizes line endings.
- `.godot/` is the editor cache and is gitignored. Don't edit or commit it. `*.import` files are tracked.
- Prefer editing `project.godot` through the editor UI, as its header advises. Hand edits are fine for small, well-understood settings.
