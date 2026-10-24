import { useQueries } from "@tanstack/react-query";
import { PAGE_SIZE, type GameListItem } from "./api";
import { gamesPageQuery } from "./queries";

/**
 * How far either side of the selection to have games loaded: the carousel's
 * rendered cards plus half a page, so the next page is usually in before the
 * wheel reaches it.
 */
const LOAD_AROUND = 12 + PAGE_SIZE / 2;

function posmod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** The pages holding the games within LOAD_AROUND of `index`, wrapping around. */
function pagesAround(index: number, count: number): number[] {
  const pages = new Set<number>();
  for (let i = index - LOAD_AROUND; i <= index + LOAD_AROUND; i++) {
    pages.add(Math.floor(posmod(i, count) / PAGE_SIZE));
  }
  return [...pages];
}

/**
 * Loads a platform's games page by page around `index` (the wrapped
 * selection) as the wheel turns. Returns a lookup that gives a game, or null
 * while its page is loading. Pages the selection moves away from stop being
 * watched, which aborts their requests if still in flight.
 */
export function useGamePages(
  platformId: number | null,
  count: number,
  index: number,
): (i: number) => GameListItem | null {
  const pages = platformId === null || count === 0 ? [] : pagesAround(index, count);
  const loaded = useQueries({
    queries: pages.map((page) => gamesPageQuery(platformId!, page)),
    combine: (results) => results.map((result) => result.data),
  });
  const byPage = new Map(pages.map((page, i) => [page, loaded[i]]));
  return (i) => {
    const page = byPage.get(Math.floor(i / PAGE_SIZE));
    return page?.rows[i - page.offset] ?? null;
  };
}
