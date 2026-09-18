// Where the divider between the page and the right-hand panel sits (reader R32, amended 2026-09-15; the panel moved
// to the right of the whole window on 2026-09-18). Pure, so bun tests cover it without the terminal or the DOM.

/** The panel's share of the stage until the divider is dragged. */
export const DEFAULT_PANEL_PCT = 55;
export const MIN_PANEL_PCT = 20;
export const MAX_PANEL_PCT = 80;
/** Neither side may be dragged narrower than this. Must equal `--pane-min` in styles/shell.css. */
export const MIN_PANE_PX = 280;

/**
 * A pointer position as the panel's share of the stage, kept inside 20–80 % and clear of both minimum widths.
 *
 * The panel is on the right, so its share is measured from the stage's **right** edge: dragging left widens it.
 */
export function panelPctAt(clientX: number, rowRight: number, rowWidth: number): number {
  if (rowWidth <= 0) return DEFAULT_PANEL_PCT;
  const minPx = (MIN_PANE_PX / rowWidth) * 100;
  const low = Math.max(MIN_PANEL_PCT, minPx);
  const high = Math.max(low, Math.min(MAX_PANEL_PCT, 100 - minPx));
  const pct = ((rowRight - clientX) / rowWidth) * 100;
  return Math.round(Math.min(high, Math.max(low, pct)) * 10) / 10;
}
