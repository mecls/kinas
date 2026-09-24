// The reader's side column: Files above Contents, beside the text while the reader is wide, over it while narrow
// (tasks/reader-layout/prd.md rules 1–7). Pure, so bun tests cover it without the DOM.
import type { ReaderSide } from "../api.ts";

/** What the column is until the captain changes it. Must equal READER_SIDE_DEFAULT in commands.rs. */
export const SIDE_DEFAULT: ReaderSide = { contents: true, files: true, width: 220 };
export const SIDE_MIN_PX = 160;
export const SIDE_MAX_PX = 480;
/** The text never gets less than this beside the column. */
export const TEXT_MIN_PX = 320;

/**
 * What the column is drawn at: the stored width, but never so wide the text gets less than 320 px. The stored width
 * is kept, so widening the reader brings it back (PRD rule 6). A reader not measured yet draws the stored width.
 */
export function drawnWidth(stored: number, readerWidth: number): number {
  if (readerWidth <= 0) return stored;
  return Math.max(SIDE_MIN_PX, Math.min(stored, readerWidth - TEXT_MIN_PX));
}

/** What a drag asks for: the pointer's distance from the column's left edge, kept in 160..min(480, reader − 320). */
export function dragWidth(fromLeft: number, readerWidth: number): number {
  const high = Math.max(SIDE_MIN_PX, Math.min(SIDE_MAX_PX, readerWidth - TEXT_MIN_PX));
  return Math.round(Math.min(high, Math.max(SIDE_MIN_PX, fromLeft)));
}

/**
 * The column's edge being dragged, as numbers rather than DOM events, so a test can count what it saves (build spec
 * §6.4: one store write per gesture, never one per move). The width follows every move through `live`; the end of a
 * drag saves once, and only if the width changed — a press and release where it was saves nothing, so a double-click
 * saves just its 220. A cancelled drag keeps the width it reached.
 */
export function edgeDrag(on: { live: (width: number | null) => void; save: (width: number) => void }) {
  let from: number | null = null;
  let last = 0;
  return {
    /** A press on the edge, with the width the column is drawn at. */
    down(drawn: number) {
      from = drawn;
      last = drawn;
      on.live(drawn);
    },
    move(fromLeft: number, readerWidth: number) {
      if (from === null) return;
      last = dragWidth(fromLeft, readerWidth);
      on.live(last);
    },
    /** A release or a cancel: whichever comes first ends the drag, and a second does nothing. */
    end() {
      if (from === null) return;
      const changed = last !== from;
      from = null;
      on.live(null);
      if (changed) on.save(last);
    },
    get dragging() {
      return from !== null;
    },
  };
}

/** One section's circumstances: whether the document offers it, the reader's width, and both remembered states. */
export interface SectionState {
  /** The header's label and the tooltip's noun. */
  name: "Files" | "Contents";
  /** Contents: a document taller than the reader with two headings or more (R28). Files: the reader draws its tree. */
  offered: boolean;
  /** Under 640 px: the section opens over the text, as a peek. */
  narrow: boolean;
  /** What wide remembers (`reader_side`). A narrow click never changes it. */
  shown: boolean;
  /** Whether this section is the narrow overlay that is open. */
  overlayOpen: boolean;
}

/**
 * One header button's state, or null when it is not drawn. Wide, it is pressed while its section shows and its
 * tooltip says what a click will do; narrow, it is the overlay's, pressed while that is open.
 */
export function sectionButton(s: SectionState): { pressed: boolean; title: string } | null {
  if (!s.offered) return null;
  if (s.narrow) return { pressed: s.overlayOpen, title: s.name };
  return { pressed: s.shown, title: `${s.shown ? "Hide" : "Show"} ${s.name}` };
}

/** Where a section is drawn: beside the text, over it (the narrow overlay), or not at all. */
export function sectionPlace(s: SectionState): "beside" | "over" | null {
  if (!s.offered) return null;
  if (s.narrow) return s.overlayOpen ? "over" : null;
  return s.shown ? "beside" : null;
}
