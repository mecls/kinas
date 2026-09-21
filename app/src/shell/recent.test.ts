import { describe, expect, test } from "bun:test";
import { NAV_NOTHING, navSeenOf, type NavReport, type NavSeen, pushRecent, RECENT_CAP, recentAfterNav, recentFolder, type RecentEntry } from "./recent.ts";

const entry = (n: number): RecentEntry => ({ path: `/p/file-${n}.md`, displayPath: `file-${n}.md`, kind: "file" });

describe("the sidebar's Recent list", () => {
  test("the newest file is first", () => {
    const list = pushRecent(pushRecent([], entry(1)), entry(2));
    expect(list.map((e) => e.displayPath)).toEqual(["file-2.md", "file-1.md"]);
  });

  test("a file opened again moves to the front and is listed once", () => {
    let list: readonly RecentEntry[] = [];
    for (const n of [1, 2, 3, 1]) list = pushRecent(list, entry(n));
    expect(list.map((e) => e.displayPath)).toEqual(["file-1.md", "file-3.md", "file-2.md"]);
  });

  test("holds 15 and forgets the oldest", () => {
    let list: readonly RecentEntry[] = [];
    for (let n = 1; n <= 16; n++) list = pushRecent(list, entry(n));
    expect(RECENT_CAP).toBe(15);
    expect(list).toHaveLength(15);
    expect(list[0]?.displayPath).toBe("file-16.md");
    expect(list.at(-1)?.displayPath).toBe("file-2.md");
    // The first file opened again comes back to the front; still 15, still no duplicate.
    list = pushRecent(list, entry(1));
    expect(list).toHaveLength(15);
    expect(list[0]?.displayPath).toBe("file-1.md");
    expect(new Set(list.map((e) => e.path)).size).toBe(15);
  });

  test("the file already at the front changes nothing, so a reload does not re-render the sidebar", () => {
    const list = pushRecent([], entry(1));
    expect(pushRecent(list, entry(1))).toBe(list);
  });

  test("a file whose display path changed (the projects folder moved) is shown under its new one", () => {
    const list = pushRecent(pushRecent([], entry(1)), { path: "/p/file-1.md", displayPath: "~/p/file-1.md", kind: "file" });
    expect(list).toEqual([{ path: "/p/file-1.md", displayPath: "~/p/file-1.md", kind: "file" }]);
  });

  test("a folder is listed like a file: once, by its path, and counted in the 15", () => {
    let list: readonly RecentEntry[] = [];
    for (let n = 1; n <= 14; n++) list = pushRecent(list, entry(n));
    list = pushRecent(list, recentFolder("/p/docs"));
    list = pushRecent(list, entry(15));
    list = pushRecent(list, recentFolder("/p/docs"));
    expect(list).toHaveLength(15);
    expect(list[0]).toEqual({ path: "/p/docs", displayPath: "/p/docs", kind: "dir" });
    expect(list.filter((e) => e.kind === "dir")).toHaveLength(1);
    // Sixteen things were opened: the folder took a place, so the oldest file is the one that went.
    expect(list.at(-1)?.displayPath).toBe("file-2.md");
    expect(pushRecent(list, recentFolder("/p/docs"))).toBe(list);
  });

  test("a path that was a file and is now a folder is listed as what it is now", () => {
    const list = pushRecent(pushRecent([], { path: "/p/x", displayPath: "/p/x", kind: "file" }), recentFolder("/p/x"));
    expect(list).toEqual([{ path: "/p/x", displayPath: "/p/x", kind: "dir" }]);
  });
});

// The reader reports in steps; these are the sequences Reader.tsx actually produces (its reporting effect is keyed on
// the open file and the open folder, and `openFolder` sets the folder before it awaits the README).
describe("Recent, fed by what the reader reports", () => {
  const doc = (n: number) => ({ path: `/p/file-${n}.md`, displayPath: `file-${n}.md` });
  const names = (list: readonly RecentEntry[]) => list.map((e) => (e.kind === "dir" ? `${e.path}/` : e.displayPath));

  /** Feeds the reports through in order, as App.tsx does. */
  function feed(reports: NavReport[], start: readonly RecentEntry[] = [], from: NavSeen = NAV_NOTHING) {
    let list = start;
    let seen = from;
    for (const next of reports) {
      list = recentAfterNav(list, seen, next);
      seen = navSeenOf(next);
    }
    return { list, seen };
  }

  test("a folder with a README: the folder, then its README above it, and the file open before stays below both", () => {
    const { list } = feed([
      { doc: doc(1), folder: null },
      // `kinas open docs`: first the folder, with the previous file still reported as open…
      { doc: doc(1), folder: "/p/docs" },
      // …then the README it opened.
      { doc: { path: "/p/docs/README.md", displayPath: "docs/README.md" }, folder: "/p/docs" },
    ]);
    expect(names(list)).toEqual(["docs/README.md", "/p/docs/", "file-1.md"]);
  });

  test("a folder with no README is listed on its own", () => {
    const { list } = feed([{ doc: doc(1), folder: null }, { doc: null, folder: "/p/empty" }]);
    expect(names(list)).toEqual(["/p/empty/", "file-1.md"]);
  });

  test("reading files inside one folder does not keep dragging the folder back to the front", () => {
    const { list } = feed([
      { doc: null, folder: "/p/docs" },
      { doc: doc(1), folder: "/p/docs" },
      { doc: doc(2), folder: "/p/docs" },
      { doc: doc(3), folder: "/p/docs" },
    ]);
    expect(names(list)).toEqual(["file-3.md", "file-2.md", "file-1.md", "/p/docs/"]);
  });

  test("a file opened on its own closes the folder, so opening that folder again brings it back to the front", () => {
    const { list } = feed([
      { doc: null, folder: "/p/docs" },
      { doc: doc(1), folder: "/p/docs" },
      // `kinas open file-2.md`: the folder goes first, with file 1 still reported, then file 2 arrives.
      { doc: doc(1), folder: null },
      { doc: doc(2), folder: null },
      { doc: doc(2), folder: "/p/docs" },
    ]);
    expect(names(list)).toEqual(["/p/docs/", "file-2.md", "file-1.md"]);
  });

  test("a report that repeats the last one changes nothing, and gives back the same list", () => {
    const first = feed([{ doc: doc(1), folder: "/p/docs" }]);
    expect(recentAfterNav(first.list, first.seen, { doc: doc(1), folder: "/p/docs" })).toBe(first.list);
  });

  test("closing the reader reports nothing open, which adds nothing and forgets nothing", () => {
    const open = feed([{ doc: doc(1), folder: "/p/docs" }]);
    const closed = feed([{ doc: null, folder: null }], open.list, open.seen);
    expect(closed.list).toBe(open.list);
    // The same file opened again after the close is a change, though the list already has it in front.
    expect(names(feed([{ doc: doc(1), folder: null }], closed.list, closed.seen).list)).toEqual(["file-1.md", "/p/docs/"]);
  });

  test("switching from one folder to another lists both, the new one first", () => {
    const { list } = feed([{ doc: null, folder: "/p/one" }, { doc: null, folder: "/p/two" }]);
    expect(names(list)).toEqual(["/p/two/", "/p/one/"]);
  });
});
