import { GAME_FIELDS, type GameField, type ScrapeResult } from "./types";

/**
 * Which source wins each field, best first. A field takes the best source
 * that has it, and replaces what's there only if that came from a source no
 * better; fields the user edited (source "user") are never replaced. So
 * scraping again, or adding a provider, only ever improves a game.
 */
export const FIELD_PRIORITY: Record<GameField | "genres", string[]> = {
  description: ["wikipedia", "igdb", "hasheous-ai"],
  release_date: ["libretro", "igdb", "hasheous"],
  developer: ["libretro", "igdb", "hasheous"],
  publisher: ["libretro", "igdb", "hasheous"],
  players: ["libretro", "igdb"],
  rating: ["libretro", "igdb"],
  series: ["libretro", "igdb"],
  genres: ["libretro", "igdb"],
};

/** A source's rank for a field: lower is better, unlisted sources come last. */
export function rank(field: GameField | "genres", source: string | undefined): number {
  if (source === undefined) return Infinity;
  const order = FIELD_PRIORITY[field];
  const at = order.indexOf(source);
  return at < 0 ? order.length : at;
}

export type GameState = {
  values: Partial<Record<GameField, string | null>>;
  /** Field -> source of its current value ("user" for the user's edits). */
  sources: Record<string, string>;
  hasGenres: boolean;
};

export type MergedUpdate = {
  fields: Partial<Record<GameField, string>>;
  descriptionUrl?: string | null;
  genres?: string[];
  sources: Record<string, string>;
};

/** Works out what `results` (by provider) change about a game in `state`. */
export function merge(state: GameState, results: { provider: string; result: ScrapeResult }[]): MergedUpdate {
  const update: MergedUpdate = { fields: {}, sources: { ...state.sources } };
  const currentRank = (field: GameField | "genres", present: boolean) => {
    const source = state.sources[field];
    if (source === "user") return -1;
    return present ? rank(field, source) : Infinity;
  };

  for (const field of GAME_FIELDS) {
    let best: { value: string; source: string; url?: string | null } | null = null;
    for (const { provider, result } of results) {
      const value = result.fields?.[field]?.trim();
      if (!value) continue;
      const source = result.fieldSources?.[field] ?? provider;
      if (!best || rank(field, source) < rank(field, best.source)) {
        best = { value, source, url: field === "description" ? result.descriptionUrl ?? null : undefined };
      }
    }
    if (!best) continue;
    const present = Boolean(state.values[field]?.trim());
    if (rank(field, best.source) <= currentRank(field, present)) {
      update.fields[field] = best.value;
      update.sources[field] = best.source;
      if (field === "description") update.descriptionUrl = best.url ?? null;
    }
  }

  let bestGenres: { genres: string[]; source: string } | null = null;
  for (const { provider, result } of results) {
    if (!result.genres?.length) continue;
    const source = result.fieldSources?.genres ?? provider;
    if (!bestGenres || rank("genres", source) < rank("genres", bestGenres.source)) bestGenres = { genres: result.genres, source };
  }
  if (bestGenres && rank("genres", bestGenres.source) <= currentRank("genres", state.hasGenres)) {
    update.genres = [...new Set(bestGenres.genres)];
    update.sources.genres = bestGenres.source;
  }
  return update;
}
