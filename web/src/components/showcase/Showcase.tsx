import type { CSSProperties } from "react";
import { BoxArt } from "./BoxArt";
import { Crt } from "./Crt";
import { Teleprompter } from "./Teleprompter";
import "./showcase.css";
import "@fontsource/press-start-2p/400.css";
import "@fontsource-variable/orbitron/index.css";

/**
 * The selected wheel item's showcase, for an arcade cabinet: a game's logo
 * lit like a marquee, its title screen and gameplay on a CRT, its box in 3D,
 * its facts as badges, a self-scrolling description and a call to play; or
 * a platform's name, counter and a wall of its games' covers.
 *
 * Stateless: pass the item and whether it's shown. While the wheel moves,
 * keep passing the last item with `shown` false: it powers down, and the
 * next item powers up, staged, when `shown` is true again. Everything
 * missing is left out or falls back (no logo: the title in display type; no
 * screenshots: the box on the CRT).
 */

export type Badge = { text: string; tone?: "accent" | "plain" };

/** Common to both kinds. */
type ShowcaseBase = {
  /** Changes when the item does, to restart the entrance. */
  key: string;
  title: string;
  accent?: string;
  /** Art for the page behind (see Backdrop); the showcase itself doesn't draw it. */
  backdrop?: string | null;
};

export type ShowcaseItem = ShowcaseBase &
  (
    | {
        kind: "game";
        logo?: string | null;
        box?: string | null;
        /** Title screen and gameplay, for the CRT. */
        screens: string[];
        badges: Badge[];
        /** Developer and publisher. */
        byline?: string | null;
        description?: string | null;
        /** The call to action, such as "PRESS A TO PLAY"; its button letter is drawn as a button. */
        action?: { button: string; text: string } | null;
      }
    | {
        kind: "platform";
        maker?: string | null;
        year?: number | null;
        count: number;
        /** Box art of its games, for the wall. */
        covers: string[];
      }
  );

export type ShowcaseProps = { item: ShowcaseItem | null; shown: boolean; className?: string };

export function Showcase({ item, shown, className }: ShowcaseProps) {
  const style = item?.accent ? ({ "--accent": item.accent } as CSSProperties) : undefined;
  const state = item && shown ? "showcase--on" : "showcase--off";
  return (
    <section className={["showcase", state, className].filter(Boolean).join(" ")} style={style} aria-live="polite">
      {item ? (
        <div key={item.key} className="showcase__stage">
          {item.kind === "game" ? <GameShowcase item={item} /> : <PlatformShowcase item={item} />}
        </div>
      ) : null}
    </section>
  );
}

function Marquee({ title, logo }: { title: string; logo?: string | null }) {
  return (
    <header className="marquee">
      {logo ? (
        <img className="marquee__logo" src={logo} alt={title} draggable={false} />
      ) : (
        <h1 className={title.length > 28 ? "marquee__title marquee__title--long" : "marquee__title"}>{title}</h1>
      )}
    </header>
  );
}

function GameShowcase({ item }: { item: Extract<ShowcaseItem, { kind: "game" }> }) {
  // No screenshots: the box goes on the CRT instead, so the screen isn't empty.
  const screens = item.screens.length ? item.screens : item.box ? [item.box] : [];
  const box = item.screens.length ? item.box : null;
  return (
    <>
      <Marquee title={item.title} logo={item.logo} />
      <div className="showcase__media">
        <Crt images={screens} />
        {box ? <BoxArt src={box} /> : null}
      </div>
      {item.logo ? <h2 className="showcase__title">{item.title}</h2> : null}
      {item.badges.length ? (
        <ul className="badges">
          {item.badges.map((badge, i) => (
            <li key={badge.text} className={`badge badge--${badge.tone ?? "plain"}`} style={{ "--i": i } as CSSProperties}>
              {badge.text}
            </li>
          ))}
        </ul>
      ) : null}
      {item.byline ? <div className="showcase__byline">{item.byline}</div> : null}
      {item.description ? <Teleprompter className="showcase__description" text={item.description} /> : <div className="showcase__spacer" />}
      <footer className="showcase__footer">
        {item.action ? (
          <div className="action">
            PRESS <span className="action__button">{item.action.button}</span> {item.action.text}
          </div>
        ) : null}
      </footer>
    </>
  );
}

function PlatformShowcase({ item }: { item: Extract<ShowcaseItem, { kind: "platform" }> }) {
  // Enough covers to fill the wall twice, so its scroll loops seamlessly.
  const covers = item.covers.length ? Array.from({ length: Math.max(12, item.covers.length) }, (_, i) => item.covers[i % item.covers.length]!) : [];
  return (
    <>
      <Marquee title={item.title} />
      {item.maker || item.year ? (
        <div className="showcase__subtitle">{[item.maker, item.year].filter(Boolean).join("  ·  ")}</div>
      ) : null}
      <div className="counter">
        <span className="counter__number">{item.count.toLocaleString("en")}</span>
        <span className="counter__label">{item.count === 1 ? "GAME" : "GAMES"}</span>
      </div>
      {covers.length ? (
        <div className="cover-wall" aria-hidden="true">
          <div className="cover-wall__strip" style={{ "--covers": covers.length } as CSSProperties}>
            {[...covers, ...covers].map((src, i) => (
              <img key={i} className="cover-wall__cover" src={src} alt="" draggable={false} />
            ))}
          </div>
        </div>
      ) : (
        <div className="showcase__spacer" />
      )}
    </>
  );
}
