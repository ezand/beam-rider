import { useState, type CSSProperties } from "react";

/**
 * The whole screen's background, taken from the selected item's art: a
 * small image, blurred, darkened and tinted with `accent`. A new image fades
 * in over the last one, which then goes. Pass small images (a 64 px
 * thumbnail is plenty), as the blur hides the detail and big ones cost more
 * to draw.
 */

export type BackdropProps = { src: string | null; accent?: string };

export function Backdrop({ src, accent }: BackdropProps) {
  // The image on show, and the one before it, which stays under the fade.
  const [layers, setLayers] = useState<{ current: string | null; previous: string | null }>({ current: src, previous: null });
  if (src !== layers.current) setLayers({ current: src, previous: layers.current });

  return (
    <div className="backdrop" aria-hidden="true" style={accent ? ({ "--backdrop-accent": accent } as CSSProperties) : undefined}>
      {layers.previous ? <img key={`previous-${layers.previous}`} className="backdrop__image" src={layers.previous} alt="" /> : null}
      {layers.current ? (
        <img
          key={layers.current}
          className="backdrop__image backdrop__image--in"
          src={layers.current}
          alt=""
          onAnimationEnd={() => setLayers((now) => (now.current === layers.current ? { ...now, previous: null } : now))}
        />
      ) : null}
      <div className="backdrop__tint" />
    </div>
  );
}
