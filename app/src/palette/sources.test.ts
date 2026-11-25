import { describe, expect, test } from "bun:test";
import type { CrewDecision, CrewTask, FileSearch, RecentItem } from "../api.ts";
import { DEFAULT_SHORTCUTS } from "../settings/shortcuts.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import { commandItems, fileItems, folderItems, folderOf, GROUP_SHOWN, inboxItems, openItems, recentItems, RECENT_SHOWN, settingItems, taskItems, toGroup, workspaceItems, type PaletteItem } from "./sources.ts";

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

const task = (id: string, over: Partial<CrewTask> = {}): CrewTask => ({
  id,
  title: null,
  repo: null,
  project_name: null,
  kind: "ship",
  word: "working",
  overnight_word: "working",
  harness: null,
  first_seen_at: 0,
  first_working_at: null,
  done_at: null,
  gone_at: null,
  last_event_at: null,
  last_event_text: null,
  pr: null,
  has_pane: false,
  finished: false,
  board_seen_at: null,
  overnight_seen_at: null,
  dispatched_at: null,
  merged_at: null,
  merged_via: null,
    review: null, worktree: null,
  ...over,
});

const decision = (task_id: string, key: string, over: Partial<CrewDecision> = {}): CrewDecision => ({
  task_id,
  key,
  verb: "decide",
  summary: "",
  task_title: null,
  repo: null,
  opened_at: 0,
  copied_at: null,
  ...over,
});

const titles = (items: PaletteItem[]) => items.map((i) => i.title);

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

describe("the in-window sources", () => {
  test("tasks are the board's", () => {
    const acme = { ...folder("acme", "/root/clients/acme"), repo: "o/acme" };
    const tasks = [
      task("inv-1", { title: "Inventory sync rewrite", repo: "o/acme", word: "needs decision" }),
      task("inv-2", { title: "Inventory export", word: "done", finished: true, board_seen_at: 5 }),
      task("inv-3", { title: "Inventory audit", word: "done", finished: true }),
      task("other", { title: "Webhook retries" }),
    ];
    const opened: string[] = [];
    const items = taskItems("inv", tasks, [acme], (id) => opened.push(id));
    expect(titles(items)).toEqual(["Inventory sync rewrite", "Inventory audit"]);
    expect(items[0]!.detail).toBe("needs decision");
    expect(items[0]!.dot).toEqual({ color: "--warn", kind: "ring" });
    expect(items[0]!.folder).toEqual({ name: "acme", cat: 2 });
    expect(items[1]!.folder).toBeUndefined();
    items[0]!.act();
    expect(opened).toEqual(["inv-1"]);
    expect(titles(taskItems("o/acme", tasks, [acme], () => {}))).toEqual(["Inventory sync rewrite"]);
  });

  test("inbox items carry what they ask, whose they are and their age", () => {
    const now = 3 * 3_600_000;
    const decisions = [
      decision("inv-1", "store-secret", { summary: "Store the webhook secret in env or the keychain?", task_title: "Inventory sync rewrite", opened_at: now - 12 * 60_000 }),
      decision("held-1", "held-1", { verb: "captain-hold", task_title: "Invoice template", opened_at: 0 }),
    ];
    const opened: string[] = [];
    const items = inboxItems("inv", decisions, [], now, (t, k) => opened.push(`${t}/${k}`));
    expect(items.map((i) => [i.title, i.detail, i.age])).toEqual([
      ["Invoice template", "Held for you · Invoice template", "3 h ago"],
      ["Store the webhook secret in env or the keychain?", "Decision · Inventory sync rewrite", "12 min ago"],
    ]);
    items[1]!.act();
    expect(opened).toEqual(["inv-1/store-secret"]);
  });

  test("settings are found by label and description, with their section", () => {
    const opened: string[] = [];
    const items = settingItems("ollama key", (id) => opened.push(id));
    expect(items.map((i) => [i.title, i.detail])).toEqual([["API key", "Ollama Cloud"]]);
    items[0]!.act();
    expect(opened).toEqual(["ollama.key"]);
  });

  test("open tabs by name, then folders hidden ones marked, removed ones left out", () => {
    const tabs = [
      { path: "/root/clients/acme/notes.md", displayPath: "clients/acme/notes.md" },
      { path: "/root/plan.md", displayPath: "plan.md" },
    ];
    expect(openItems("notes", tabs, FOLDERS, () => {}).map((i) => [i.title, i.detail, i.folder?.name])).toEqual([["notes.md", "clients/acme/notes.md", "acme"]]);
    const folders = [{ ...folder("acme", "/root/clients/acme"), hidden: true }, { ...folder("acme-old", "/root/old/acme"), removed: true }, folder("beta", "/root/beta")];
    expect(folderItems("acme", folders, () => {}).map((i) => [i.title, i.detail, i.mono])).toEqual([["acme", "Hidden from the sidebar", false]]);
    expect(folderItems("beta", folders, () => {}).map((i) => [i.title, i.detail, i.mono])).toEqual([["beta", "~/beta", true]]);
  });
});

describe("Workspaces and Recent", () => {
  test("workspaces by label and folder, the focused one saying so", () => {
    const ws = [
      { id: "w1", label: "firstmate", focused: false, cwd: "/h/firstmate" },
      { id: "w2", label: "acme", focused: true, cwd: "/root/clients/acme" },
      { id: "w3", label: "notes", focused: false, cwd: "/root/clients/acme/notes" },
    ];
    const focused: string[] = [];
    const items = workspaceItems("acme", ws, FOLDERS, (w) => focused.push(w.id));
    expect(items.map((i) => [i.title, i.detail, i.folder?.name])).toEqual([
      ["acme", "Herdr workspace · focused", "acme"],
      ["notes", "Herdr workspace", "acme"],
    ]);
    items[1]!.act();
    expect(focused).toEqual(["w3"]);
  });

  test("recent drops nothing it was given, shows eight, and opens each by its own door", () => {
    const now = 10 * 86_400_000;
    const list: RecentItem[] = [
      { kind: "file", key: "/root/clients/acme/docs/prd.md", label: "prd.md", at: now - 8 * 60_000, display: "clients/acme/docs/prd.md" },
      { kind: "task", key: "inv-1", label: "Inventory sync rewrite", at: now - 2 * 3_600_000 },
      { kind: "workspace", key: "clients/globex", label: "clients/globex", at: now - 86_400_000 },
      { kind: "setting", key: "ollama.key", label: "API key", at: now - 3 * 86_400_000 },
      { kind: "folder", key: "/root/clients/acme", label: "acme", at: now - 3 * 86_400_000 },
      ...Array.from({ length: 6 }, (_, n): RecentItem => ({ kind: "setting", key: `s${n}`, label: `s${n}`, at: now })),
    ];
    const tasks = [task("inv-1", { title: "Inventory sync rewrite", word: "needs decision" })];
    const opened: string[] = [];
    const items = recentItems(list, now, FOLDERS, tasks, {
      open: (p) => opened.push(`open ${p}`),
      task: (id) => opened.push(`task ${id}`),
      workspace: (label) => opened.push(`workspace ${label}`),
      setting: (id) => opened.push(`setting ${id}`),
    });
    expect(items).toHaveLength(RECENT_SHOWN);
    expect(items.slice(0, 5).map((i) => [i.kind, i.title, i.detail, i.age, i.folder?.name])).toEqual([
      ["file", "prd.md", "clients/acme/docs/prd.md", "8 min", "acme"],
      ["task", "Inventory sync rewrite", "needs decision", "2 h", undefined],
      ["workspace", "clients/globex", "Herdr workspace", "1 d", undefined],
      ["setting", "API key", "Settings · Ollama Cloud", "3 d", undefined],
      ["folder", "acme", "Client folder", "3 d", "acme"],
    ]);
    expect(items[0]!.mono).toBe(true);
    expect(items[1]!.dot).toEqual({ color: "--warn", kind: "ring" });
    expect(new Set(items.map((i) => i.key)).size).toBe(RECENT_SHOWN);
    for (const i of items.slice(0, 5)) i.act();
    expect(opened).toEqual(["open /root/clients/acme/docs/prd.md", "task inv-1", "workspace clients/globex", "setting ollama.key", "open /root/clients/acme"]);
  });
});
