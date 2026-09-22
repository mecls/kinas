import type { HTMLAttributes, ReactNode } from "react";
import { InfoIcon } from "./icons.tsx";
import "./SectionHeader.css";

// DESIGN.md §4 Section header: the caption carries freshness in one of two forms — "as of 09:31" for readings, or
// "since 23:40 yesterday, 7 h 50 m" for activity — and hovering it shows the source. `info` is a caveat behind the
// info icon (Convex's month window). This is the only place freshness appears, except for stale readings.

export function SectionHeader({
  title,
  caption,
  source,
  info,
  action,
}: {
  title: ReactNode;
  caption?: ReactNode;
  source?: string;
  info?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="ui-section-head">
      <h2>{title}</h2>
      {info && (
        <span className="ui-section-info" title={info}>
          <InfoIcon size="sm" title={info} />
        </span>
      )}
      {caption && (
        <span className="ui-caption" title={source}>
          {caption}
        </span>
      )}
      {action && (
        <button type="button" className="ui-section-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/** A page section: --space-6 above, the header, then its content. */
export function Section({ children, className, ...rest }: { children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={className ? `ui-section ${className}` : "ui-section"} {...rest}>
      {children}
    </section>
  );
}

/** DESIGN.md §3.2: the page title, then quiet actions on the right. */
export function TitleRow({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-titlerow">
      <h1>{title}</h1>
      {children}
    </div>
  );
}
