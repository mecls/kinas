import "./Bar.css";

// The fill of a bar that is fine is the neutral meter — never the accent (DESIGN.md §1, §2.2).

export type Tone = "meter" | "warn" | "danger" | "stale";

/** DESIGN.md §2.2: --warn past 80 % used, --danger past 95 %, --stale when the reading is older than its window. */
export function toneOf(usedPct: number | null, stale = false): Tone {
  if (stale) return "stale";
  if (usedPct === null) return "meter";
  if (usedPct >= 95) return "danger";
  if (usedPct >= 80) return "warn";
  return "meter";
}

export function Bar({ pct, tone = "meter", inline = false }: { pct: number | null; tone?: Tone; inline?: boolean }) {
  const width = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <span className="ui-bar" data-tone={tone} data-inline={inline ? "true" : undefined} aria-hidden="true">
      <i style={{ width: `${width}%` }} />
    </span>
  );
}

export interface Segments {
  done: number;
  working: number;
  wait: number;
  fail: number;
}

/** Done, working, waiting on a person and failed, each a share of the whole; a zero segment is not drawn. */
export function SegBar({ done, working, wait, fail }: Segments) {
  const total = done + working + wait + fail;
  const parts = [
    ["done", done],
    ["working", working],
    ["wait", wait],
    ["fail", fail],
  ] as const;
  return (
    <span className="ui-segbar" aria-hidden="true">
      {total > 0 && parts.filter(([, n]) => n > 0).map(([seg, n]) => <i key={seg} data-seg={seg} style={{ width: `${(n / total) * 100}%` }} />)}
    </span>
  );
}
