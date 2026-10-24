# Third-party licenses

BeamRider web is built on the software, fonts, reference data and online services below. This file lists each with its license or terms, and what that means for running or sharing the app. It covers the licenses of others' work; BeamRider's own code is under the GNU LGPL 2.1 (see [`LICENSE.md`](../LICENSE.md) at the repository root), matching 7-Zip's, the most restrictive license below.

## Software

Shipped with the app (in the browser bundle or used by the server at run time):

| Package | Version | License | Copyright |
|---|---|---|---|
| [React](https://github.com/facebook/react) (`react`, `react-dom`, `scheduler`) | 19.3 | MIT | Meta Platforms, Inc. and affiliates |
| [TanStack Query](https://github.com/TanStack/query) (`@tanstack/react-query`, `@tanstack/query-core`) | 5.104 | MIT | Tanner Linsley |
| [7z-wasm](https://github.com/use-strict/7z-wasm) (7-Zip compiled to WebAssembly) | 1.2.0 | GNU LGPL 2.1 or later, plus the unRAR restriction | Igor Pavlov; unRAR code Alexander Roshal |
| [readline-sync](https://github.com/anseki/readline-sync) (used by 7z-wasm's command line) | 1.4 | MIT | anseki |

Used to run, build and check the app, not shipped with it:

| Package | License |
|---|---|
| [Bun](https://bun.com) (runtime, bundler, test runner; includes SQLite as `bun:sqlite`) | MIT (SQLite: public domain) |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| `@types/bun`, `bun-types`, `@types/react`, `@types/react-dom`, `csstype`, `undici-types` | MIT |

**7-Zip and unRAR.** 7-Zip is LGPL: it may be used in any program, including commercial ones, and sharing it means keeping its license text and letting users swap in their own build of the library. 7z-wasm ships as its own unmodified package, with its license files (`License.txt`, `unRarLicense.txt`), which does that. 7-Zip's RAR support comes from unRAR, whose license adds that its code may not be used to recreate the RAR compression algorithm or a RAR-compatible archiver. BeamRider only reads RAR archives.

## Fonts

Bundled through Fontsource, so they work offline:

| Font | License | Copyright |
|---|---|---|
| [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (`@fontsource/press-start-2p`) | SIL Open Font License 1.1 | 2012 The Press Start 2P Project Authors (cody@zone38.net), Reserved Font Name "Press Start 2P" |
| [Orbitron](https://github.com/theleagueof/orbitron) (`@fontsource-variable/orbitron`) | SIL Open Font License 1.1 | 2018 The Orbitron Project Authors |

The OFL lets the fonts be used, bundled and shared with any software, as long as they aren't sold on their own and keep their license (it's in each package's `LICENSE`). Modified versions may not use the reserved font names.

## Reference data

| Data | Where it's used | License |
|---|---|---|
| [libretro-database](https://github.com/libretro/libretro-database) DATs (from [No-Intro](https://no-intro.org) and [Redump](http://redump.org)) | `bun run import:dats` downloads them into `data/dats.db`, to identify games by checksum | CC BY-SA 4.0 |
| libretro-database `metadat` lists (developer, publisher, genre, year, players, series, rating) | The libretro scraper's game details | CC BY-SA 4.0 |

Nothing from these is in the repository: each install downloads its own copy. CC BY-SA asks that anyone who shares the data, or work made from it, credit the source and share it under the same license.

## Online services

The scrapers fetch from these services. What they return (descriptions, details, artwork) is downloaded into the user's own library (`data/`, gitignored) and isn't part of BeamRider.

| Service | What BeamRider takes | Terms |
|---|---|---|
| [libretro thumbnails](https://thumbnails.libretro.com) | Box art, title screens, screenshots, logos | Free, no key. The images are scans and captures of commercial games, whose copyright stays with the games' publishers. |
| [Hasheous](https://hasheous.org) | Matches by checksum; year, publisher, logo, an AI-written description; links to other databases | Free lookups, rate limited. Descriptions are AI-generated. |
| [IGDB](https://www.igdb.com), through Hasheous (only with `HASHEOUS_CLIENT_API_KEY`) | Summary, genres, companies, release date, cover, screenshots, artwork | [IGDB API terms](https://api-docs.igdb.com) (Twitch): ask for attribution, and commercial use needs their agreement. |
| [Wikipedia](https://en.wikipedia.org) (REST summary API) | The article's opening summary, as the description | Text CC BY-SA 4.0, credited to the article. BeamRider keeps each description's source and link (`description_source`, `description_url`) for this. Requests follow the [Wikimedia API rules](https://www.mediawiki.org/wiki/API:Etiquette) (a descriptive User-Agent). |

**What this means in practice.** On a home cabinet, nothing needs to be shown on screen. If BeamRider is shown in public (a bar, an event) or its scraped library is shared, credit Wikipedia (and IGDB, if used) for their text, and keep to each service's terms, which includes not using IGDB data commercially without their agreement. Game artwork stays the property of its publishers either way.

## Games

BeamRider doesn't include or download games. It only scans the files its user already has.
