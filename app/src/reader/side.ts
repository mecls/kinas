// The reader's side column: Files above Contents, beside the text while the reader is wide, over it while narrow
// (tasks/reader-layout/prd.md rules 1–7). Pure, so bun tests cover it without the DOM.
import type { ReaderSide } from "../api.ts";

/** What the column is until the captain changes it. Must equal READER_SIDE_DEFAULT in commands.rs. */
export const SIDE_DEFAULT: ReaderSide = { contents: true, files: true, width: 220 };
export const SIDE_MIN_PX = 160;
export const SIDE_MAX_PX = 480;
/** The text never gets less than this beside the column. */
export const TEXT_MIN_PX = 320;

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
