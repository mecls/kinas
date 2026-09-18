// Where the divider between the reader and the terminal sits (reader R32, amended 2026-09-15). Pure, so bun tests
// cover it without the terminal or the DOM.

/** The reader's share of the row until the divider is dragged. */
export const DEFAULT_READER_PCT = 55;
export const MIN_READER_PCT = 20;
export const MAX_READER_PCT = 80;
/** Neither side may be dragged narrower than this. */
export const MIN_PANE_PX = 280;

/** A pointer position as the reader's share of the row, kept inside 20–80 % and clear of both minimum widths. */
export function readerPctAt(clientX: number, rowLeft: number, rowWidth: number): number {
  if (rowWidth <= 0) return DEFAULT_READER_PCT;
  const minPx = (MIN_PANE_PX / rowWidth) * 100;
  const low = Math.max(MIN_READER_PCT, minPx);
  const high = Math.max(low, Math.min(MAX_READER_PCT, 100 - minPx));
  const pct = ((clientX - rowLeft) / rowWidth) * 100;
  return Math.round(Math.min(high, Math.max(low, pct)) * 10) / 10;
}
