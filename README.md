# BeamRider

BeamRider is a 3D frontend for browsing and launching retro games. This repository holds several apps, each in its own folder:

| Folder | App |
|---|---|
| [`frontend/`](frontend/README.md) | The Godot 4 frontend: 3D carousel, settings, art loading and scraping |
| [`web/`](web/README.md) | The web frontend: the same wheel in React and CSS 3D, with its own ROM scanner, scrapers and library |
| `library/` | The library app (work in progress) |

Each app has its own README with requirements and run instructions, and keeps its own tool-specific `.gitignore`. Repo-wide settings (`.editorconfig`, `.gitattributes`, and ignoring `.env` files) live at the root.
