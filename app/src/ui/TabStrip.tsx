import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloseIcon, FileIcon } from "./icons.tsx";
import "./TabStrip.css";

// DESIGN.md §4 Tab strip (1.5, the reader's layout): one row of tabs above the reader's header, one per file opened
// this session. Presentation only — the reader owns the tabs (reader/tabs.ts). Click-only (keymap.md): a tab takes no
// focus, and a press on the strip is kept from moving it, so the terminal keeps the keys while tabs are switched.

export interface TabStripTab {
  /** The tab's identity, carried on the tab as `data-path`: the reader keys tabs on the file's real path. */
  key: string;
  name: string;
  /** The parent folder's name, when another tab has the same name; null otherwise. */
  detail: string | null;
  /** The tooltip: the display path, as the reader's header says it. */
  title: string;
}

/** A press that moves less than this is a click, not a drag (PRD rule 19). */
export const DRAG_THRESHOLD_PX = 4;

/** Whether a press has moved far enough to be a drag. */
export const pastThreshold = (dx: number, dy: number) => Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;

/**
 * Where a dragged tab lands: past as many of the other tabs as have their middle left of the pointer, measured on
 * the boxes the tabs had when the press began. Left of the first is 0, past the last is the last place, and over its
 * own box it stays where it was.
 */
export function dropIndex(clientX: number, tabRects: readonly { left: number; width: number }[], from: number): number {
  let index = 0;
  tabRects.forEach((r, i) => {
    if (i !== from && r.left + r.width / 2 < clientX) index++;
  });
  return index;
}

/** A drag under way: which tab, how far it has moved, where it would land, and its width, for the others' room. */
interface Drag {
  from: number;
  dx: number;
  to: number;
  width: number;
}

/** The press before it is known to be a drag. */
interface Press {
  pointerId: number;
  from: number;
  x: number;
  y: number;
  rects: { left: number; width: number }[];
  dragging: boolean;
}

export function TabStrip({
  label,
  tabs,
  selected,
  onSelect,
  onClose,
  onMove,
  dragPreview,
}: {
  /** The tablist's accessible name. */
  label: string;
  tabs: readonly TabStripTab[];
  selected: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  /** Called once, when a drag is dropped over the strip somewhere other than where it began. */
  onMove: (from: number, to: number) => void;
  /** The catalogue's `dragging` story: the strip drawn mid-drag, the tab `key` held `dx` px from its place. */
  dragPreview?: { key: string; dx: number };
}) {
  const strip = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  /** Set by a drag's end, so the click the browser sends after it does not also select the tab. */
  const dropped = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);

  const tabRects = () => [...(strip.current?.querySelectorAll<HTMLElement>(".ui-tab") ?? [])].map((el) => el.getBoundingClientRect());

  useLayoutEffect(() => {
    if (!dragPreview) return;
    const rects = tabRects();
    const from = tabs.findIndex((t) => t.key === dragPreview.key);
    const box = rects[from];
    if (!box) return;
    setDrag({ from, dx: dragPreview.dx, to: dropIndex(box.left + box.width / 2 + dragPreview.dx, rects, from), width: box.width });
    // The story is drawn once; its preview never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The showing tab is kept in view (PRD rule 20). The strip is scrolled by hand rather than with scrollIntoView,
  // which would also scroll the reader and the window's own boxes, clipped or not, to reach it.
  useEffect(() => {
    const box = strip.current;
    const tab = box?.querySelector<HTMLElement>('.ui-tab[aria-selected="true"]');
    if (!box || !tab) return;
    if (tab.offsetLeft < box.scrollLeft) box.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = tab.offsetLeft + tab.offsetWidth - box.clientWidth;
  }, [selected, tabs.length]);

  const end = (e: React.PointerEvent<HTMLDivElement>, drop: boolean) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    press.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Never captured: a click, or a synthetic pointer (the e2e).
    }
    if (!p.dragging) return;
    // The click the browser sends right after this release is the drag's, not a click on a tab; once it has come
    // and gone, clicks are clicks again.
    dropped.current = true;
    window.setTimeout(() => (dropped.current = false), 0);
    setDrag(null);
    const box = strip.current?.getBoundingClientRect();
    const over = box !== undefined && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
    // Released anywhere but over the strip, the drag is cancelled and the order stays as it was.
    const to = dropIndex(e.clientX, p.rects, p.from);
    if (drop && over && to !== p.from) onMove(p.from, to);
  };

  const shift = (i: number): number => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.width;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.width;
    return 0;
  };

  return (
    <div
      ref={strip}
      className="ui-tabstrip"
      role="tablist"
      aria-label={label}
      data-dragging={drag ? "" : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as Element).closest(".ui-tab-close")) return;
        const tab = (e.target as Element).closest<HTMLElement>(".ui-tab");
        const from = tab ? tabs.findIndex((t) => t.key === tab.dataset.path) : -1;
        if (from < 0) return;
        dropped.current = false;
        press.current = { pointerId: e.pointerId, from, x: e.clientX, y: e.clientY, rects: tabRects(), dragging: false };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.pointerId !== e.pointerId) return;
        const dx = e.clientX - p.x;
        if (!p.dragging) {
          if (!pastThreshold(dx, e.clientY - p.y)) return;
          p.dragging = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // A synthetic pointer (the e2e) has no capture; its moves still reach the strip.
          }
        }
        setDrag({ from: p.from, dx, to: dropIndex(e.clientX, p.rects, p.from), width: p.rects[p.from]?.width ?? 0 });
      }}
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
    >
      {tabs.map((tab, i) => {
        const held = drag?.from === i;
        const dx = held ? drag.dx : shift(i);
        return (
          <div
            key={tab.key}
            className="ui-tab"
            role="tab"
            aria-selected={tab.key === selected}
            data-path={tab.key}
            data-dragging={held ? "" : undefined}
            title={tab.title}
            style={dx ? { transform: `translateX(${dx}px)` } : undefined}
            onClick={() => {
              // A drag never opens, closes or switches to a tab (PRD rule 19).
              if (dropped.current) {
                dropped.current = false;
                return;
              }
              if (tab.key !== selected) onSelect(tab.key);
            }}
            // A middle-click closes, as in any editor's strip; the strip's mousedown already kept WebKit from
            // autoscrolling or pasting.
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              onClose(tab.key);
            }}
          >
            <FileIcon size="sm" />
            <span className="ui-tab-name">
              {tab.name}
              {tab.detail && <span className="ui-tab-detail"> · {tab.detail}</span>}
            </span>
            <button
              type="button"
              className="ui-tab-close"
              aria-label={`Close ${tab.name}`}
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.key);
              }}
            >
              <CloseIcon size="sm" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
