# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

BeamRider is a multi-app repository with one git repo at the root:

- `frontend/` is the Godot 4 frontend (3D game browser). It is a self-contained Godot project (`frontend/project.godot`, so `res://` is `frontend/`). Its guidance is in `frontend/CLAUDE.md`; read it before working there.
- `web/` is the web frontend: the same wheel in React and CSS 3D, served by Bun from its own SQLite library, which a ROM scanner builds from the user's game files. Its guidance is in `web/CLAUDE.md`; read it before working there.
- `library/` is the library app (new, in progress).

Run each app's commands from its own folder. Apps do not reference files in each other's folders.

## Design: a retro arcade cabinet

BeamRider is the frontend of a retro arcade cabinet build, so both frontends are designed for that, and can be flashy:

- **Distance and glance:** the player stands 60–80 cm from the screen, often with others watching. Use big type and high contrast, and make the essentials (what the game is, year, players, genre) readable in a second or two, with more for those who stay.
- **Controls only:** a joystick and buttons, no mouse or keyboard. Nothing may depend on clicking, hovering or links. Text that doesn't fit scrolls by itself (a teleprompter) rather than being cut off. Show the cabinet's button glyphs ("PRESS A TO PLAY").
- **The selected game sells itself:**
  - its logo as a lit marquee, with the typed title as the fallback;
  - its title screen and gameplay on a CRT-style screen (scanlines, curvature, glow, pixel art rendered pixelated);
  - its box as a 3D object;
  - its facts as badges rather than a table;
  - the whole screen's backdrop taken from its art, tinted with the platform's colour.
- **Motion makes it feel powered:** a staged entrance once the wheel stops (neon flicker, CRT power-on, badges in sequence) and a quick power-down blip when it moves. Attract mode cycles through games when idle, which also guards the screen against burn-in. Honour "reduce motion".
- **Graceful fallbacks everywhere:** a missing logo, screenshot or description falls back to something designed (typographic title, box art on the CRT, a platform-themed card), never to an empty box.
- **Cabinet practicalities:**
  - Everything works offline: fonts and assets are bundled, nothing is fetched at runtime.
  - Layouts cover 16:9 and 4:3, and possibly rotated (TATE) screens.
  - Cabinet PCs can be modest, so animate transforms and opacity, and blur or resize images once (on the server), not every frame.

## Conventions

- Root `.editorconfig` (UTF-8) and `.gitattributes` (LF line endings) apply to the whole repo.
- The root `.gitignore` holds repo-wide ignores (`.env` secrets in any folder). Tool-specific ignores go in each app's own `.gitignore` (e.g. `frontend/.gitignore` ignores Godot's `.godot/` cache).
- Secrets go in a gitignored `.env` inside the app that uses it, with the keys listed in that app's `.env.example`.
