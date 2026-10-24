import { useLayoutEffect, useRef } from "react";

/**
 * Text that scrolls itself, for a cabinet with no mouse to scroll with: if it
 * doesn't fit, it holds still for a few seconds, rolls slowly to the end,
 * holds again, and starts over. Text that fits stays put.
 */

/** Scroll speed, in pixels a second: slow enough to read along. */
const SPEED = 22;

export type TeleprompterProps = { text: string; className?: string };

export function Teleprompter({ text, className }: TeleprompterProps) {
  const frame = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // Measure how far the text overflows, and set the animation from that.
  useLayoutEffect(() => {
    const outer = frame.current;
    const inner = body.current;
    if (!outer || !inner) return;
    const measure = () => {
      const distance = Math.max(0, inner.scrollHeight - outer.clientHeight);
      outer.style.setProperty("--teleprompter-distance", `${-distance}px`);
      // Holds of about 4 s at each end, around the scroll itself.
      outer.style.setProperty("--teleprompter-duration", `${distance / SPEED + 8}s`);
      outer.dataset.scrolls = distance > 4 ? "true" : "false";
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div ref={frame} className={className ? `teleprompter ${className}` : "teleprompter"}>
      <div ref={body} key={text} className="teleprompter__text">
        {text}
      </div>
    </div>
  );
}
