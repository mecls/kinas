import { useMemo, useSyncExternalStore } from "react";
import { type ChangeEntry, type FolderRollup, type Mark, onTreeChanged, type ReaderKind, type TreeChanges, treeChangesWatch } from "../api.ts";

// Tree changes in the webview (tasks/tree-changes/prd.md): Rust decides every mark and sends a root's whole summary
// after each burst; this module keeps the latest summary per root and hands the trees what to draw. Memory only, and
// gone with the page: a window reload starts every tree afresh (rule 17).

/** What a tree's head needs: how many changes, since when, and whether the root is followed at all. */
export interface TreeSummary {
  total: number;
  /** The baseline, local, "14:02". */
  since: string;
  watching: boolean;
}

/** What a tree's rows need, for one root. */
export interface FolderMarks {
  /** A row's letter: its own mark, or A for anything inside a folder that was added (rule 4). Null for none. */
  markOf(path: string): Mark | null;
  /** A folder's roll-up, when it existed at both moments and has changes beneath it (rule 10). */
  rollupOf(path: string): FolderRollup | null;
  /** What was deleted from `dir`, to be drawn in its place, struck through (rule 9). */
  deletedIn(dir: string): ChangeEntry[];
  /** Grows each time a burst changes something directly in `dir`, so an expanded folder can re-list (rule 7). */
  touchedSeq(dir: string): number;
  since: string;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

/** The baseline as a caption and a tooltip say it: local time, "14:02". */
export function sinceLabel(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

const MARK_WORD = { A: "added", M: "modified", D: "deleted" } as const;

/**
 * A marked row's accessible name and tooltip: "overview.md, modified since 14:02", or for a folder's roll-up "docs, 3
 * changes inside since 14:02". Null for a row with neither.
 */
export function wordsFor(name: string, mark: Mark | null, rollup: FolderRollup | null, since: string): string | null {
  if (mark) return `${name}, ${MARK_WORD[mark]} since ${since}`;
  if (rollup) return `${name}, ${rollup.count} ${rollup.count === 1 ? "change" : "changes"} inside since ${since}`;
  return null;
}

/** The line under a tree's head: "1 change since 14:02", or why there are no marks; null when there is nothing to say. */
export function captionFor(summary: TreeSummary, name: string): string | null {
  if (!summary.watching) return `Not following changes in ${name}`;
  if (summary.total === 0) return null;
  return `${summary.total} ${summary.total === 1 ? "change" : "changes"} since ${summary.since}`;
}

/** A deleted entry drawn where it was. */
export type Gone = ChangeEntry & { name: string; gone: true };

/** `list_dir`'s order (reader/mod.rs): folders first, then by lower-cased name. */
const listOrder = (a: { name: string; kind: ReaderKind }, b: { name: string; kind: ReaderKind }) => {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * A folder's listing with its deleted entries put back where they were. The listing keeps Rust's order untouched —
 * each deleted entry goes in before the first row that sorts after it. One the listing still holds (a re-list not in
 * yet) is not drawn twice.
 */
export function mergeDeleted<T extends { name: string; path: string; kind: ReaderKind }>(entries: T[], deleted: ChangeEntry[]): (T | Gone)[] {
  const present = new Set(entries.map((e) => e.path));
  const gone: Gone[] = deleted
    .filter((d) => !present.has(d.path))
    .map((d) => ({ ...d, name: baseName(d.path), gone: true as const }))
    .sort(listOrder);
  if (gone.length === 0) return entries;
  const merged: (T | Gone)[] = [];
  let g = 0;
  for (const entry of entries) {
    while (g < gone.length && listOrder(gone[g]!, entry) < 0) merged.push(gone[g++]!);
    merged.push(entry);
  }
  return [...merged, ...gone.slice(g)];
}

/** The marks of one summary, indexed for the rows. Pure, so a test can hold one. */
export function folderMarksOf(summary: TreeChanges | null, touchedSeq: (dir: string) => number): FolderMarks {
  if (!summary || (summary.entries.length === 0 && summary.folders.length === 0)) return { ...NO_MARKS, touchedSeq };
  const byPath = new Map(summary.entries.map((entry) => [entry.path, entry]));
  const rollups = new Map(summary.folders.map((rollup) => [rollup.path, rollup]));
  const added = summary.entries.filter((e) => e.kind === "dir" && e.mark === "A").map((e) => `${e.path}/`);
  const deleted = new Map<string, ChangeEntry[]>();
  for (const entry of summary.entries) {
    if (entry.mark !== "D") continue;
    const dir = parentOf(entry.path);
    deleted.set(dir, [...(deleted.get(dir) ?? []), entry]);
  }
  return {
    markOf: (path) => byPath.get(path)?.mark ?? (added.some((dir) => path.startsWith(dir)) ? "A" : null),
    rollupOf: (path) => rollups.get(path) ?? null,
    deletedIn: (dir) => deleted.get(dir) ?? [],
    touchedSeq,
    since: sinceLabel(summary.since_ms),
  };
}

const NO_MARKS: FolderMarks = { markOf: () => null, rollupOf: () => null, deletedIn: () => [], touchedSeq: () => 0, since: "" };

/**
 * The summaries, keyed by the root's real path, with the path each tree asked for mapped onto it. A store of its own
 * so a test can hold one without Tauri; the page uses the one below.
 */
export function createChangesStore() {
  const summaries = new Map<string, TreeChanges>();
  const realOf = new Map<string, string>();
  const seqs = new Map<string, number>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    /** A burst's summary: it replaces the root's last one whole, and the folders it names re-list. */
    accept(summary: TreeChanges) {
      summaries.set(summary.root, summary);
      for (const dir of summary.touched) seqs.set(dir, (seqs.get(dir) ?? 0) + 1);
      changed();
    },
    /**
     * A watch's answer for the path a tree asked about. It only seeds: a burst's summary already held is newer than
     * any answer, because the two travel separately and the answer may arrive last.
     */
    seed(asked: string, summary: TreeChanges) {
      realOf.set(asked, summary.root);
      if (!summaries.has(summary.root)) summaries.set(summary.root, summary);
      changed();
    },
    summaryOf(asked: string | null): TreeChanges | null {
      if (asked === null) return null;
      return summaries.get(realOf.get(asked) ?? asked) ?? null;
    },
    touchedSeq: (dir: string) => seqs.get(dir) ?? 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const store = createChangesStore();
const watched = new Set<string>();
let listening = false;

/** Follows a tree's root, once per root per page load. A refused watch leaves the tree as it is today, unmarked. */
export function watchRoot(root: string): void {
  if (!listening) {
    listening = true;
    void onTreeChanged((summary) => store.accept(summary));
  }
  if (watched.has(root)) return;
  watched.add(root);
  treeChangesWatch(root).then(
    (summary) => store.seed(root, summary),
    () => {},
  );
}

function useSummary(root: string | null): TreeChanges | null {
  return useSyncExternalStore(store.subscribe, () => store.summaryOf(root));
}

export function useTreeChanges(root: string | null): TreeSummary | null {
  const summary = useSummary(root);
  return useMemo(() => (summary ? { total: summary.total, since: sinceLabel(summary.since_ms), watching: summary.watching } : null), [summary]);
}

/** A new object with every summary, so the tree re-renders — and each expanded folder re-reads its `touchedSeq`. */
export function useFolderMarks(root: string): FolderMarks {
  const summary = useSummary(root);
  return useMemo(() => folderMarksOf(summary, store.touchedSeq), [summary]);
}
