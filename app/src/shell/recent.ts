// The sidebar's Recent list: the files opened in the reader this session, newest first. Pure, so bun tests cover it.
//
// In memory only, by design (three-column shell §6.8): the reader's privacy rule keeps file paths out of the store
// and out of the log, and the one deliberate exception is a pin — an explicit click. What was merely opened is
// forgotten when Kinas quits.

export interface RecentEntry {
  path: string;
  displayPath: string;
}

export const RECENT_CAP = 15;

/** `entry` moved to the front, once, and the list kept to the cap. Returns the same list when nothing changes. */
export function pushRecent(list: readonly RecentEntry[], entry: RecentEntry, cap = RECENT_CAP): readonly RecentEntry[] {
  if (list[0]?.path === entry.path && list[0].displayPath === entry.displayPath) return list;
  return [entry, ...list.filter((e) => e.path !== entry.path)].slice(0, cap);
}
