import type { CSSProperties, ReactNode } from "react";
import "./Dot.css";

// DESIGN.md §4: the dot carries the colour, the word beside it says the same thing (§7). `color` is a token name
// (`--ok`, `--warn`, …) — never a literal — handed to the sheet as --c.

export type DotKind = "solid" | "ring" | "cross";

export function Dot({ color, kind = "solid" }: { color: string; kind?: DotKind }) {
  return <span className="ui-dot" data-kind={kind} style={{ "--c": `var(${color})` } as CSSProperties} aria-hidden="true" />;
}

export type Category = 1 | 2 | 3 | 4 | 5 | 6;

/** A client folder's or a provider's colour (DESIGN.md §2.2 category): one of six, stable, beside its name. */
export function Chip({ cat }: { cat: Category }) {
  return <span className="ui-chip" data-cat={cat} style={{ "--c": `var(--cat-${cat})` } as CSSProperties} aria-hidden="true" />;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="ui-tag">{children}</span>;
}
