// The places ← and → walk (tasks/reader-layout/prd.md rules 29–31): the page showing and what the reader shows, in
// the order the captain was there, like a browser's history. Pure, so bun tests cover it without the DOM. In memory
// only, like the tabs: a place holds a path the captain merely opened, and the one path Kinas stores is a pin
// (ADR 0007).

/** Fifty, the reader's Back limit before (its `BACK_CAP`), which ← replaces. */
export const HISTORY_CAP = 50;

/** What the reader shows at a place: a file, where it was scrolled when it was left; a folder with no file; nothing. */
export type ReaderAt = { kind: "file"; path: string; scrollTop: number } | { kind: "folder"; path: string } | { kind: "none" };

export interface Place<P extends string = string> {
  page: P;
  reader: ReaderAt;
}

export interface History<P extends string = string> {
  places: readonly Place<P>[];
  /** The place showing: an index into `places`, or -1 before the first is recorded. */
  at: number;
}

export const EMPTY_HISTORY: History<never> = { places: [], at: -1 };

/**
 * What the reader's report says it shows, as a place's reader part: its file first, then a folder with no file, and
 * nothing while the panel is closed. File first is Recent's old step-gating: `kinas open <dir>` reports the folder
 * while the file open before is still reported, and that step must not be a place of its own.
 */
export function readerAtOf(nav: { doc: { path: string } | null; folder: string | null }, open: boolean): ReaderAt {
  if (!open) return { kind: "none" };
  if (nav.doc) return { kind: "file", path: nav.doc.path, scrollTop: 0 };
  if (nav.folder) return { kind: "folder", path: nav.folder };
  return { kind: "none" };
}

/** One place, whatever the scroll: a scroll is never a place (rule 29). */
export function samePlace(a: Place, b: Place): boolean {
  if (a.page !== b.page || a.reader.kind !== b.reader.kind) return false;
  return a.reader.kind === "none" || a.reader.path === (b.reader as { path: string }).path;
}

/**
 * A place the captain has come to. The place showing again changes nothing, and gives back the same history. After
 * ←, every place ahead is dropped, as a browser does; past the cap the oldest goes.
 */
export function record<P extends string>(h: History<P>, place: Place<P>, cap = HISTORY_CAP): History<P> {
  const current = h.places[h.at];
  if (current && samePlace(current, place)) return h;
  const places = [...h.places.slice(0, h.at + 1), place].slice(-Math.max(1, cap));
  return { places, at: places.length - 1 };
}

/**
 * Where a file was scrolled when the reader left it, onto the place it was left from — the one showing, unless
 * ← or → has already moved on and says which (`index`). Nothing else changes, and a place that is not that file keeps
 * what it had.
 */
export function patchScroll<P extends string>(h: History<P>, path: string, scrollTop: number, index = h.at): History<P> {
  const place = h.places[index];
  if (!place || place.reader.kind !== "file" || place.reader.path !== path || place.reader.scrollTop === scrollTop) return h;
  const places = h.places.map((p, i) => (i === index ? { ...p, reader: { kind: "file" as const, path, scrollTop } } : p));
  return { ...h, places };
}

/** One place back: where to go, and the history pointing there. Null at the first place. */
export function back<P extends string>(h: History<P>): { history: History<P>; place: Place<P> } | null {
  const place = h.places[h.at - 1];
  return h.at > 0 && place ? { history: { ...h, at: h.at - 1 }, place } : null;
}

/** One place forward, undoing a ←. Null at the newest place. */
export function forward<P extends string>(h: History<P>): { history: History<P>; place: Place<P> } | null {
  const place = h.places[h.at + 1];
  return place ? { history: { ...h, at: h.at + 1 }, place } : null;
}

export const canBack = (h: History) => h.at > 0;
export const canForward = (h: History) => h.at < h.places.length - 1;
