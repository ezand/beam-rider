# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

BeamRider is a 3D frontend for browsing retro games. So far it is a single main scene with a spinner menu. No games launch yet.

- `scenes/main.tscn` is the main scene. It holds the camera, lighting, environment (glow + SSR), a reflective floor, the `Spinner`, and a `CanvasLayer` UI.
- `scripts/spinner.gd` (`class_name Spinner`) is a virtualized carousel. Items sit on an arc and the selected one rests at the node's origin facing +Z. Only the ~15 items near the front exist as nodes; they are pooled and re-bound as the wheel turns, so cost doesn't grow with list size (tested at 10,000 items: 43 nodes, ~0.1–0.3 ms per frame). Feed it with `set_source(count, provider, start_index)`, where `provider(index) -> Dictionary` returns `name`, optional `subtitle`, and `color`, and is called only when an item becomes visible. `set_items(array)` is a wrapper for in-memory lists. `move(steps)` and `jump_to(index)` change the selection, and `selection_changed(index)` fires. Keep it this way: never create a node per list entry.
- `scripts/main.gd` drives the two-level navigation (platforms → games). Left/right are polled each frame with an accelerating hold-repeat (not OS key repeat). PageUp/PageDown and gamepad shoulders jump to the next letter, Enter/Esc go in and out, F11 or Alt+Enter toggles fullscreen, and F3 shows a performance overlay. Levels swap with a shrink/grow tween. Picking a game only emits `game_launch_requested(platform, game)` for now. The `stress_test_games` export adds a generated "Stress Test" platform; set it to 0 to turn it off.
- `data/library.json` is the placeholder library: a list of platforms (`name`, `maker`, `year`, `color`, `games`), each with games (`name`, `year`, optional `color`). JSON numbers load as floats, so format years with `int()`.

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
