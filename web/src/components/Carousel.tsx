import type { CSSProperties } from "react";
import "./Carousel.css";

/**
 * A port of the Godot frontend's spinner (`frontend/scripts/spinner.gd`) to
 * React and CSS 3D transforms. Items sit on an arc that turns around a vertical
 * axis behind the selected item, which rests at the centre facing the viewer.
 *
 * The component is stateless: the parent owns the selection and passes it in.
 * Only the items near the front are rendered, and `getItem` is called only for
 * those, so the cost stays the same whether the list has 10 or 100,000 entries.
 * All motion is a CSS transition on each card's `--offset`, and the arc, scale
 * and brightness are computed from it in CSS, so React renders only when the
 * selection changes.
 *
 * The component fills its parent, which must have a size.
 *
 * ```tsx
 * <Carousel count={games.length} getItem={i => games[i]} selected={selected} />
 * ```
 */

export type CarouselItem = {
  name: string;
  subtitle?: string;
  /** Any CSS color. */
  color?: string;
  /** Image URL. Shown on the card face instead of the name and subtitle. */
  art?: string | null;
};

export type CarouselProps = {
  count: number;
  /** Called only for items near the front, on each render. */
  getItem: (index: number) => CarouselItem;
  /**
   * The selected index. It may run past either end of the list (it is wrapped
   * to `count`), which lets the wheel keep turning the same way when it wraps.
   */
  selected: number;
  /** Card size in world units, as in Godot. */
  itemSize?: { width: number; height: number; depth: number };
  /** Arc length between neighbouring items. */
  itemSpacing?: number;
  radius?: number;
  /** Items further round the wheel than this are not drawn. */
  maxAngleDegrees?: number;
  /** Hard cap on the number of items drawn either side of the selection. */
  maxSideItems?: number;
  /** How fast the wheel catches up with the selection, as in Godot's `lerp`. */
  spinSmoothing?: number;
  selectedScale?: number;
  /** 0 = items face straight out from the wheel, 1 = every item faces the viewer. */
  faceCamera?: number;
  /** Share of the card's face that art may cover. */
  artFill?: number;
  /** Art brightness away from the selection. The selected item's art is at 1. */
  idleArtBrightness?: number;
  /** Mirror the cards in the floor. */
  reflection?: boolean;
  /**
   * Scales the whole wheel, animated: it shrinks below 1 in 0.18 s and grows
   * back in 0.28 s, like the level change in the Godot frontend.
   */
  scale?: number;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};

/**
 * Cards kept either side of the visible ones, at zero scale, so cards shrink
 * away instead of vanishing and fast scrolling has cards to show mid-flight.
 */
const BUFFER_ITEMS = 4;

/** Godot settles at 0.001 of an item. Stop the transition at the same point. */
const SETTLE_FRACTION = 0.001;

/**
 * A CSS `linear()` curve tracing `1 - exp(-smoothing * t)`, the curve Godot's
 * frame-by-frame `lerp` follows, scaled to end at exactly 1. Its shape is the
 * same for any smoothing; only the duration changes.
 */
const SPIN_EASING = `linear(${Array.from({ length: 25 }, (_, i) => {
  const remaining = Math.pow(SETTLE_FRACTION, i / 24);
  return ((1 - remaining) / (1 - SETTLE_FRACTION)).toFixed(4);
}).join(", ")})`;

function posmod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export function Carousel({
  count,
  getItem,
  selected,
  itemSize = { width: 1.6, height: 1.0, depth: 0.2 },
  itemSpacing = 2.0,
  radius = 4.0,
  maxAngleDegrees = 105,
  maxSideItems = 8,
  spinSmoothing = 12,
  selectedScale = 1.3,
  faceCamera = 0.6,
  artFill = 0.92,
  idleArtBrightness = 0.7,
  reflection = true,
  scale = 1,
  className,
  style,
  "aria-label": ariaLabel,
}: CarouselProps) {
  const step = itemSpacing / radius;
  const maxAngle = (maxAngleDegrees * Math.PI) / 180;
  const sideItems = Math.max(0, Math.min(Math.floor(maxAngle / step), maxSideItems));
  const center = Math.round(selected);

  const total = Math.min(sideItems * 2 + 1 + BUFFER_ITEMS * 2, count);
  const first = center - Math.floor((total - 1) / 2);
  const cards = Array.from({ length: total }, (_, i) => {
    const unwrapped = first + i;
    const index = posmod(unwrapped, count);
    return { unwrapped, index, item: getItem(index) };
  });

  const rootStyle = {
    ...style,
    "--item-width": itemSize.width,
    "--item-height": itemSize.height,
    "--item-depth": itemSize.depth,
    "--text-scale": Math.min(1, itemSize.width / 1.6),
    "--radius": radius,
    "--step": step,
    "--max-angle": maxAngle,
    "--side-items": sideItems,
    "--selected-scale": selectedScale,
    "--face-camera": faceCamera,
    "--art-fill": artFill,
    "--idle-art-brightness": idleArtBrightness,
    "--spin-duration": `${Math.log(1 / SETTLE_FRACTION) / spinSmoothing}s`,
    "--spin-easing": SPIN_EASING,
    "--wheel-scale": scale,
  } as CSSProperties;

  const renderCards = (mirrored: boolean) =>
    cards.map(({ unwrapped, index, item }) => {
      const isSelected = unwrapped === center;
      const cardStyle = {
        "--offset": unwrapped - center,
        "--color": item.color ?? "#ffffff",
      } as CSSProperties;
      return (
        <div
          key={unwrapped}
          className="carousel__card"
          style={cardStyle}
          role={mirrored ? undefined : "option"}
          aria-selected={mirrored ? undefined : isSelected}
          aria-label={mirrored ? undefined : item.name}
          data-index={index}
        >
          <div className="carousel__face carousel__face--front">
            {item.art ? (
              <img className="carousel__art" src={item.art} alt="" draggable={false} />
            ) : (
              <>
                <div className="carousel__title">{item.name}</div>
                {item.subtitle ? <div className="carousel__subtitle">{item.subtitle}</div> : null}
              </>
            )}
          </div>
          <div className="carousel__face carousel__face--back" />
          <div className="carousel__face carousel__face--left" />
          <div className="carousel__face carousel__face--right" />
          <div className="carousel__face carousel__face--top" />
          <div className="carousel__face carousel__face--bottom" />
        </div>
      );
    });

  return (
    <div
      className={className ? `carousel ${className}` : "carousel"}
      style={rootStyle}
      role="listbox"
      aria-label={ariaLabel}
      data-shrunk={scale < 1 ? "" : undefined}
    >
      <div className="carousel__viewport">
        <div className="carousel__stage">
          {reflection ? (
            <div className="carousel__reflection" aria-hidden="true">
              <div className="carousel__wheel">{renderCards(true)}</div>
            </div>
          ) : null}
          <div className="carousel__floor" />
          <div className="carousel__wheel">{renderCards(false)}</div>
        </div>
      </div>
    </div>
  );
}

export default Carousel;
