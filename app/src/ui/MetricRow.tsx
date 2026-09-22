import type { HTMLAttributes, ReactNode } from "react";
import { Bar, type Tone } from "./Bar.tsx";
import "./MetricRow.css";

// DESIGN.md §4 Metric row. `used` drives the inline bar — null draws none, because a figure with no allowance has no
// denominator and an empty bar would read as "none used"; `value` and `unit` are what is read on the right ("1.9",
// "of 5 GB"); `upperBound` is the 312 % case — the bar full in --danger and "upper bound" as the unit.

export function MetricRow({
  label,
  used,
  value,
  unit,
  tone = "meter",
  upperBound = false,
  ...rest
}: { label: ReactNode; used: number | null; value: ReactNode; unit: ReactNode; tone?: Tone; upperBound?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="ui-metric-row" {...rest}>
      <span className="ui-metric-label">{label}</span>
      {used === null && !upperBound ? <span className="ui-metric-nobar" /> : <Bar pct={upperBound ? 100 : used} tone={upperBound ? "danger" : tone} inline />}
      <span className="ui-metric-value">
        <span className="ui-num">{value}</span> <span className="ui-unit">{upperBound ? "% upper bound" : unit}</span>
      </span>
    </div>
  );
}

/** The card the rows stack in, with an optional small title ("Needs attention"). */
export function Rows({ title, children, ...rest }: { title?: ReactNode; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="ui-rows" {...rest}>
      {title && <h3 className="ui-rows-title">{title}</h3>}
      {children}
    </div>
  );
}
