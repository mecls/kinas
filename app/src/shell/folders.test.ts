import { describe, expect, test } from "bun:test";
import type { ProjectRow } from "../api.ts";
import { addedLine, folderMenu, hiddenFolders, listedFolders, menuAt, removedFolders, seatFolders, shownFolders } from "./folders.ts";

const row = (name: string, extra: Partial<ProjectRow> = {}): ProjectRow => ({ name, path: `/root/${name}`, display: `~/root/${name}`, category: null, internal: false, hidden: false, removed: false, repo: null, ...extra });

describe("seatFolders", () => {
  test("internal folders last, each in its chosen category or the next free one its name gives", () => {
    const seated = seatFolders([row("kinas", { internal: true }), row("acme"), row("globex", { category: 3 })]);
    expect(seated.map((f) => [f.name, f.internal])).toEqual([
      ["acme", false],
      ["globex", false],
      ["kinas", true],
    ]);
    expect(seated.find((f) => f.name === "globex")!.cat).toBe(3);
    // Six colours for six folders: no two of the three share one.
    expect(new Set(seated.map((f) => f.cat)).size).toBe(3);
  });

  test("the same folders seat the same way every time, whatever order they arrive in", () => {
    const a = seatFolders([row("acme"), row("globex"), row("initech")]);
    const b = seatFolders([row("initech"), row("acme"), row("globex")]);
    const cats = (seated: typeof a) => Object.fromEntries(seated.map((f) => [f.name, f.cat]));
    expect(cats(b)).toEqual(cats(a));
  });
});

// The fixture's six (fixtures/projects-discovery.json), as the folder-views e2e plants them.
const SIX = ["acme", "app", "hub", "one/site", "two/site", "worktree"];
const cats = (seated: readonly { name: string; cat: number }[]) => Object.fromEntries(seated.map((f) => [f.name, f.cat]));

describe("folder views (tasks/folder-views/prd.md)", () => {
  test("hiding or removing one folder never repaints another: colours are seated before a surface filters", () => {
    const all = cats(seatFolders(SIX.map((n) => row(n))));
    const oneHidden = seatFolders(SIX.map((n) => row(n, { hidden: n === "acme" })));
    const shown = shownFolders(oneHidden);
    expect(shown.map((f) => f.name)).toEqual(SIX.filter((n) => n !== "acme"));
    expect(cats(shown)).toEqual(Object.fromEntries(Object.entries(all).filter(([n]) => n !== "acme")));
    const oneRemoved = seatFolders(SIX.map((n) => row(n, { removed: n === "hub" })));
    expect(cats(shownFolders(oneRemoved))).toEqual(Object.fromEntries(Object.entries(all).filter(([n]) => n !== "hub")));
  });

  test("each surface's list: shown on the sidebar and Home, not removed in Settings, removed under Removed", () => {
    const folders = [row("acme", { hidden: true }), row("hub", { hidden: true, removed: true }), row("app"), row("globex", { removed: true })];
    expect(shownFolders(folders).map((f) => f.name)).toEqual(["app"]);
    expect(listedFolders(folders).map((f) => f.name)).toEqual(["acme", "app"]);
    expect(removedFolders(folders).map((f) => f.name)).toEqual(["hub", "globex"]);
    // A folder in both lists is removed: the menu does not offer to show it.
    expect(hiddenFolders(folders).map((f) => f.name)).toEqual(["acme"]);
  });

  test("the right-click menu: Hide on a folder, Add always, then a divider and Show for each hidden folder by name", () => {
    const calls: string[] = [];
    const act = { hide: (f: ProjectRow) => calls.push(`hide ${f.name}`), add: () => calls.push("add"), show: (f: ProjectRow) => calls.push(`show ${f.name}`) };
    const labels = (entries: ReturnType<typeof folderMenu>) => entries.map((e) => ("divider" in e ? "—" : e.label));
    expect(labels(folderMenu(row("acme"), [], act))).toEqual(["Hide from sidebar", "Add a client folder…"]);
    const hidden = hiddenFolders([row("zeta", { hidden: true }), row("beta", { hidden: true })]);
    const onFolder = folderMenu(row("app"), hidden, act);
    expect(labels(onFolder)).toEqual(["Hide from sidebar", "Add a client folder…", "—", "Show beta", "Show zeta"]);
    // On the heading there is no folder to hide.
    expect(labels(folderMenu(null, hidden, act))).toEqual(["Add a client folder…", "—", "Show beta", "Show zeta"]);
    for (const e of onFolder) if (!("divider" in e)) e.onSelect();
    expect(calls).toEqual(["hide app", "add", "show beta", "show zeta"]);
  });

  test("a menu opened near an edge is moved back inside the window", () => {
    const size = { width: 180, height: 120 };
    const win = { width: 1280, height: 820 };
    expect(menuAt(40, 300, size, win, 8)).toEqual({ left: 40, top: 300 });
    expect(menuAt(40, 800, size, win, 8)).toEqual({ left: 40, top: 692 });
    expect(menuAt(1270, 300, size, win, 8)).toEqual({ left: 1092, top: 300 });
    expect(menuAt(-5, -5, size, win, 8)).toEqual({ left: 8, top: 8 });
  });

  test("what the shell says after Add a client folder…", () => {
    expect(addedLine({ outcome: "cancelled" })).toBeNull();
    expect(addedLine({ outcome: "added", name: "plain" })).toBe("Added plain");
    expect(addedLine({ outcome: "shown", name: "acme" })).toBe("acme is back in the sidebar");
    expect(addedLine({ outcome: "restored", name: "hub" })).toBe("Restored hub");
    expect(addedLine({ outcome: "already", name: "plain" })).toBe("plain is already in the sidebar");
  });
});
