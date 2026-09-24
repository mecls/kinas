import { useMemo, useSyncExternalStore } from "react";
import { type ChangeEntry, onTreeChanged, type TreeChanges, treeChangesWatch } from "../api.ts";

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
  /** A path's own mark, or null. */
  entryOf(path: string): ChangeEntry | null;
  since: string;
}

/** The baseline as a caption and a tooltip say it: local time, "14:02". */
export function sinceLabel(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

const MARK_WORD = { A: "added", M: "modified", D: "deleted" } as const;

/** A marked row's accessible name and tooltip: "overview.md, modified since 14:02". Null for an unmarked row. */
export function wordsFor(name: string, entry: ChangeEntry | null, since: string): string | null {
  return entry ? `${name}, ${MARK_WORD[entry.mark]} since ${since}` : null;
}

/** The line under a tree's head: "1 change since 14:02", or why there are no marks; null when there is nothing to say. */
export function captionFor(summary: TreeSummary, name: string): string | null {
  if (!summary.watching) return `Not following changes in ${name}`;
  if (summary.total === 0) return null;
  return `${summary.total} ${summary.total === 1 ? "change" : "changes"} since ${summary.since}`;
}

/**
 * The summaries, keyed by the root's real path, with the path each tree asked for mapped onto it. A store of its own
 * so a test can hold one without Tauri; the page uses the one below.
 */
export function createChangesStore() {
  const summaries = new Map<string, TreeChanges>();
  const realOf = new Map<string, string>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    /** A burst's summary: it replaces the root's last one whole. */
    accept(summary: TreeChanges) {
      summaries.set(summary.root, summary);
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

const NO_MARKS: FolderMarks = { entryOf: () => null, since: "" };

export function useFolderMarks(root: string): FolderMarks {
  const summary = useSummary(root);
  return useMemo(() => {
    if (!summary || summary.entries.length === 0) return NO_MARKS;
    const byPath = new Map(summary.entries.map((entry) => [entry.path, entry]));
    return { entryOf: (path) => byPath.get(path) ?? null, since: sinceLabel(summary.since_ms) };
  }, [summary]);
}
