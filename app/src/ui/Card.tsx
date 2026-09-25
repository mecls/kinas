import type { HTMLAttributes, ReactNode } from "react";
import { Chip, Tag, type Category } from "./Dot.tsx";
import "./Card.css";

// DESIGN.md §4 Card and Lane. Cards exist to group, not to decorate; a selected one is --accent-soft with a 2 px
// accent edge. A lane is one client folder's column on the Crew board; an empty lane shows one line of quiet text.
// A crew project no client folder matches has a lane under its own name with no chip (1.4); an internal folder's lane
// carries the internal tag, as its row in the sidebar does.

export function Card({ selected = false, title, children, className, ...rest }: { selected?: boolean; title?: ReactNode; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <article className={className ? `ui-card ${className}` : "ui-card"} data-selected={selected ? "true" : undefined} {...rest}>
      {title && <div className="ui-card-title">{title}</div>}
      {children}
    </article>
  );
}

/** "2 in flight · 1 queued" with its numbers in mono (1.4): the words stay in the body face. */
function Counts({ text }: { text: string }) {
  return (
    <span className="ui-lane-slots" data-form="counts">
      {text.split(/(\d+)/).map((part, i) =>
        /^\d+$/.test(part) ? (
          <span key={i} className="ui-num">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}

/** `slots`: provider slots, all mono ("Claude 1/1 · Codex 1/2"). `counts`: the crew's words, numbers in mono (1.4). */
export function Lane({
  name,
  cat,
  slots,
  counts,
  internal = false,
  children,
  className,
  ...rest
}: { name: string; cat?: Category; slots?: string; counts?: string; internal?: boolean; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={className ? `ui-lane ${className}` : "ui-lane"} {...rest}>
      <div className="ui-lane-head">
        {cat !== undefined && <Chip cat={cat} />}
        <span>{name}</span>
        {internal && <Tag>internal</Tag>}
        {slots && <span className="ui-lane-slots">{slots}</span>}
        {counts && <Counts text={counts} />}
      </div>
      {children ?? <p className="ui-lane-empty">Nothing running here.</p>}
    </section>
  );
}
