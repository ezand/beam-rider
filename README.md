# BeamRider

A 3D frontend for browsing retro game libraries, built with Godot. Platforms and games are shown on a spinning carousel that stays smooth with tens of thousands of entries. Games can't be launched yet.

## Requirements

- [Godot 4.7](https://godotengine.org/download) (standard build; no .NET needed)
- macOS, Windows or Linux (x86_64). The SQLite add-on is included for these platforms only.

## Running

Open the project in the Godot editor and press F5, or from a terminal:

```sh
godot --path .
```

The game starts fullscreen. On the first run it creates the library database (see below), which takes well under a second.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Browse | ← / → (hold to scroll faster) or mouse wheel | D-pad left / right |
| Jump to previous / next letter | Page Up / Page Down | Left / right shoulder |
| Open platform / pick game | Enter | A / Cross |
| Back to platforms | Esc | B / Circle |
| Settings | Tab | Start |
| Toggle fullscreen | F11 or Alt+Enter | |
| Performance overlay | F3 | |

## Library database

Game data lives in an SQLite database at `user://library.db`, read through the [godot-sqlite](https://github.com/2shady4u/godot-sqlite) add-on. Godot's `user://` folder is:

- macOS: `~/Library/Application Support/Godot/app_userdata/BeamRider/`
- Windows: `%APPDATA%\Godot\app_userdata\BeamRider\`
- Linux: `~/.local/share/godot/app_userdata/BeamRider/`

For now the database is generated from `data/library.json`, plus a "Stress Test" platform of 10,000 generated games for performance testing. It's rebuilt automatically when the file is missing or the schema version changes. To rebuild it yourself, delete `library.db` or run:

```sh
godot --headless --path . --script res://tools/build_library.gd -- --stress=10000
```

Set `--stress=0`, or the `stress_test_games` property on the Main node, to leave out the test platform. A separate backend that scans ROM folders and fetches metadata will eventually own this database. The frontend only reads it.

## Artwork

Cards show artwork when it's available, and otherwise their name and color. No setup is needed: by default art is read from a `metadata` folder in the `user://` folder above. Drop files in like this:

```
metadata/platforms/NES.png
metadata/platforms/Mega Drive.jpg
metadata/games/NES/Metroid.png
metadata/games/NES/The Legend of Zelda.webp
```

File names match the platform and game names exactly, with any of `` & * / : ` < > ? \ | " `` replaced by `_` (the same rule as the libretro thumbnail sets). PNG, JPEG and WebP are supported. Large images are scaled down to 512 px on load.

To use other folders, press Tab (gamepad Start) to open Settings. Platform and game art have separate sources. **Browse…** picks a folder, and **Open** shows it in your file manager (creating it if needed). Settings are saved in `user://settings.cfg`. Only local folders are supported for now. A network share works if your OS has it mounted. The source setting is built so that FTP, HTTP and other sources can be added later.

## Project layout

```
scenes/main.tscn                     Main scene: camera, lighting, carousel, UI
scripts/main.gd                      Navigation, input, loading data for each view
scripts/spinner.gd                   Virtualized 3D carousel (Spinner)
scripts/library/game_library.gd      Database schema and queries (GameLibrary)
scripts/library/library_builder.gd   Builds the database from seed data (LibraryBuilder)
scripts/settings.gd                  Persisted user settings with defaults (Settings)
scripts/metadata/                    Metadata sources and async art loading
scripts/ui/settings_menu.gd          Settings overlay (SettingsMenu)
tools/build_library.gd               Command-line database rebuild
data/library.json                    Seed data: platforms and games
addons/godot-sqlite/                 SQLite add-on (desktop builds only)
addons/godot_ai/                     MCP server so AI assistants can drive the editor
```

## Performance notes

- The carousel creates only the ~15 cards near the front and reuses them as it turns, so its cost doesn't depend on list size. With 10,000 games it uses 43 nodes and about 0.1–0.3 ms per frame.
- Each view runs one query and keeps the result in memory. Large queries run on a background thread while the transition animation plays.
- Rendering uses 4× MSAA and MSDF fonts, so text stays sharp at any resolution.
