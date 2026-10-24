---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

## BeamRider web

The web version of the BeamRider frontend (Bun server, React, CSS 3D). `README.md` has the layout, commands, settings, schema and API; read it before working here.

- `src/components/Carousel.tsx` is stateless: the parent owns the selection, and the component renders only the cards near the front, calling `getItem` just for those. Keep it that way: never render a card per list entry, and keep motion in CSS (only `--offset` animates).
- Server state on the client goes through TanStack Query (`src/library/queries.ts`). Game lists are paged around the selection (`useGamePages`), never loaded whole.
- Change the database schema by adding a migration to `MIGRATIONS` in `src/server/schema.ts`. Never edit a migration that has been committed.
- The library holds only the user's games: a game exists because the scanner found files for it. Don't add catalogues of other games to it. Reference data (the DATs) lives in its own database (`data/dats.db`).
- Keep the app provider-neutral. Platforms are BeamRider's own (`src/server/scanner/platforms.ts`, by slug); a provider's names for them go in `providers`. Game and image fields are neutral, and scrapers map their provider's data onto them.
- Keep wheel queries on the `games_wheel` index: filter on `platform_id` and `hide = 0`, order by `sort_key, id`. Add a test with `EXPLAIN QUERY PLAN` and a timing check at 100,000 games for new ones (see `src/server/library.test.ts`).
- The ROM scanner (`src/server/scanner/`) never trusts file names alone when a checksum can decide. Supporting a new platform means adding one entry to `platforms.ts` (folders, DATs, extensions, kind, header). Identification runs on every scan from stored hashes, so keep it cheap and keep hashing for new or changed files only.
- Real ROMs never go into tests or the repo: tests build fake files and their own DATs (`src/server/scanner/fixtures.ts`).
- Archives are read in-process: zips by `archives.ts`, 7z and RAR by 7-Zip compiled to WebAssembly (`sevenzip.ts`). Don't add dependencies on tools that have to be installed.
- The server runs scans and scrapes in a worker (`src/server/scanner/manager.ts`), never on its own thread, and one at a time through `lock.ts`. Scanned folders and scrapers come from settings, never from requests.
- Scrapers (`src/server/scrapers/`) only look things up; `scrape.ts` writes. A new provider implements `Scraper` (`types.ts`), returns neutral fields and image types, and gets a place in `FIELD_PRIORITY` (`merge.ts`) and rate limits in `http.ts`. Never overwrite fields whose source is `"user"`, and keep `description_url` for attribution. Tests use fake servers, never the real providers.
- An empty or missing database, setting or media folder is a normal state with a sensible default, not an error.
- `data/` holds the library, the DATs and downloaded art. It's gitignored; don't commit any of it. Tests build their own data.
- Card art thumbnails are made at request time by `src/server/art.ts`. Validate any path from a request before it touches the filesystem, and don't hand request strings to `Bun.Image`.

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun check` instead of `tsc --noEmit`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Type checking

Use `bun check` to type check the project. It reads `tsconfig.json` and reports the same errors as `tsc`.

- `bun check src/index.ts` checks one file and what it imports
- `bun --check src/index.ts`, `bun test --check` and `bun build --check` type check first, and do nothing else if there is an error

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
