// The reader's tabs: every file opened this session, one tab each (tasks/reader-layout/prd.md rules 12–24). Pure, so
// bun tests cover it without the DOM. In memory only, by design: storing the tabs would store every file merely
// opened, and the one path Kinas stores is a pin, because a pin is an explicit click (ADR 0007).

/** Fifteen, the size Recent had (`RECENT_CAP`), which the tabs replace. */
export const TABS_CAP = 15;

export interface Tab {
  /** The real path `reader_open` returned, so `./a.md` and a symlink to it are one tab. */
  path: string;
  /** What `.reader-path` says for it; the tab's tooltip. */
  displayPath: string;
  /** Where it was scrolled when it was last showing. */
  scrollTop: number;
}

export interface Tabs {
  /** In strip order: a new tab goes at the right end, and only a drag moves one. */
  list: readonly Tab[];
  /** The path of the tab showing, or null when none is (a folder with no README). */
  showing: string | null;
  /** Every tab's path, most recently shown first: who goes past the cap, and who shows when the showing one closes. */
  shown: readonly string[];
}

export const NO_TABS: Tabs = { list: [], showing: null, shown: [] };

/**
 * A file the reader now shows: appended at the right end, or brought forward in place, and showing. Past the cap the
 * tab shown longest ago goes — never the one showing, which is the most recently shown by definition.
 */
export function openTab(tabs: Tabs, file: { path: string; displayPath: string }, cap = TABS_CAP): Tabs {
  const known = tabs.list.some((t) => t.path === file.path);
  let list = known
    ? tabs.list.map((t) => (t.path === file.path ? { ...t, displayPath: file.displayPath } : t))
    : [...tabs.list, { path: file.path, displayPath: file.displayPath, scrollTop: 0 }];
  let shown = [file.path, ...tabs.shown.filter((p) => p !== file.path)];
  while (list.length > Math.max(1, cap)) {
    const gone = shown.at(-1);
    list = list.filter((t) => t.path !== gone);
    shown = shown.slice(0, -1);
  }
  return { list, showing: file.path, shown };
}

/** The scroll position a tab had as it stopped showing, so a click brings it back there. */
export function rememberScroll(tabs: Tabs, path: string, scrollTop: number): Tabs {
  if (!tabs.list.some((t) => t.path === path)) return tabs;
  return { ...tabs, list: tabs.list.map((t) => (t.path === path ? { ...t, scrollTop } : t)) };
}

/** Closes a tab. If it was showing, the most recently shown tab still open shows; none left, none shows. */
export function closeTab(tabs: Tabs, path: string): Tabs {
  if (!tabs.list.some((t) => t.path === path)) return tabs;
  const shown = tabs.shown.filter((p) => p !== path);
  return {
    list: tabs.list.filter((t) => t.path !== path),
    showing: tabs.showing === path ? (shown[0] ?? null) : tabs.showing,
    shown,
  };
}

/** Moves the tab at `from` to `to`; every other tab keeps its order. What shows does not change. */
export function moveTab(tabs: Tabs, from: number, to: number): Tabs {
  if (from === to || from < 0 || from >= tabs.list.length) return tabs;
  const list = [...tabs.list];
  const [moved] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, moved!);
  return { ...tabs, list };
}

/** A folder with no README is open: the tabs stay, and none of them is showing. */
export function showNone(tabs: Tabs): Tabs {
  return tabs.showing === null ? tabs : { ...tabs, showing: null };
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const parentOf = (path: string) => nameOf(path.slice(0, Math.max(0, path.lastIndexOf("/"))));

/** Each tab's words: its file's name, and its parent folder's name when another tab has the same file name. */
export function tabLabels(list: readonly Tab[]): { name: string; detail: string | null }[] {
  const count = new Map<string, number>();
  for (const t of list) count.set(nameOf(t.path), (count.get(nameOf(t.path)) ?? 0) + 1);
  return list.map((t) => {
    const name = nameOf(t.path);
    return { name, detail: (count.get(name) ?? 0) > 1 ? parentOf(t.path) || null : null };
  });
}
