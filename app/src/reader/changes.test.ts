import { describe, expect, test } from "bun:test";
import type { TreeChanges } from "../api.ts";
import { captionFor, createChangesStore, sinceLabel, wordsFor } from "./changes.ts";

const at1402 = new Date(2026, 8, 23, 14, 2).getTime();

const summary = (over: Partial<TreeChanges> = {}): TreeChanges => ({
  root: "/p/kinas",
  since_ms: at1402,
  watching: true,
  total: 0,
  entries: [],
  touched: [],
  ...over,
});

describe("the words a tree says (tree changes rules 8 and 11)", () => {
  test("sinceLabel is local HH:MM", () => {
    expect(sinceLabel(at1402)).toBe("14:02");
    expect(sinceLabel(new Date(2026, 8, 23, 9, 5).getTime())).toBe("09:05");
  });

  test("wordsFor_says_each_mark_and_the_time", () => {
    const entry = (mark: "A" | "M" | "D") => ({ path: "/p/kinas/x", kind: "file" as const, mark });
    expect(wordsFor("new-note.md", entry("A"), "14:02")).toBe("new-note.md, added since 14:02");
    expect(wordsFor("overview.md", entry("M"), "14:02")).toBe("overview.md, modified since 14:02");
    expect(wordsFor("old-plan.md", entry("D"), "14:02")).toBe("old-plan.md, deleted since 14:02");
    expect(wordsFor("README.md", null, "14:02")).toBeNull();
  });

  test("captionFor_counts_and_pluralises", () => {
    expect(captionFor({ total: 1, since: "14:02", watching: true }, "kinas")).toBe("1 change since 14:02");
    expect(captionFor({ total: 5, since: "14:02", watching: true }, "kinas")).toBe("5 changes since 14:02");
    expect(captionFor({ total: 0, since: "14:02", watching: true }, "kinas")).toBeNull();
    expect(captionFor({ total: 0, since: "14:02", watching: false }, "kinas")).toBe("Not following changes in kinas");
  });
});

describe("the store keeps each root's latest summary", () => {
  test("a_new_summary_replaces_the_old_one_whole", () => {
    const store = createChangesStore();
    const one = summary({ total: 2, entries: [{ path: "/p/kinas/a.md", kind: "file", mark: "M" }, { path: "/p/kinas/b.md", kind: "file", mark: "M" }] });
    const two = summary({ total: 1, entries: [{ path: "/p/kinas/b.md", kind: "file", mark: "M" }] });
    store.accept(one);
    store.accept(two);
    expect(store.summaryOf("/p/kinas")).toBe(two);
  });

  test("a tree asking by another path finds its root's summary through the watch's answer", () => {
    const store = createChangesStore();
    expect(store.summaryOf("/Users/me/kinas")).toBeNull();
    const answer = summary({ root: "/Volumes/Work/kinas" });
    store.seed("/Users/me/kinas", answer);
    expect(store.summaryOf("/Users/me/kinas")).toBe(answer);
    const burst = summary({ root: "/Volumes/Work/kinas", total: 1, entries: [{ path: "/Volumes/Work/kinas/a.md", kind: "file", mark: "M" }] });
    store.accept(burst);
    expect(store.summaryOf("/Users/me/kinas")).toBe(burst);
  });

  test("a watch's answer arriving after a burst never replaces it", () => {
    const store = createChangesStore();
    const burst = summary({ total: 1, entries: [{ path: "/p/kinas/a.md", kind: "file", mark: "M" }] });
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
