import type { CSSProperties } from "react";
import "./DetailsPanel.css";

/**
 * Art and information for the selected wheel item, beside the wheel, as the
 * Godot frontend's DetailsPanel (frontend/scripts/ui/details_panel.gd).
 * Stateless: pass the item to show and whether it's shown. While the wheel
 * moves, keep passing the last item with `shown` false: it fades out, the
 * next item replaces it unseen, and fades in when `shown` is true again.
 * Anything missing (art, facts, description) is left out, so an unscraped
 * game shows just its title.
 */

export type DetailsItem = {
  title: string;
  /** Under the title, such as "SNES  ·  1990". */
  subtitle?: string;
  /** Accent line color, such as the platform's color. */
  accent?: string;
  /** Image URL. */
  art?: string | null;
  /** Label and value pairs, shown as a table. */
  facts?: [string, string][];
  description?: string | null;
  /** Credit for the description, such as "From Wikipedia", with a link. */
  credit?: { text: string; url?: string | null } | null;
};

export type DetailsPanelProps = {
  item: DetailsItem | null;
  shown: boolean;
  className?: string;
};

export function DetailsPanel({ item, shown, className }: DetailsPanelProps) {
  const style = item?.accent ? ({ "--details-accent": item.accent } as CSSProperties) : undefined;
  return (
    <aside className={className ? `details ${className}` : "details"} style={style} aria-live="polite">
      <div className={item && shown ? "details__content details__content--shown" : "details__content"}>
        {item ? (
          <>
            {item.art ? <img className="details__art" src={item.art} alt="" draggable={false} /> : null}
            <h2 className="details__title">{item.title}</h2>
            {item.subtitle ? <div className="details__subtitle">{item.subtitle}</div> : null}
            {item.facts?.length ? (
              <dl className="details__facts">
                {item.facts.map(([label, value]) => (
                  <div key={label} className="details__fact">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {item.description ? (
              <div className="details__description">
                <p>{item.description}</p>
              </div>
            ) : null}
            {item.description && item.credit ? (
              <div className="details__credit">
                {item.credit.url ? (
                  <a href={item.credit.url} target="_blank" rel="noreferrer">
                    {item.credit.text}
                  </a>
                ) : (
                  item.credit.text
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}

export default DetailsPanel;
