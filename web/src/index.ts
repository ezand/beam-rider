import { serve } from "bun";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import index from "./index.html";
import { PAGE_SIZE, type GamesPage, type LetterJump } from "./library/api";
import { createArtHandler } from "./server/art";
import {
  artRegions, datsPath, libraryPath as configuredLibraryPath, mediaPath, romPlatformOverrides, romRoots, scanLockPath,
  scrapeAfterScan, scraperIds, scrapeSettings,
} from "./server/config";
import { openLibrary } from "./server/library";
import { createJobManager, jobRoutes } from "./server/scanner/manager";

const libraryPath = configuredLibraryPath();
mkdirSync(dirname(libraryPath), { recursive: true });
const library = openLibrary(libraryPath, { artRegions: artRegions() });
const jobs = createJobManager({
  libraryPath,
  datsPath: datsPath(),
  mediaPath: mediaPath(),
  roots: romRoots(),
  overrides: romPlatformOverrides(),
  scrapers: scraperIds(),
  scrape: scrapeSettings(),
  scrapeAfterScan: scrapeAfterScan(),
  lockPath: scanLockPath(),
});

/** A non-negative integer from a path or query parameter, or null. */
function integer(value: string | null | undefined): number | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

const badRequest = (message: string) => Response.json({ error: message }, { status: 400 });

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/platforms": () => Response.json(library.platforms()),

    // Scans of the ROM folders and scrapes of the games, run in a worker
    // (see server/scanner/manager.ts).
    ...jobRoutes(jobs),

    // Card art, shrunk from the downloaded originals (see server/art.ts).
    "/art/:size/:shard/:file": createArtHandler(mediaPath()),

    "/api/platforms/:id/games": (req) => {
      const url = new URL(req.url);
      const platform = integer(req.params.id);
      const offset = integer(url.searchParams.get("offset") ?? "0");
      const limit = integer(url.searchParams.get("limit") ?? String(PAGE_SIZE));
      if (platform === null || offset === null || limit === null) {
        return badRequest("Expected a platform id and integer offset and limit");
      }
      return Response.json({ offset, rows: library.gamesPage(platform, offset, limit) } satisfies GamesPage);
    },

    "/api/games/:id": (req) => {
      const id = integer(req.params.id);
      const game = id === null ? null : library.gameDetails(id);
      return game ? Response.json(game) : Response.json({ error: "No such game" }, { status: 404 });
    },

    "/api/platforms/:id/letter": (req) => {
      const url = new URL(req.url);
      const platform = integer(req.params.id);
      const game = integer(url.searchParams.get("game"));
      const direction = url.searchParams.get("direction");
      if (platform === null || game === null || (direction !== "1" && direction !== "-1")) {
        return badRequest("Expected a platform id, a game id and a direction of 1 or -1");
      }
      const result: LetterJump = { index: library.letterJump(platform, game, direction === "1" ? 1 : -1) };
      return Response.json(result);
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
console.log(`📚 Library: ${libraryPath}`);
