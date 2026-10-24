# BeamRider web

A web version of the BeamRider frontend: a 3D carousel of platforms, then of each platform's games, built with React and CSS 3D transforms (no canvas or WebGL).

- `src/components/Carousel.tsx` is a stateless port of the Godot spinner (`frontend/scripts/spinner.gd`).
- `src/App.tsx` drives the two-level navigation, like `frontend/scripts/main.gd`.
- `src/data/library.json` is a copy of `frontend/data/library.json`.

Keys: ← → browse (hold to speed up), PageUp/PageDown jump to the next letter, Enter select, Esc back. The mouse wheel also browses.

```bash
bun install
bun dev        # development server with hot reloading
bun run build  # production build in dist/
bun start      # production server
bun check      # type check
```
