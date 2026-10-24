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
