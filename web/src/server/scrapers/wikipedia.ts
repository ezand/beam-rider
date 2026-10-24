import { matchKey } from "../scanner/names";
import type { Scraper, ScraperContext, ScrapeTarget } from "./types";

/**
 * Wikipedia: a human-written description, the summary at the start of the
 * game's article, from the REST API. The article is the one Hasheous maps
 * the game to; without one, English Wikipedia is searched for the title, and
 * a result is only taken if its title is the game's (ignoring a "(video
 * game)" style suffix) and it's described as a game, not a series or a
 * character. Wikipedia text is CC BY-SA, so the description keeps a link to
 * its article (`description_url`) to credit it.
 */

type SearchPage = { key: string; title: string; description?: string | null };

/** The article for a game found by searching its title, or null. */
async function searchArticle(target: ScrapeTarget, { http, settings }: ScraperContext): Promise<string | null> {
  const base = settings.urls?.wikipedia ?? "https://en.wikipedia.org/";
  const query = new URLSearchParams({ q: `${target.title} video game`, limit: "10" });
  const found = await http.json<{ pages?: SearchPage[] }>("wikipedia", `${base}w/rest.php/v1/search/page?${query}`);
  const key = matchKey(target.title);
  const page = found?.pages?.find((page) =>
    matchKey(page.title.replace(/\s*\([^)]*\)\s*$/, "")) === key &&
    /\bgame\b/i.test(page.description ?? "") &&
    !/\b(series|franchise|character|protagonist|antagonist)\b/i.test(page.description ?? ""));
  return page ? `https://en.wikipedia.org/wiki/${page.key}` : null;
}

export const wikipedia: Scraper = {
  id: "wikipedia",
  name: "Wikipedia",
  after: ["hasheous"],
  configured: () => true,

  async scrape(target, context) {
    const article = context.links.wikipedia ?? (await searchArticle(target, context));
    const match = article?.match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/);
    if (!match) return null;
    const [, language, title] = match;
    const base = context.settings.urls?.wikipedia ?? `https://${language}.wikipedia.org/`;
    const summary = await context.http.json<{
      type?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    }>("wikipedia", `${base}api/rest_v1/page/summary/${title}`);
    if (!summary?.extract?.trim() || summary.type === "disambiguation") return null;
    const page = summary.content_urls?.desktop?.page ?? article!;
    // An article found by searching is kept, for the next scrape.
    const links: Record<string, string> = context.links.wikipedia ? {} : { wikipedia: page };
    return {
      externalId: decodeURIComponent(title!),
      url: page,
      fields: { description: summary.extract.trim() },
      descriptionUrl: page,
      links,
    };
  },
};
