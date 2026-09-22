import type { HTMLAttributes, ReactNode } from "react";
import { Chip, type Category } from "./Dot.tsx";
import "./Card.css";

// DESIGN.md §4 Card and Lane. Cards exist to group, not to decorate; a selected one is --accent-soft with a 2 px
// accent edge. A lane is one client folder's column on the Crew board; an empty lane shows one line of quiet text.

export function Card({ selected = false, title, children, className, ...rest }: { selected?: boolean; title?: ReactNode; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <article className={className ? `ui-card ${className}` : "ui-card"} data-selected={selected ? "true" : undefined} {...rest}>
      {title && <div className="ui-card-title">{title}</div>}
      {children}
    </article>
  );
}

export function Lane({ name, cat, slots, children, ...rest }: { name: string; cat: Category; slots?: string; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section className="ui-lane" {...rest}>
      <div className="ui-lane-head">
        <Chip cat={cat} />
        <span>{name}</span>
        {slots && <span className="ui-lane-slots">{slots}</span>}
      </div>
      {children ?? <p className="ui-lane-empty">Nothing running here.</p>}
    </section>
  );
}
