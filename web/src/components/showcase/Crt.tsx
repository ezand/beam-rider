import type { CSSProperties } from "react";

/**
 * A CRT-style screen showing a game's title screen and gameplay, one after
 * the other: scanlines, a curved glass glow and vignette, and pixel art kept
 * sharp. The images take turns by CSS animation alone, each shown for
 * `seconds` and crossfading, so the component holds no state. It powers on
 * (a line, then the picture) when it appears.
 */

export type CrtProps = { images: string[]; seconds?: number };

/** The most images a cycle takes (showcase.css has keyframes for 2 to 4). */
const MAX_IMAGES = 4;

export function Crt({ images: all, seconds = 4 }: CrtProps) {
  const images = [...new Set(all)].slice(0, MAX_IMAGES);
  if (!images.length) return null;
  const cycle = images.length * seconds;
  const style = { "--crt-cycle": `${cycle}s`, "--crt-keyframes": `crt-cycle-${images.length}` } as CSSProperties;
  return (
    <div className="crt" style={style}>
      <div className="crt__screen">
        {images.map((src, i) => (
          <img
            key={src}
            className={images.length > 1 ? "crt__image crt__image--cycling" : "crt__image"}
            src={src}
            alt=""
            draggable={false}
            style={{ animationDelay: `${i * seconds - cycle}s` }}
          />
        ))}
        <div className="crt__scanlines" />
        <div className="crt__glass" />
      </div>
    </div>
  );
}
