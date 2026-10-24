/**
 * Game names as dump groups write them, and keys for comparing titles
 * however they're written: to group a game's regional versions, and to match
 * titles from metadata providers.
 *
 * No-Intro and Redump: `Legend of Zelda, The - A Link to the Past (USA) (Rev 1)`
 * TOSEC: `Turrican (1990)(Rainbow Arts)(Disk 1 of 2)[cr]`
 */

export type RomName = {
  /** The title with the article moved back: "The Legend of Zelda - A Link to the Past". */
  title: string;
  /** The region group, if any: "USA", "USA, Europe". */
  region: string | null;
  /** The other groups, in order: "Rev 1", "Beta", "Disc 1", "cr". */
  tags: string[];
};

const REGIONS = new Set([
  "world", "usa", "europe", "japan", "asia", "australia", "brazil", "canada", "china", "france", "germany",
  "hong kong", "italy", "korea", "netherlands", "spain", "sweden", "taiwan", "uk", "united kingdom",
  "russia", "scandinavia", "denmark", "finland", "norway", "portugal", "greece", "poland", "unknown",
]);

const isRegion = (group: string) =>
  group.split(",").every((part) => REGIONS.has(part.trim().toLowerCase()));

/** Articles dump names move to the end ("Legend of Zelda, The"). */
const MOVED_ARTICLE = /^(.*?), (The|A|An|Die|Der|Das|Le|La|Les|El|Il|Los|Las)( - .*)?$/;

/** Splits a dump name (without its extension) into title, region and tags. */
export function parseRomName(name: string): RomName {
  const groups = [...name.matchAll(/\(([^()]*)\)|\[([^[\]]*)\]/g)];
  const firstGroup = groups[0]?.index ?? name.length;
  let title = name.slice(0, firstGroup).replace(/\s+/g, " ").trim() || name.trim();

  const moved = title.match(MOVED_ARTICLE);
  if (moved) title = `${moved[2]} ${moved[1]}${moved[3] ?? ""}`;

  let region: string | null = null;
  const tags: string[] = [];
  for (const group of groups) {
    const text = (group[1] ?? group[2] ?? "").trim();
    if (!text) continue;
    if (region === null && group[1] !== undefined && isRegion(text)) region = text;
    else tags.push(text);
  }
  return { title, region, tags };
}

/**
 * A key that two spellings of one title share: "The Legend of Zelda: A Link
 * to the Past", "Legend of Zelda, The - A Link to the Past" and "legend of
 * zelda - a link to the past" all give "legend of zelda a link to the past".
 * Case, accents, punctuation, a leading article and "&" versus "and" don't
 * matter.
 */
export function matchKey(title: string): string {
  const moved = title.trim().match(MOVED_ARTICLE);
  const text = moved ? `${moved[2]} ${moved[1]}${moved[3] ?? ""}` : title;
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

/** A file name without its directory and extension. */
export function stem(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** A file name's extension, lowercase and without the dot, or "". */
export function extension(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}
