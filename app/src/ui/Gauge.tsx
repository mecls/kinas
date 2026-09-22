import type { HTMLAttributes, ReactNode } from "react";
import { Bar, type Tone } from "./Bar.tsx";
import "./Gauge.css";

// DESIGN.md §4 Gauge. The bar is the status — there is no dot in the corner. `used` is the percentage; `unit` the
// words after the number ("% used", "% of 100 GB"); `detail` the one line below ("resets in 3 h 43 m, 13:30" /
// "09:31, stale" / "last seen yesterday 22:10"). `dead` shows "No reading" and no number.

export function Gauge({
  title,
  used,
  unit,
  tone = "meter",
  detail,
  dead = false,
  muted = false,
  ...rest
}: {
  title: ReactNode;
  used: number | null;
  unit: string;
  tone?: Tone;
  detail: ReactNode;
  dead?: boolean;
  muted?: boolean;
} & HTMLAttributes<HTMLElement>) {
  const shown = dead ? null : used;
  return (
    <article className="ui-gauge" {...rest}>
      <div className="ui-gauge-title">{title}</div>
      <div className="ui-gauge-value" data-muted={muted || dead ? "true" : undefined}>
        {shown === null ? (
          <span className="ui-gauge-none">No reading</span>
        ) : (
          <>
            <span className="ui-num">{formatUsed(shown)}</span>
            <span className="ui-unit">{unit}</span>
          </>
        )}
      </div>
      <Bar pct={shown} tone={dead ? "meter" : tone} />
      <p className="ui-gauge-detail">{detail}</p>
    </article>
  );
}

/** The number as the providers' own pages show it: whole when whole, one decimal below ten, never a trailing .0. */
export function formatUsed(pct: number): string {
  if (Number.isInteger(pct)) return String(pct);
  return pct < 10 ? pct.toFixed(1).replace(/\.0$/, "") : String(Math.round(pct));
}

export function Gauges({ children }: { children: ReactNode }) {
  return <div className="ui-gauges">{children}</div>;
}
