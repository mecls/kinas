import { describe, expect, test } from "bun:test";
import type { ChangeEntry, DirEntry, TreeChanges } from "../api.ts";
import { captionFor, createChangesStore, folderMarksOf, mergeDeleted, sinceLabel, waitingCount, wordsFor } from "./changes.ts";

const at1402 = new Date(2026, 8, 23, 14, 2).getTime();

const summary = (over: Partial<TreeChanges> = {}): TreeChanges => ({
  root: "/p/kinas",
  since_ms: at1402,
  watching: true,
  ready: true,
  total: 0,
  entries: [],
  folders: [],
  touched: [],
  ...over,
});

const file = (path: string, mark: "A" | "M" | "D", since_ms = at1402, waits = false): ChangeEntry => ({ path, kind: "file", mark, since_ms, waits });
const dir = (path: string, mark: "A" | "M" | "D", since_ms = at1402, waits = false): ChangeEntry => ({ path, kind: "dir", mark, since_ms, waits });
const listed = (path: string, kind: "file" | "dir" = "file"): DirEntry => ({ name: path.slice(path.lastIndexOf("/") + 1), path, kind });

describe("the words a tree says (tree changes rules 8, 10 and 11)", () => {
  test("sinceLabel is local HH:MM", () => {
    expect(sinceLabel(at1402)).toBe("14:02");
    expect(sinceLabel(new Date(2026, 8, 23, 9, 5).getTime())).toBe("09:05");
  });

  test("wordsFor_says_each_mark_and_the_time", () => {
    expect(wordsFor("new-note.md", "A", null, "14:02", false)).toBe("new-note.md, added since 14:02");
    expect(wordsFor("overview.md", "M", null, "14:02", false)).toBe("overview.md, modified since 14:02");
    expect(wordsFor("old-plan.md", "D", null, "14:02", false)).toBe("old-plan.md, deleted since 14:02");
    expect(wordsFor("docs", null, { path: "/p/kinas/docs", count: 3, strongest: "D", since_ms: at1402 }, "14:02", false)).toBe("docs, 3 changes inside since 14:02");
    expect(wordsFor("app", null, { path: "/p/kinas/app", count: 1, strongest: "M", since_ms: at1402 }, "14:02", false)).toBe("app, 1 change inside since 14:02");
    expect(wordsFor("README.md", null, null, "14:02", false)).toBeNull();
  });

  test("wordsFor_says_waits_as_not_pushed", () => {
    // Tree changes clear on push (rule 13): a mark a push would clear says so; a roll-up never does.
    expect(wordsFor("overview.md", "M", null, "14:02", true)).toBe("overview.md, modified since 14:02, not pushed");
    expect(wordsFor("new-note.md", "A", null, "15:31", true)).toBe("new-note.md, added since 15:31, not pushed");
    expect(wordsFor("build-spec.md", "M", null, "14:02", false)).toBe("build-spec.md, modified since 14:02");
    expect(wordsFor("docs", null, { path: "/p/kinas/docs", count: 3, strongest: "M", since_ms: at1402 }, "14:02", true)).toBe("docs, 3 changes inside since 14:02");
  });

  test("waitingCount_counts_waiting_entries", () => {
    const s = summary({ total: 3, entries: [file("/p/kinas/a.md", "M", at1402, true), file("/p/kinas/b.md", "M"), dir("/p/kinas/new", "A", at1402, true)] });
    expect(waitingCount(s)).toBe(2);
    expect(waitingCount(summary())).toBe(0);
  });

  test("captionFor_counts_and_pluralises", () => {
    expect(captionFor({ total: 1, since: "14:02", watching: true }, "kinas")).toBe("1 change since 14:02");
    expect(captionFor({ total: 5, since: "14:02", watching: true }, "kinas")).toBe("5 changes since 14:02");
    expect(captionFor({ total: 0, since: "14:02", watching: true }, "kinas")).toBeNull();
    expect(captionFor({ total: 0, since: "14:02", watching: false }, "kinas")).toBe("Not following changes in kinas");
  });
});

describe("deleted rows stay where they were (rule 9)", () => {
  test("mergeDeleted_puts_ghosts_in_list_dir_order", () => {
    const entries = [listed("/p/kinas/docs/adr", "dir"), listed("/p/kinas/docs/new-note.md"), listed("/p/kinas/docs/Overview.md"), listed("/p/kinas/docs/smoke-test.md")];
    const merged = mergeDeleted(entries, [file("/p/kinas/docs/old-plan.md", "D"), dir("/p/kinas/docs/drafts", "D"), file("/p/kinas/docs/zz.md", "D")]);
    expect(merged.map((r) => `${"gone" in r ? "gone " : ""}${r.name}`)).toEqual(["adr", "gone drafts", "new-note.md", "gone old-plan.md", "Overview.md", "smoke-test.md", "gone zz.md"]);
  });

  test("a deleted entry the listing still holds is drawn once, and nothing deleted leaves the listing as it was", () => {
    const entries = [listed("/p/kinas/a.md"), listed("/p/kinas/b.md")];
    expect(mergeDeleted(entries, [file("/p/kinas/b.md", "D")]).map((r) => r.name)).toEqual(["a.md", "b.md"]);
    expect(mergeDeleted(entries, [])).toBe(entries);
  });
});

describe("the marks a folder's rows read", () => {
  const marks = folderMarksOf(
    summary({
      total: 4,
      entries: [dir("/p/kinas/research", "A"), file("/p/kinas/docs/old-plan.md", "D"), file("/p/kinas/docs/overview.md", "M"), file("/p/kinas/app/main.rs", "M")],
      folders: [
        { path: "/p/kinas/docs", count: 2, strongest: "D", since_ms: at1402 },
        { path: "/p/kinas/app", count: 1, strongest: "M", since_ms: at1402 },
      ],
    }),
    () => 0,
  );

  test("a_row_under_an_added_folder_is_added", () => {
    expect(marks.markOf("/p/kinas/research")).toBe("A");
    expect(marks.markOf("/p/kinas/research/deep/note.md")).toBe("A");
    // A sibling whose name only starts the same is not inside it.
    expect(marks.markOf("/p/kinas/research-old.md")).toBeNull();
  });

  test("own marks, roll-ups and what was deleted from each folder", () => {
    expect(marks.markOf("/p/kinas/docs/overview.md")).toBe("M");
    expect(marks.markOf("/p/kinas/README.md")).toBeNull();
    expect(marks.rollupOf("/p/kinas/docs")).toEqual({ path: "/p/kinas/docs", count: 2, strongest: "D", since_ms: at1402 });
    expect(marks.rollupOf("/p/kinas/research")).toBeNull();
    expect(marks.deletedIn("/p/kinas/docs")).toEqual([file("/p/kinas/docs/old-plan.md", "D")]);
    expect(marks.deletedIn("/p/kinas")).toEqual([]);
    expect(marks.sinceOf("/p/kinas/docs/overview.md")).toBe("14:02");
  });

  test("folderMarksOf_gives_each_row_its_own_since", () => {
    // Tree changes clear on push (rule 12): a row counts from its own moment — the tree's first showing, or the push
    // that last made it its starting point — and a roll-up from the earliest of what it counts.
    const at1531 = new Date(2026, 8, 25, 15, 31).getTime();
    const pushed = folderMarksOf(
      summary({
        total: 3,
        entries: [file("/p/kinas/docs/overview.md", "M", at1531), file("/p/kinas/docs/plan.md", "M"), dir("/p/kinas/research", "A", at1531)],
        folders: [{ path: "/p/kinas/docs", count: 2, strongest: "M", since_ms: at1402 }],
      }),
      () => 0,
    );
    expect(pushed.sinceOf("/p/kinas/docs/overview.md")).toBe("15:31");
    expect(pushed.sinceOf("/p/kinas/docs/plan.md")).toBe("14:02");
    expect(pushed.sinceOf("/p/kinas/research/deep/idea.md")).toBe("15:31");
    expect(pushed.sinceOf("/p/kinas/docs")).toBe("14:02");
    expect(pushed.sinceOf("/p/kinas/README.md")).toBe("");
  });

  test("a row waits for a push as its entry, or its added folder, says", () => {
    const marks = folderMarksOf(summary({ total: 2, entries: [file("/p/kinas/a.md", "M", at1402, true), dir("/p/kinas/notes", "A")] }), () => 0);
    expect([marks.waitsOf("/p/kinas/a.md"), marks.waitsOf("/p/kinas/notes/n.md"), marks.waitsOf("/p/kinas/README.md")]).toEqual([true, false, false]);
  });

  test("no summary, or one with nothing in it, marks nothing but still follows re-listing", () => {
    for (const s of [null, summary()]) {
      const none = folderMarksOf(s, (d) => (d === "/p/kinas" ? 3 : 0));
      expect([none.markOf("/p/kinas/a.md"), none.rollupOf("/p/kinas/docs"), none.deletedIn("/p/kinas")]).toEqual([null, null, []]);
      expect(none.touchedSeq("/p/kinas")).toBe(3);
    }
  });
});

describe("the store keeps each root's latest summary", () => {
  test("a_new_summary_replaces_the_old_one_whole", () => {
    const store = createChangesStore();
    const one = summary({ total: 2, entries: [file("/p/kinas/a.md", "M"), file("/p/kinas/b.md", "M")] });
    const two = summary({ total: 1, entries: [file("/p/kinas/b.md", "M")] });
    store.accept(one);
    store.accept(two);
    expect(store.summaryOf("/p/kinas")).toBe(two);
  });

  test("touched_bumps_only_named_folders", () => {
    const store = createChangesStore();
    store.accept(summary({ touched: ["/p/kinas/docs"] }));
    store.accept(summary({ touched: ["/p/kinas/docs", "/p/kinas"] }));
    expect([store.touchedSeq("/p/kinas/docs"), store.touchedSeq("/p/kinas"), store.touchedSeq("/p/kinas/app")]).toEqual([2, 1, 0]);
  });

  test("a tree asking by another path finds its root's summary through the watch's answer", () => {
    const store = createChangesStore();
    expect(store.summaryOf("/Users/me/kinas")).toBeNull();
    const answer = summary({ root: "/Volumes/Work/kinas" });
    store.seed("/Users/me/kinas", answer);
    expect(store.summaryOf("/Users/me/kinas")).toBe(answer);
    const burst = summary({ root: "/Volumes/Work/kinas", total: 1, entries: [file("/Volumes/Work/kinas/a.md", "M")] });
    store.accept(burst);
    expect(store.summaryOf("/Users/me/kinas")).toBe(burst);
  });

  test("a watch's answer arriving after a burst never replaces it", () => {
    const store = createChangesStore();
    const burst = summary({ total: 1, entries: [file("/p/kinas/a.md", "M")] });
    store.accept(burst);
    store.seed("/p/kinas", summary());
    expect(store.summaryOf("/p/kinas")).toBe(burst);
  });

  test("useMarkOf_prefers_the_deepest_root", () => {
    const store = createChangesStore();
    store.accept(summary({ root: "/p/kinas", since_ms: 1_000, total: 1, entries: [file("/p/kinas/tasks/plan.md", "M", 1_000)] }));
    store.accept(summary({ root: "/p/kinas/tasks", since_ms: 2_000, total: 1, entries: [file("/p/kinas/tasks/plan.md", "A", 2_000)] }));
    expect(store.markOf("/p/kinas/tasks/plan.md")).toEqual({ mark: "A", since_ms: 2_000 });
    // Only the outer root marks it: the outer root answers.
    store.accept(summary({ root: "/p/kinas/tasks", since_ms: 2_000 }));
    expect(store.markOf("/p/kinas/tasks/plan.md")).toEqual({ mark: "M", since_ms: 1_000 });
    // Inside an added folder, A; a root is not inside itself; unmarked is null.
    store.accept(summary({ root: "/p/site", since_ms: 3_000, total: 1, entries: [dir("/p/site/research", "A", 3_000)] }));
    expect(store.markOf("/p/site/research/deep/idea.md")).toEqual({ mark: "A", since_ms: 3_000 });
  });

  test("markOf_answers_the_entry_s_own_since", () => {
    // Not the root's caption time: the path's own, which a push may have moved on (tree changes clear on push).
    const store = createChangesStore();
    store.accept(summary({ root: "/p/kinas", since_ms: 1_000, total: 2, entries: [file("/p/kinas/a.md", "M", 1_000), file("/p/kinas/b.md", "M", 5_000), dir("/p/kinas/new", "A", 7_000)] }));
    expect(store.markOf("/p/kinas/b.md")).toEqual({ mark: "M", since_ms: 5_000 });
    expect(store.markOf("/p/kinas/new/inside.md")).toEqual({ mark: "A", since_ms: 7_000 });
    expect(store.markOf("/p/site")).toBeNull();
    expect(store.markOf("/p/kinas/README.md")).toBeNull();
  });

  test("subscribers hear every change, and stop hearing once they leave", () => {
    const store = createChangesStore();
    let heard = 0;
    const leave = store.subscribe(() => heard++);
    store.accept(summary());
    store.seed("/p/kinas", summary());
    leave();
    store.accept(summary());
    expect(heard).toBe(2);
  });
});
