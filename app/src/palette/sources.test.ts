import { describe, expect, test } from "bun:test";
import type { FileSearch } from "../api.ts";
import { DEFAULT_SHORTCUTS } from "../settings/shortcuts.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import { commandItems, fileItems, folderOf, GROUP_SHOWN, toGroup, type PaletteItem } from "./sources.ts";

const folder = (name: string, path: string): SeatedFolder => ({
  name,
  path,
  display: `~/${name}`,
  category: null,
  internal: false,
  hidden: false,
  removed: false,
  repo: null,
  cat: 2,
});

const FOLDERS = [folder("acme", "/root/clients/acme"), folder("acme-web", "/root/clients/acme-web"), folder("clients", "/root/clients")];

describe("commandItems", () => {
  test("commands carry the bound chord", () => {
    const rebound = { ...DEFAULT_SHORTCUTS, "go.home": "Cmd+Shift+H" };
    const chordOf = (shortcuts: typeof DEFAULT_SHORTCUTS, id: string) => commandItems("", shortcuts, () => {}).find((i) => i.key === `command:${id}`)?.chord;
    expect(chordOf(DEFAULT_SHORTCUTS, "go.home")).toBe("⌘1");
    expect(chordOf(rebound, "go.home")).toBe("⌘⇧H");
    expect(chordOf(DEFAULT_SHORTCUTS, "settings")).toBe("⌘,");
    expect(chordOf(DEFAULT_SHORTCUTS, "sidebar")).toBe("⌘S");
    expect(chordOf(DEFAULT_SHORTCUTS, "status")).toBeUndefined();
  });

  test("nothing typed lists every palette command in the registry's order; typing ranks and drops", () => {
    const keys = (q: string) => commandItems(q, DEFAULT_SHORTCUTS, () => {}).map((i) => i.key.replace("command:", ""));
    expect(keys("")).toEqual(["status", "refresh", "files.refresh", "go.home", "go.usage", "go.work", "go.crew", "go.inbox", "go.firstmate", "sidebar", "settings"]);
    expect(keys("go to")).toEqual(["go.home", "go.usage", "go.work", "go.crew", "go.inbox", "go.firstmate"]);
    expect(keys("usage")[0]).toBe("go.usage");
    expect(keys("readme")).toEqual([]);
  });

  test("a row runs its command", () => {
    const ran: string[] = [];
    commandItems("status", DEFAULT_SHORTCUTS, (c) => ran.push(c.id))[0]!.act();
    expect(ran).toEqual(["status"]);
  });
});

describe("files", () => {
  test("folderOf takes the longest folder a path lies in, never a name that only begins the same", () => {
    expect(folderOf("/root/clients/acme/src/a.ts", FOLDERS)?.name).toBe("acme");
    expect(folderOf("/root/clients/acme-web/a.ts", FOLDERS)?.name).toBe("acme-web");
    expect(folderOf("/root/clients/other/a.ts", FOLDERS)?.name).toBe("clients");
    expect(folderOf("/root/clients/acme", FOLDERS)?.name).toBe("acme");
    expect(folderOf("/elsewhere/a.ts", FOLDERS)).toBeNull();
  });

  test("fileItems keeps Rust's order, with the path in mono, the kind and the folder", () => {
    const found: FileSearch = {
      indexing: false,
      capped: false,
      more: 0,
      matches: [
        { path: "/root/clients/acme/src", display_path: "clients/acme/src", name: "src", kind: "dir" },
        { path: "/root/notes.md", display_path: "notes.md", name: "notes.md", kind: "file" },
      ],
    };
    const opened: string[] = [];
    const items = fileItems(found, FOLDERS, (p) => opened.push(p));
    expect(items.map((i) => [i.title, i.detail, i.mono, i.dir, i.folder?.name])).toEqual([
      ["src", "clients/acme/src", true, true, "acme"],
      ["notes.md", "notes.md", true, false, undefined],
    ]);
    items[1]!.act();
    expect(opened).toEqual(["/root/notes.md"]);
  });
});

describe("toGroup", () => {
  const rows = (n: number): PaletteItem[] => Array.from({ length: n }, (_, i) => ({ kind: "file", key: `file:${i}`, title: `f${i}`, act: () => {} }));

  test("five shown and the rest counted; opened shows them all", () => {
    const closed = toGroup("file", rows(8), false);
    expect(closed.items).toHaveLength(GROUP_SHOWN);
    expect(closed.more).toBe(3);
    expect(closed.label).toBe("Files");
    const opened = toGroup("file", rows(8), true);
    expect(opened.items).toHaveLength(8);
    expect(opened.more).toBe(0);
    expect(toGroup("command", rows(3), false).more).toBe(0);
  });

  test("matches Rust never sent count in the closed group's more and are named in the opened one's note", () => {
    expect(toGroup("file", rows(50), false, 12).more).toBe(57);
    const opened = toGroup("file", rows(50), true, 12);
    expect(opened.more).toBe(0);
    expect(opened.note).toBe("12 more not shown. Type more of the name.");
    expect(toGroup("file", rows(50), false, 12).note).toBeUndefined();
  });
});
