import { describe, expect, test } from "bun:test";
import type { ChangeEntry, DirEntry, TreeChanges } from "../api.ts";
import { captionFor, createChangesStore, folderMarksOf, mergeDeleted, sinceLabel, wordsFor } from "./changes.ts";

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

const file = (path: string, mark: "A" | "M" | "D"): ChangeEntry => ({ path, kind: "file", mark });
const dir = (path: string, mark: "A" | "M" | "D"): ChangeEntry => ({ path, kind: "dir", mark });
const listed = (path: string, kind: "file" | "dir" = "file"): DirEntry => ({ name: path.slice(path.lastIndexOf("/") + 1), path, kind });

describe("the words a tree says (tree changes rules 8, 10 and 11)", () => {
  test("sinceLabel is local HH:MM", () => {
    expect(sinceLabel(at1402)).toBe("14:02");
    expect(sinceLabel(new Date(2026, 8, 23, 9, 5).getTime())).toBe("09:05");
  });

  test("wordsFor_says_each_mark_and_the_time", () => {
    expect(wordsFor("new-note.md", "A", null, "14:02")).toBe("new-note.md, added since 14:02");
    expect(wordsFor("overview.md", "M", null, "14:02")).toBe("overview.md, modified since 14:02");
    expect(wordsFor("old-plan.md", "D", null, "14:02")).toBe("old-plan.md, deleted since 14:02");
    expect(wordsFor("docs", null, { path: "/p/kinas/docs", count: 3, strongest: "D" }, "14:02")).toBe("docs, 3 changes inside since 14:02");
    expect(wordsFor("app", null, { path: "/p/kinas/app", count: 1, strongest: "M" }, "14:02")).toBe("app, 1 change inside since 14:02");
    expect(wordsFor("README.md", null, null, "14:02")).toBeNull();
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
        { path: "/p/kinas/docs", count: 2, strongest: "D" },
        { path: "/p/kinas/app", count: 1, strongest: "M" },
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
    expect(marks.rollupOf("/p/kinas/docs")).toEqual({ path: "/p/kinas/docs", count: 2, strongest: "D" });
    expect(marks.rollupOf("/p/kinas/research")).toBeNull();
    expect(marks.deletedIn("/p/kinas/docs")).toEqual([file("/p/kinas/docs/old-plan.md", "D")]);
    expect(marks.deletedIn("/p/kinas")).toEqual([]);
    expect(marks.since).toBe("14:02");
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
