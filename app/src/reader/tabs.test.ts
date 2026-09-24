import { describe, expect, test } from "bun:test";
import { closeTab, moveTab, NO_TABS, openTab, rememberScroll, showNone, TABS_CAP, tabLabels, type Tabs } from "./tabs.ts";

const file = (n: number) => ({ path: `/root/tab-${String(n).padStart(2, "0")}.md`, displayPath: `tab-${String(n).padStart(2, "0")}.md` });
const paths = (tabs: Tabs) => tabs.list.map((t) => t.path);
/** Opens files 1..n in order. */
const opened = (n: number) => Array.from({ length: n }, (_, i) => file(i + 1)).reduce((tabs, f) => openTab(tabs, f), NO_TABS);

describe("the reader's tabs (reader-layout PRD rules 12–17)", () => {
  test("a new file is appended and shown", () => {
    const tabs = opened(3);
    expect(paths(tabs)).toEqual([file(1).path, file(2).path, file(3).path]);
    expect(tabs.showing).toBe(file(3).path);
    expect(tabs.shown[0]).toBe(file(3).path);
    expect(tabs.list[2]!.scrollTop).toBe(0);
  });

  test("a file already open is brought forward in place", () => {
    const tabs = openTab(opened(3), file(1));
    expect(paths(tabs)).toEqual([file(1).path, file(2).path, file(3).path]);
    expect(tabs.showing).toBe(file(1).path);
    expect(tabs.shown).toEqual([file(1).path, file(3).path, file(2).path]);
  });

  test("the sixteenth file pushes out the tab shown longest ago", () => {
    const full = openTab(opened(TABS_CAP), file(3));
    const longestAgo = full.shown.at(-1);
    expect(longestAgo).toBe(file(1).path);
    const tabs = openTab(full, file(16));
    expect(tabs.list.length).toBe(15);
    expect(paths(tabs)).not.toContain(longestAgo);
    expect(paths(tabs).at(-1)).toBe(file(16).path);
  });

  test("the tab showing is never pushed out", () => {
    // The first tab in the strip, but shown last: it outlasts every tab shown before it.
    let tabs = openTab(opened(TABS_CAP), file(1));
    for (let n = 16; n <= 29; n++) tabs = openTab(tabs, file(n));
    expect(paths(tabs)).toContain(file(1).path);
    expect(paths(tabs)).not.toContain(file(15).path);
    // Whatever the cap, the file just opened is kept.
    expect(paths(openTab(opened(3), file(9), 1))).toEqual([file(9).path]);
  });

  test("closing the showing tab shows the one shown before it", () => {
    const tabs = openTab(openTab(opened(4), file(2)), file(4));
    const previous = tabs.shown[1];
    const closed = closeTab(tabs, file(4).path);
    expect(closed.showing).toBe(previous!);
    expect(paths(closed)).toEqual([file(1).path, file(2).path, file(3).path]);
    // Closing a tab in the background leaves the showing one alone.
    expect(closeTab(tabs, file(1).path).showing).toBe(file(4).path);
  });

  test("closing the last tab leaves none showing", () => {
    const closed = closeTab(opened(1), file(1).path);
    expect(closed.list.length).toBe(0);
    expect(closed.showing).toBeNull();
  });

  test("a move keeps every other tab's relative order", () => {
    const tabs = opened(5);
    const [a, b, c, d, e] = paths(tabs);
    expect(paths(moveTab(tabs, 4, 0))).toEqual([e, a, b, c, d]);
    expect(paths(moveTab(tabs, 0, 4))).toEqual([b, c, d, e, a]);
    expect(moveTab(tabs, 2, 2)).toBe(tabs);
    expect(moveTab(tabs, 4, 0).showing).toBe(tabs.showing);
  });

  test("two files of one name are told apart by their folder", () => {
    const tabs = [
      { path: "/r/tasks/first-mate/prd.md", displayPath: "tasks/first-mate/prd.md", scrollTop: 0 },
      { path: "/r/tasks/reader-layout/prd.md", displayPath: "tasks/reader-layout/prd.md", scrollTop: 0 },
      { path: "/r/tasks/reader-layout/status.md", displayPath: "tasks/reader-layout/status.md", scrollTop: 0 },
    ];
    expect(tabLabels(tabs)).toEqual([
      { name: "prd.md", detail: "first-mate" },
      { name: "prd.md", detail: "reader-layout" },
      { name: "status.md", detail: null },
    ]);
  });

  test("remembered scroll survives a move and a bring-forward", () => {
    let tabs = rememberScroll(opened(3), file(1).path, 640);
    tabs = moveTab(tabs, 0, 2);
    tabs = openTab(tabs, file(1));
    expect(tabs.list.find((t) => t.path === file(1).path)!.scrollTop).toBe(640);
    expect(rememberScroll(tabs, "/not/a/tab.md", 5)).toBe(tabs);
  });

  test("a folder with no README leaves the tabs, with none showing", () => {
    const tabs = showNone(opened(2));
    expect(tabs.showing).toBeNull();
    expect(paths(tabs)).toEqual([file(1).path, file(2).path]);
    // Opening a file after it shows that file again.
    expect(openTab(tabs, file(1)).showing).toBe(file(1).path);
  });
});
