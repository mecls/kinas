// The sidebar's Recent list: the files and folders opened this session, newest first. Pure, so bun tests cover it.
//
// In memory only, by design (three-column shell §6.8): the reader's privacy rule keeps file paths out of the store
// and out of the log, and the one deliberate exception is a pin — an explicit click. What was merely opened is
// forgotten when Kinas quits.

export interface RecentEntry {
  path: string;
  displayPath: string;
  kind: "file" | "dir";
}

export const RECENT_CAP = 15;

/** `entry` moved to the front, once, and the list kept to the cap. Returns the same list when nothing changes. */
export function pushRecent(list: readonly RecentEntry[], entry: RecentEntry, cap = RECENT_CAP): readonly RecentEntry[] {
  const front = list[0];
  if (front?.path === entry.path && front.displayPath === entry.displayPath && front.kind === entry.kind) return list;
  return [entry, ...list.filter((e) => e.path !== entry.path)].slice(0, cap);
}

/** A folder as Recent lists it. It has no display path of its own: the reader reports a folder as a bare path. */
export const recentFolder = (path: string): RecentEntry => ({ path, displayPath: path, kind: "dir" });

/** What the reader reports it has open (`ReaderNav`), as far as Recent cares. */
export interface NavReport {
  doc: { path: string; displayPath: string } | null;
  folder: string | null;
}

/** The last report, reduced to what tells a change from a repeat. */
export interface NavSeen {
  folder: string | null;
  doc: string | null;
}

export const NAV_NOTHING: NavSeen = { folder: null, doc: null };

export const navSeenOf = (next: NavReport): NavSeen => ({ folder: next.folder, doc: next.doc ? `${next.doc.path}\n${next.doc.displayPath}` : null });

/**
 * Recent after the reader reports `next`, having last reported `seen`. A folder goes to the front when the open
 * folder **changes to it**, a file when the open file changes to it — each only on its own change, the folder first
 * so the file it opened with sits above it.
 *
 * Both are gated because the reader reports in steps: `kinas open <dir>` first reports the new folder with the
 * *previous* file still open, then the folder's README. Pushing the file on every report would lift that previous
 * file above the folder just opened; pushing the folder on every report would drag it back to the front with each
 * file read inside it. A folder that closes (`seen.folder` back to null) and is opened again counts as a change.
 */
export function recentAfterNav(list: readonly RecentEntry[], seen: NavSeen, next: NavReport, cap = RECENT_CAP): readonly RecentEntry[] {
  const now = navSeenOf(next);
  let after = list;
  if (next.folder !== null && now.folder !== seen.folder) after = pushRecent(after, recentFolder(next.folder), cap);
  if (next.doc !== null && now.doc !== seen.doc) after = pushRecent(after, { ...next.doc, kind: "file" }, cap);
  return after;
}
