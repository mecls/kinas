import { useRef, useState } from "react";
import { Reader, type ReaderRequest } from "../reader/Reader.tsx";
import type { Shortcuts } from "../settings/shortcuts.ts";
import { Terminal } from "../terminal/Terminal.tsx";
import { DEFAULT_READER_PCT, MAX_READER_PCT, MIN_READER_PCT, readerPctAt } from "./split.ts";

export { DEFAULT_READER_PCT };

export interface ReaderPane {
  open: boolean;
  request: ReaderRequest | null;
}

// The reader on the left, the terminal on the right, and a divider between them that sets the split (reader R32,
// amended 2026-09-15 at Miguel's request). The structure never changes when the reader opens or closes, only `hidden`
// does: a new wrapper around <Terminal> would remount it, restart the PTY and drop Herdr's client (reader R31,
// Build 1 R33). The terminal refits through its own ResizeObserver while the divider moves.
export function WorkPage({
  active,
  shortcuts,
  reader,
  onReaderClose,
  readerWidth,
  onReaderWidth,
}: {
  active: boolean;
  shortcuts: Shortcuts;
  reader: ReaderPane;
  onReaderClose: () => void;
  readerWidth: number;
  onReaderWidth: (pct: number) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [dragPct, setDragPct] = useState<number | null>(null);
  // Whether a drag is under way, read by every pointer event. A ref, not state: a pointerup that arrives before React
  // re-renders after pointerdown would otherwise see no drag, and leave the page stuck in its dragging state.
  const dragging = useRef(false);
  const lastPct = useRef(readerWidth);
  const pct = dragPct ?? readerWidth;

  const pctAt = (clientX: number) => {
    const box = row.current?.getBoundingClientRect();
    return box ? readerPctAt(clientX, box.left, box.width) : readerWidth;
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
    onReaderWidth(next);
  };

  return (
    <div className="work" data-reader={reader.open ? "open" : "closed"} data-dragging={dragPct !== null ? "" : undefined} ref={row}>
      <aside className="reader" aria-label="Reader" hidden={!reader.open} style={{ flexBasis: `${pct}%` }}>
        <Reader request={reader.request} onClose={onReaderClose} />
      </aside>
      <div
        className="work-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the reader and the terminal"
        aria-valuemin={MIN_READER_PCT}
        aria-valuemax={MAX_READER_PCT}
        aria-valuenow={Math.round(pct)}
        title="Drag to resize; double-click for the default split"
        hidden={!reader.open}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // A synthetic pointer (tests) has no capture; the move and up events still reach the divider.
          }
          dragging.current = true;
          moveTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) moveTo(e.clientX);
        }}
        onPointerUp={(e) => endDrag(e, true)}
        onPointerCancel={(e) => endDrag(e, false)}
        onDoubleClick={() => onReaderWidth(DEFAULT_READER_PCT)}
      />
      <div className="work-terminal">
        <Terminal active={active} shortcuts={shortcuts} />
      </div>
    </div>
  );
}
