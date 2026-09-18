import { useRef, useState } from "react";
import { DEFAULT_PANEL_PCT, MAX_PANEL_PCT, MIN_PANEL_PCT, panelPctAt } from "./split.ts";

/**
 * The divider between the page and the right-hand panel: the drag, and the share of the stage it sets.
 *
 * Moved here from the Work page when the reader became a shell-level panel (2026-09-18); the drag itself is
 * unchanged. `row` goes on the stage, the returned props on the divider, and `pct` on the panel's flex-basis.
 */
export function useSplit(width: number, onWidth: (pct: number) => void) {
  const row = useRef<HTMLDivElement>(null);
  const [dragPct, setDragPct] = useState<number | null>(null);
  // Whether a drag is under way, read by every pointer event. A ref, not state: a pointerup that arrives before React
  // re-renders after pointerdown would otherwise see no drag, and leave the stage stuck in its dragging state.
  const dragging = useRef(false);
  const lastPct = useRef(width);
  const pct = dragPct ?? width;

  const pctAt = (clientX: number) => {
    const box = row.current?.getBoundingClientRect();
    return box ? panelPctAt(clientX, box.right, box.width) : width;
  };

  const moveTo = (clientX: number) => {
    lastPct.current = pctAt(clientX);
    setDragPct(lastPct.current);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>, save: boolean) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
    const next = save ? pctAt(e.clientX) : lastPct.current;
    setDragPct(null);
    onWidth(next);
  };

  const divider = {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize the page and the reader",
    "aria-valuemin": MIN_PANEL_PCT,
    "aria-valuemax": MAX_PANEL_PCT,
    "aria-valuenow": Math.round(pct),
    title: "Drag to resize; double-click for the default split",
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic pointer (tests) has no capture; the move and up events still reach the divider.
      }
      dragging.current = true;
      moveTo(e.clientX);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragging.current) moveTo(e.clientX);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, true),
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, false),
    onDoubleClick: () => onWidth(DEFAULT_PANEL_PCT),
  } as const;

  return { row, pct, isDragging: dragPct !== null, divider };
}
