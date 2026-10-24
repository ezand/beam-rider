import { queryOptions } from "@tanstack/react-query";
import { PAGE_SIZE, type GamesPage, type LetterJump, type Platform } from "./api";

/** Query keys and fetchers for the library API, in one place. */

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export const platformsQuery = () =>
  queryOptions({
    queryKey: ["platforms"],
    queryFn: ({ signal }) => getJson<Platform[]>("/api/platforms", signal),
  });

/**
 * One page of a platform's games. The fetch takes the query's signal, so
 * TanStack Query aborts it once no one is watching that page, such as when
 * the wheel has already scrolled past.
 */
export const gamesPageQuery = (platformId: number, page: number) =>
  queryOptions({
    queryKey: ["games", platformId, page],
    queryFn: ({ signal }) =>
      getJson<GamesPage>(
        `/api/platforms/${platformId}/games?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`,
        signal,
      ),
  });

export const fetchLetterJump = (platformId: number, gameId: number, direction: 1 | -1) =>
  getJson<LetterJump>(`/api/platforms/${platformId}/letter?game=${gameId}&direction=${direction}`);
