/** Shapes of the library API, shared by the server and the client. */

export type Platform = {
  id: number;
  name: string;
  manufacturer: string | null;
  release_year: number | null;
  color: string | null;
  /** Visible (not hidden) games. */
  game_count: number;
};

/** The columns the wheel needs. Fetch details separately for the selection. */
export type GameListItem = {
  id: number;
  title: string;
  release_year: number | null;
  /** URL of the card art (a front box thumbnail), or null if none is downloaded. */
  art: string | null;
};

export type GamesPage = { offset: number; rows: GameListItem[] };

/** Null when there is nowhere to jump to. */
export type LetterJump = { index: number | null };

/** Rows per page. The server caps a page at MAX_PAGE_SIZE. */
export const PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

/** Everything about one game, for a details view. */
export type GameDetails = {
  id: number;
  platform: string;
  title: string;
  release_date: string | null;
  developer: string | null;
  publisher: string | null;
  players: string | null;
  rating: string | null;
  series: string | null;
  genres: string[];
  description: string | null;
  /** Where the description came from ("wikipedia", "igdb", "hasheous-ai"), and its page, to credit it. */
  description_source: string | null;
  description_url: string | null;
  /** Downloaded images, as thumbnail URLs. */
  images: { type: string; provider: string; region: string | null; url: string }[];
  files: { name: string; region: string | null; tags: string[]; match_method: string | null }[];
  scraped_at: string | null;
};
