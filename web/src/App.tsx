import { useEffect, useRef, useState } from "react";
import { Carousel, type CarouselItem } from "./components/Carousel";
import library from "./data/library.json";
import "./index.css";

/**
 * Two-level browser, as in the Godot frontend's main.gd: a carousel of
 * platforms, then a carousel of that platform's games.
 */

type Game = { name: string; sortName: string; year?: number };
type Platform = { name: string; maker: string; year?: number; color: string; games: Game[] };

const PLATFORM_ITEM_SIZE = { width: 1.6, height: 1.0, depth: 0.2 };
const GAME_ITEM_SIZE = { width: 1.0, height: 1.4, depth: 0.15 };

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

/** "The Legend of Zelda" sorts as "legend of zelda", like the library database. */
function sortName(name: string): string {
  const lower = name.trim().toLowerCase();
  for (const article of ["the ", "a ", "an "]) {
    if (lower.startsWith(article) && lower.length > article.length) {
      return lower.slice(article.length);
    }
  }
  return lower;
}

const platforms: Platform[] = library.platforms.map((platform) => ({
  ...platform,
  games: platform.games
    .map((game) => ({ name: game.name, sortName: sortName(game.name), year: game.year }))
    .sort((a, b) => (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0)),
}));

function posmod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function year(entry: { year?: number }): string {
  return entry.year ? String(entry.year) : "";
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
  return { name: platform.name, subtitle: `${platform.maker} · ${year(platform)}`, color: platform.color };
}

/** Games vary their platform's color a little so neighbours stand apart. */
function gameCard(platform: Platform, index: number): CarouselItem {
  const game = platform.games[index]!;
  const [h, s, v] = hexToHsv(platform.color);
  const color = hsvToCss(
    posmod(h + (index % 7) * 0.04, 1),
    s * 0.85,
    Math.min(1, v * (0.75 + 0.1 * (index % 3))),
  );
  return { name: game.name, subtitle: year(game), color };
}

export function App() {
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

  const platform = currentPlatform === -1 ? null : platforms[currentPlatform]!;
  const count = platform ? platform.games.length : platforms.length;
  const index = posmod(selected, count);

  const move = (steps: number) => {
    if (count < 2 || steps === 0) return;
    setSelected((s) => s + steps);
    setNotice(null);
  };

  const jumpTo = (target: number) => move(target - index);

  const initial = (i: number) =>
    (platform ? platform.games[i]!.sortName : platforms[i]!.name).charAt(0).toUpperCase();

  /** Jumps to the first item whose name starts with the next (or previous) letter. */
  const jumpLetter = (direction: number) => {
    if (count < 2) return;
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
      const chosen = platforms[index]!;
      if (chosen.games.length === 0) {
        setNotice(`No games for ${chosen.name} yet`);
        return;
      }
      transition(() => {
        setCurrentPlatform(index);
        setSelected(0);
      });
    } else {
      setNotice(`Launching ${platform.games[index]!.name}…`);
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
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);

    const onKeyDown = (event: KeyboardEvent) => {
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
      if (transitioning.current) return;
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
  if (!platform) {
    const current = platforms[index];
    if (current) info = `${current.name}  ·  ${current.games.length} games`;
  } else {
    const game = platform.games[index]!;
    title = `PLATFORMS  ›  ${platform.name.toUpperCase()}`;
    info = `${game.name}  ·  ${year(game)}      ${index + 1} / ${count}`;
  }

  return (
    <div className="app">
      <Carousel
        key={level}
        count={count}
        getItem={platform ? (i) => gameCard(platform, i) : (i) => platformCard(platforms[i]!)}
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
  );
}

export default App;
