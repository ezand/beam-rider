import type { Database } from "bun:sqlite";
import type { PlatformInfo } from "../scanner/platforms";
import type { Http } from "./http";

/**
 * Scrapers look up games at a provider and say what they found. They don't
 * write to the library: scrape.ts merges what they find into the game's
 * neutral fields (merge.ts) and downloads the images (images.ts), so a new
 * provider only has to implement `Scraper`.
 */

/** One of the game's files, as the scanner identified it. */
export type ScrapeFile = {
  fileName: string;
  /** The DAT game name it was identified as, such as "Super Mario World (USA)". */
  datName: string | null;
  crc32: number | null;
  md5: string | null;
  sha1: string | null;
  size: number | null;
  region: string | null;
  matchMethod: string | null;
};

export type ScrapeTarget = {
  gameId: number;
  title: string;
  platform: PlatformInfo;
  files: ScrapeFile[];
};

/** The game fields scrapers fill. The title stays the scanner's. */
export const GAME_FIELDS = ["release_date", "developer", "publisher", "players", "rating", "series", "description"] as const;
export type GameField = (typeof GAME_FIELDS)[number];

export type ImageType = "box-front" | "box-back" | "box-3d" | "logo" | "screenshot" | "title-screen" | "fanart" | "disc" | "cart" | "banner";

export type FoundImage = { type: ImageType; url: string; region?: string | null };

export type ScrapeResult = {
  /** The game's id at the provider. */
  externalId?: string | null;
  /** The game's page at the provider. */
  url?: string | null;
  fields?: Partial<Record<GameField, string>>;
  /** Where each field came from, when not the scraper itself (Hasheous passes on IGDB's). */
  fieldSources?: Partial<Record<GameField | "genres", string>>;
  /** Where the description came from, for attribution. */
  descriptionUrl?: string | null;
  genres?: string[];
  images?: FoundImage[];
  /** The game's ids or pages elsewhere, for later scrapers, such as { wikipedia: url }. */
  links?: Record<string, string>;
};

export type ScrapeSettings = {
  /** Hasheous app key; without it, the IGDB lookup is skipped. */
  hasheousClientKey?: string;
  /** Overrides providers' base URLs, for tests. */
  urls?: Partial<Record<"libretro" | "hasheous" | "wikipedia", string>>;
};

export type ScraperContext = {
  http: Http;
  /** The DAT reference database, for libretro's details and DAT entries' hashes. */
  dats: Database | null;
  settings: ScrapeSettings;
  /** Links found by other providers, now or in earlier scrapes. */
  links: Record<string, string>;
};

export interface Scraper {
  id: string;
  name: string;
  /** Providers whose links this one starts from, so they run first. */
  after?: string[];
  /** Whether it can run with these settings. */
  configured(settings: ScrapeSettings): boolean;
  /** What the provider knows about the game, or null if it doesn't know it. */
  scrape(target: ScrapeTarget, context: ScraperContext): Promise<ScrapeResult | null>;
}
