# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

BeamRider is a 3D frontend for browsing retro games. So far it is a single main scene with a spinner menu. No games launch yet.

- `scenes/main.tscn` is the main scene. It holds the camera, lighting, environment (glow + SSR), a reflective floor, the `Spinner`, and a `CanvasLayer` UI.
- `scripts/spinner.gd` (`class_name Spinner`) is a reusable ring of items that rotates around Y. The selected item rests at the node's origin facing +Z. `set_items(items, start_index)` takes Dictionaries with `name`, optional `subtitle`, and `color`. `move(±1)` spins it, and `selection_changed(index)` fires when the selection changes.
- `scripts/main.gd` drives the two-level navigation (platforms → games), reads input (`ui_left`/`ui_right`/`ui_accept`/`ui_cancel`, mouse wheel), and swaps levels with a shrink/grow tween. Picking a game only emits `game_launch_requested(platform, game)` for now.
- `data/library.json` is the placeholder library: a list of platforms (`name`, `maker`, `year`, `color`, `games`), each with games (`name`, `year`, optional `color`). JSON numbers load as floats, so format years with `int()`.

The `godot_ai` addon (MCP server for the editor) is installed and enabled. It adds the `_mcp_game_helper` autoload.

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
