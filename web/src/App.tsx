import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Carousel, type CarouselItem } from "./components/Carousel";
import { Backdrop } from "./components/showcase/Backdrop";
import { Showcase, type Badge, type ShowcaseItem } from "./components/showcase/Showcase";
import type { GameDetails, GameListItem, Platform } from "./library/api";
import { fetchLetterJump, gameDetailsQuery, gamesPageQuery, platformsQuery } from "./library/queries";
import { useGamePages } from "./library/useGamePages";
import "./index.css";

/**
 * Two-level browser, as in the Godot frontend's main.gd: a carousel of
 * platforms, then a carousel of that platform's games. Data comes from the
 * library API; games are loaded a page at a time around the selection.
 */

const PLATFORM_ITEM_SIZE = { width: 1.6, height: 1.0, depth: 0.2 };
const GAME_ITEM_SIZE = { width: 1.0, height: 1.4, depth: 0.15 };
const DEFAULT_COLOR = "#888888";

// Holding left/right repeats, speeding up the longer it is held. In seconds.
const REPEAT_DELAY = 0.35;
const REPEAT_SLOWEST = 0.12;
const REPEAT_FASTEST = 0.02;
const REPEAT_RAMP = 2.5;

// Level change: the wheel shrinks, the level swaps, then the wheel grows back.
// Matches the Carousel's `scale` transition.
const SHRINK_MS = 180;
const GROW_MS = 280;

/** Wheel scroll distance, in pixels, that moves the selection by one. */
const WHEEL_STEP = 60;

/** How long the selection must stay put to count as settled, for the showcase. */
const SETTLE_MS = 250;

/** Attract mode: after this long without input the wheel turns by itself, a step every ATTRACT_STEP_MS. */
const ATTRACT_AFTER_MS = 90_000;
const ATTRACT_STEP_MS = 7_000;

/** Covers on a platform's wall, from its first page of games. */
const WALL_COVERS = 24;

const PLAY_ACTION = { button: "A", text: "TO PLAY" };

const DESCRIPTION_CREDITS: Record<string, string> = {
  wikipedia: "From Wikipedia",
  igdb: "From IGDB",
  "hasheous-ai": "Written by AI (Hasheous)",
};

function posmod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** The present parts, joined with a dot. */
function joined(...parts: (string | number | null | undefined)[]): string {
  return parts.filter((part) => part != null && part !== "").join("  ·  ");
}

function hexToHsv(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta > 0) {
    if (max === r) h = posmod((g - b) / delta, 6);
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  return [h / 6, max === 0 ? 0 : delta / max, max];
}

function hsvToCss(h: number, s: number, v: number): string {
  const channel = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `rgb(${channel(5)} ${channel(3)} ${channel(1)})`;
}

function platformCard(platform: Platform): CarouselItem {
  return {
    name: platform.name,
    subtitle: [platform.manufacturer, platform.release_year].filter(Boolean).join(" · "),
    color: platform.color ?? DEFAULT_COLOR,
  };
}

/**
 * Games vary their platform's color a little so neighbours stand apart. A
 * game whose page is still loading shows as a blank card in its color.
 */
function gameCard(platform: Platform, index: number, game: GameListItem | null): CarouselItem {
  const base = platform.color ?? DEFAULT_COLOR;
  let color = base;
  if (/^#[0-9a-f]{6}$/i.test(base)) {
    const [h, s, v] = hexToHsv(base);
    color = hsvToCss(posmod(h + (index % 7) * 0.04, 1), s * 0.85, Math.min(1, v * (0.75 + 0.1 * (index % 3))));
  }
  if (!game) return { name: "", color };
  return { name: game.title, subtitle: game.release_year ? String(game.release_year) : "", color, art: game.art };
}

/** The 64 px thumbnail of a `/art/512/` one, for the blurred backdrop. */
function backdropArt(url: string | null | undefined): string | null {
  return url ? url.replace(/^\/art\/512\//, "/art/64/") : null;
}

function platformShowcase(platform: Platform, covers: string[]): ShowcaseItem {
  return {
    kind: "platform",
    key: `platform:${platform.id}`,
    title: platform.name,
    accent: platform.color ?? undefined,
    maker: platform.manufacturer,
    year: platform.release_year,
    count: platform.game_count,
    covers,
    backdrop: backdropArt(covers[0]),
  };
}

/** "1-4" -> "4P"; "1" -> "1P". */
function playersBadge(players: string | null): string | null {
  const counts = (players?.match(/\d+/g) ?? []).map(Number);
  return counts.length ? `${Math.max(...counts)}P` : null;
}

/** A game's showcase from its details, or from what the wheel knows if they couldn't load. */
function gameShowcase(platform: Platform, row: GameListItem, details: GameDetails | undefined): ShowcaseItem {
  const base = { kind: "game" as const, key: `game:${row.id}`, accent: platform.color ?? undefined, action: PLAY_ACTION };
  if (!details) {
    const badges: Badge[] = row.release_year ? [{ text: String(row.release_year), tone: "accent" }] : [];
    return { ...base, title: row.title, box: row.art, screens: [], badges, backdrop: backdropArt(row.art) };
  }
  const images = (type: string) => details.images.filter((image) => image.type === type).map((image) => image.url);
  // libretro's logos are cut out for display; others may come on a background.
  const logo =
    details.images.find((image) => image.type === "logo" && image.provider === "libretro")?.url ?? images("logo")[0];
  const box = images("box-front")[0] ?? row.art;
  const screens = [...images("title-screen"), ...images("screenshot")];
  const year = details.release_date?.slice(0, 4);
  const badges: (Badge | null)[] = [
    year ? { text: year, tone: "accent" } : null,
    ...[playersBadge(details.players)].map((text) => (text ? { text } : null)),
    ...details.genres.slice(0, 2).map((text) => ({ text })),
    details.rating ? { text: details.rating } : null,
  ];
  const source = details.description_source;
  return {
    ...base,
    title: details.title,
    logo,
    box,
    screens,
    badges: badges.filter((badge): badge is Badge => badge !== null),
    byline: details.developer === details.publisher ? details.developer : joined(details.developer, details.publisher),
    description: details.description,
    credit: source ? (DESCRIPTION_CREDITS[source] ?? `From ${source}`) : null,
    // Fanart is made to sit behind things; else gameplay, else the box.
    backdrop: backdropArt(images("fanart")[0] ?? images("screenshot")[0] ?? box),
  };
}

/** `value`, once it has stayed the same for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function App() {
  const queryClient = useQueryClient();
  const platformsResult = useQuery(platformsQuery());
  const platforms = platformsResult.data ?? [];

  /** Index into `platforms` being browsed, or -1 while browsing platforms. */
  const [currentPlatform, setCurrentPlatform] = useState(-1);
  /** Unwrapped, so the wheel keeps turning the same way when it wraps. */
  const [selected, setSelected] = useState(0);
  /** Replaces the info line until the selection changes. */
  const [notice, setNotice] = useState<string | null>(null);
  const [wheelScale, setWheelScale] = useState(1);
  /** Bumped on each level change so the carousel starts fresh, not mid-spin. */
  const [level, setLevel] = useState(0);
  const transitioning = useRef(false);
  /** The level a letter jump request was made on, while one is in flight. */
  const jumping = useRef<number | null>(null);

  const platform = currentPlatform === -1 ? null : (platforms[currentPlatform] ?? null);
  const count = platform ? platform.game_count : platforms.length;
  const index = count > 0 ? posmod(selected, count) : 0;
  const game = useGamePages(platform?.id ?? null, count, index);

  // The showcase follows the selection once the wheel has stopped, so
  // scrolling past games doesn't fetch each one's details. It waits for what
  // it shows to load, so the entrance plays once, with everything. While the
  // wheel moves it keeps the last item, powered down.
  const selection = `${level}:${platform?.id ?? "platforms"}:${index}`;
  const settled = useSettled(selection, SETTLE_MS) === selection && wheelScale === 1;
  const settledGame = platform && settled ? game(index) : null;
  const settledPlatform = !platform && settled ? (platforms[index] ?? null) : null;
  const details = useQuery({ ...gameDetailsQuery(settledGame?.id ?? 0), enabled: settledGame !== null });
  const wall = useQuery({
    ...gamesPageQuery(settledPlatform?.id ?? 0, 0),
    enabled: settledPlatform !== null && settledPlatform.game_count > 0,
  });
  let showcaseItem: ShowcaseItem | null = null;
  if (settledGame && !details.isPending) {
    showcaseItem = gameShowcase(platform!, settledGame, details.data);
  } else if (settledPlatform && (settledPlatform.game_count === 0 || !wall.isPending)) {
    const covers = (wall.data?.rows ?? []).flatMap((row) => (row.art ? [row.art] : [])).slice(0, WALL_COVERS);
    showcaseItem = platformShowcase(settledPlatform, covers);
  }
  const lastShowcase = useRef<ShowcaseItem | null>(null);
  if (showcaseItem) lastShowcase.current = showcaseItem;
  const shownItem = showcaseItem ?? lastShowcase.current;

  const move = (steps: number) => {
    if (count < 2 || steps === 0) return;
    setSelected((s) => s + steps);
    setNotice(null);
  };

  /** Moves to `target` from wherever the selection is by the time it runs. */
  const jumpTo = (target: number) => {
    setSelected((s) => s + target - posmod(s, count));
    setNotice(null);
  };

  /** Jumps to the first item whose name starts with the next (or previous) letter. */
  const jumpLetter = (direction: 1 | -1) => {
    if (count < 2) return;
    if (platform) {
      // The server knows the whole list; ask it from the selected game.
      const current = game(index);
      if (!current || jumping.current !== null) return;
      jumping.current = level;
      fetchLetterJump(platform.id, current.id, direction)
        .then(({ index: target }) => {
          if (target !== null && jumping.current === level) jumpTo(target);
        })
        .catch(() => setNotice("Couldn't reach the library"))
        .finally(() => (jumping.current = null));
      return;
    }
    const initial = (i: number) => platforms[i]!.name.charAt(0).toUpperCase();
    const current = initial(index);
    let target = index;
    for (let i = 0; i < count; i++) {
      target = posmod(target + direction, count);
      if (initial(target) !== current) break;
    }
    if (direction < 0) {
      const letter = initial(target);
      while (posmod(target - 1, count) !== index && initial(posmod(target - 1, count)) === letter) {
        target = posmod(target - 1, count);
      }
    }
    jumpTo(target);
  };

  /** Shrinks the wheel away, runs `rebuild`, then grows it back. */
  const transition = (rebuild: () => void) => {
    transitioning.current = true;
    jumping.current = null;
    setWheelScale(0.01);
    setTimeout(() => {
      rebuild();
      setNotice(null);
      setLevel((l) => l + 1);
      // Let the new carousel paint once while shrunk, so growing animates.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setWheelScale(1);
          setTimeout(() => (transitioning.current = false), GROW_MS);
        }),
      );
    }, SHRINK_MS);
  };

  const activate = () => {
    if (!platform) {
      const chosen = platforms[index];
      if (!chosen) return;
      if (chosen.game_count === 0) {
        setNotice(`No games for ${chosen.name} yet`);
        return;
      }
      // Start on the first page while the wheel shrinks away.
      void queryClient.prefetchQuery(gamesPageQuery(chosen.id, 0));
      transition(() => {
        setCurrentPlatform(index);
        setSelected(0);
      });
    } else {
      const current = game(index);
      if (current) setNotice(`Launching ${current.title}…`);
    }
  };

  const back = () => {
    if (!platform) return;
    transition(() => {
      setSelected(currentPlatform);
      setCurrentPlatform(-1);
    });
  };

  // Event listeners are set up once and call the latest handlers through this.
  const handlers = useRef({ move, jumpLetter, activate, back });
  handlers.current = { move, jumpLetter, activate, back };

  useEffect(() => {
    // Holding left/right is polled each frame rather than taken from key
    // repeat, so it repeats on our own accelerating schedule.
    const held = new Set<string>();
    let holdDirection = 0;
    let holdTime = 0;
    let repeatTimer = 0;
    let last = performance.now();
    let frame = 0;
    // Attract mode: idle long enough and the wheel turns by itself, until any input.
    let lastInput = last;
    let lastAttract = last;
    /** Notes input; true if it woke the cabinet from attract mode, and so does nothing else. */
    const wake = () => {
      const now = performance.now();
      const attracting = now - lastInput > ATTRACT_AFTER_MS;
      lastInput = now;
      return attracting;
    };

    const heldDirection = () =>
      transitioning.current ? 0 : Number(held.has("ArrowRight")) - Number(held.has("ArrowLeft"));

    const startHold = (direction: number) => {
      holdDirection = direction;
      holdTime = 0;
      repeatTimer = REPEAT_DELAY;
      handlers.current.move(direction);
    };

    const update = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      const direction = heldDirection();
      if (direction === 0) {
        holdDirection = 0;
      } else if (direction !== holdDirection) {
        startHold(direction);
      } else {
        holdTime += delta;
        repeatTimer -= delta;
        while (repeatTimer <= 0) {
          handlers.current.move(direction);
          const ramp = Math.min(1, Math.max(0, (holdTime - REPEAT_DELAY) / REPEAT_RAMP));
          repeatTimer += REPEAT_SLOWEST + (REPEAT_FASTEST - REPEAT_SLOWEST) * ramp * ramp;
        }
      }
      if (now - lastInput > ATTRACT_AFTER_MS && now - lastAttract > ATTRACT_STEP_MS && !transitioning.current) {
        lastAttract = now;
        handlers.current.move(1);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);

    const onKeyDown = (event: KeyboardEvent) => {
      if (wake()) {
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        // Step on the press itself, so a tap shorter than a frame still counts.
        held.add(event.key);
        const direction = heldDirection();
        if (!event.repeat && direction !== 0 && direction !== holdDirection) startHold(direction);
      } else if (event.repeat || transitioning.current) {
        return;
      } else if (event.key === "Enter") {
        handlers.current.activate();
      } else if (event.key === "Escape" || event.key === "Backspace") {
        handlers.current.back();
      } else if (event.key === "PageUp") {
        handlers.current.jumpLetter(-1);
      } else if (event.key === "PageDown") {
        handlers.current.jumpLetter(1);
      } else {
        return;
      }
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => held.delete(event.key);
    const onBlur = () => held.clear();

    // Trackpads send many small wheel events, so add them up.
    let wheel = 0;
    const onWheel = (event: WheelEvent) => {
      if (wake() || transitioning.current) return;
      wheel += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const steps = Math.trunc(wheel / WHEEL_STEP);
      if (steps !== 0) {
        wheel -= steps * WHEEL_STEP;
        handlers.current.move(Math.sign(steps));
      }
    };

    addEventListener("keydown", onKeyDown);
    addEventListener("keyup", onKeyUp);
    addEventListener("blur", onBlur);
    addEventListener("wheel", onWheel, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("keydown", onKeyDown);
      removeEventListener("keyup", onKeyUp);
      removeEventListener("blur", onBlur);
      removeEventListener("wheel", onWheel);
    };
  }, []);

  let title = "PLATFORMS";
  let info = "";
  if (platformsResult.isPending) {
    info = "Loading library…";
  } else if (platformsResult.isError) {
    info = "Couldn't load the library";
  } else if (platforms.length === 0) {
    info = "No games found: set LIBRARY_ROM_ROOTS and run bun run scan";
  } else if (!platform) {
    const current = platforms[index]!;
    info = joined(current.name, `${current.game_count} ${current.game_count === 1 ? "game" : "games"}`);
  } else {
    const current = game(index);
    const position = `${index + 1} / ${count}`;
    title = `PLATFORMS  ›  ${platform.name.toUpperCase()}`;
    info = current
      ? `${joined(current.title, current.release_year)}      ${position}`
      : `Loading…      ${position}`;
  }

  return (
    <div className="app">
      <Backdrop src={shownItem?.backdrop ?? null} accent={shownItem?.accent} />
      <div className="app__browse">
        <Carousel
          key={level}
          count={count}
          getItem={platform ? (i) => gameCard(platform, i, game(i)) : (i) => platformCard(platforms[i]!)}
          selected={selected}
          itemSize={platform ? GAME_ITEM_SIZE : PLATFORM_ITEM_SIZE}
          itemSpacing={platform ? 1.5 : 2.1}
          scale={wheelScale}
          aria-label={platform ? `${platform.name} games` : "Platforms"}
        />
        <div className="app__overlay">
          <div className="app__title">{title}</div>
          <div className="app__info" aria-live="polite">
            {notice ?? info}
          </div>
          <div className="app__hints">
            ←  →  browse     PgUp  PgDn  letter     Enter  select     Esc  back
          </div>
        </div>
      </div>
      <Showcase className="app__showcase" item={shownItem} shown={showcaseItem !== null} />
    </div>
  );
}

export default App;
