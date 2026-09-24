import { Dot } from "./Dot.tsx";
import "./ChangeMark.css";

// DESIGN.md §4 Change mark (1.6): what changed in a file tree since the tree was first shown. The Dot carries the
// colour and the letter says it in a word (§7), so the colour is never alone. On a folder the letter becomes the count
// of changes beneath it, and the dot the strongest of them. The mark is hidden from assistive technology: its words are
// the row's accessible name, and here only its tooltip.

export type ChangeKind = "A" | "M" | "D";

const COLOUR: Record<ChangeKind, string> = { A: "--ok", M: "--warn", D: "--danger" };

/** A roll-up's count as drawn: exact up to 99, then "99+". */
export const countLabel = (n: number) => (n > 99 ? "99+" : String(n));

export function ChangeMark({ mark, count, words }: { mark: ChangeKind; count?: number; words: string }) {
  return (
    <span className="ui-change-mark" data-mark={mark} data-rollup={count === undefined ? undefined : ""} title={words} aria-hidden="true">
      <Dot color={COLOUR[mark]} />
      <span className="ui-change-mark-text">{count === undefined ? mark : countLabel(count)}</span>
    </span>
  );
}
