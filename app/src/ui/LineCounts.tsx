import "./LineCounts.css";

// DESIGN.md §4 Line counts (1.13, the interface polish): before a file's Change mark in a tree, "+N" in --ok-ink and
// "−N" in --danger-ink, mono --text-xs, the sign always written so the count reads without its colour. An added file
// shows only +N, a deleted one only −N. Hidden from assistive technology: the row's words say the counts.

/** "+11 −173", "+2", "−3": the counts as the row's words say them, a side with nothing left out. */
export function countsText(added?: number, removed?: number): string {
  return [added !== undefined ? `+${added}` : null, removed !== undefined ? `−${removed}` : null].filter(Boolean).join(" ");
}

export function LineCounts({ added, removed }: { added?: number; removed?: number }) {
  return (
    <span className="ui-line-counts" aria-hidden="true">
      {added !== undefined && <span className="ui-line-added">+{added}</span>}
      {removed !== undefined && <span className="ui-line-removed">{"−"}{removed}</span>}
    </span>
  );
}
