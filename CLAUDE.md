# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

BeamRider is a multi-app repository with one git repo at the root:

- `frontend/` is the Godot 4 frontend (3D game browser). It is a self-contained Godot project (`frontend/project.godot`, so `res://` is `frontend/`). Its guidance is in `frontend/CLAUDE.md`; read it before working there.
- `library/` is the library app (new, in progress).

Run each app's commands from its own folder. Apps do not reference files in each other's folders.

## Conventions

- Root `.editorconfig` (UTF-8) and `.gitattributes` (LF line endings) apply to the whole repo.
- The root `.gitignore` holds repo-wide ignores (`.env` secrets in any folder). Tool-specific ignores go in each app's own `.gitignore` (e.g. `frontend/.gitignore` ignores Godot's `.godot/` cache).
- Secrets go in a gitignored `.env` inside the app that uses it, with the keys listed in that app's `.env.example`.
