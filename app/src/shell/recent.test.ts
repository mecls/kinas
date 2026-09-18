import { describe, expect, test } from "bun:test";
import { pushRecent, RECENT_CAP, type RecentEntry } from "./recent.ts";

const entry = (n: number): RecentEntry => ({ path: `/p/file-${n}.md`, displayPath: `file-${n}.md` });

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
    const list = pushRecent(pushRecent([], entry(1)), { path: "/p/file-1.md", displayPath: "~/p/file-1.md" });
    expect(list).toEqual([{ path: "/p/file-1.md", displayPath: "~/p/file-1.md" }]);
  });
});
