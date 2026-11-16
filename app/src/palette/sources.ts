import { commandsFor, type Command } from "@kinas/commands";
import type { FileSearch } from "../api.ts";
import { chordLabel, SHORTCUT_ACTIONS, type AppAction, type Shortcuts } from "../settings/shortcuts.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import type { Category } from "../ui/Dot.tsx";
import { ranked, score } from "./match.ts";

// What the palette searches, as groups of rows (tasks/interface-polish, PRD rules 13–17; build-spec §11.2). Each
// source is a pure function of what the window already holds, so it answers as the query changes; the Files group
// alone waits on Rust (`search.rs`). Slice 2: Commands and Files. Open, Client folders, Tasks, Inbox and Settings come
// in slice 3; Workspaces and Recent in slice 4.

export type PaletteKind = "command" | "open" | "file" | "folder" | "task" | "inbox" | "workspace" | "setting";

/** One row. `key` is unique across the palette; `detail` is one line, in mono when `mono`. */
export interface PaletteItem {
  kind: PaletteKind;
  key: string;
  title: string;
  detail?: string;
  mono?: boolean;
  /** A folder found by name in Files: drawn with the folder icon rather than the file one. */
  dir?: boolean;
  folder?: { name: string; cat: Category };
  chord?: string;
  age?: string;
  act: () => void;
}

export interface PaletteGroup {
  id: PaletteKind | "recent";
  label: string;
  items: PaletteItem[];
  /** How many more matched than are shown; "N more" opens them in place. */
  more: number;
  state: "ready" | "loading" | "failed";
  /** The one line a loading or failed group shows instead of rows, or under them. */
  note?: string;
}

/** Rule 13's order. Recent leads the empty box (rule 14). */
export const GROUP_ORDER: readonly PaletteKind[] = ["command", "open", "file", "folder", "task", "inbox", "workspace", "setting"];

export const GROUP_LABEL: Readonly<Record<PaletteGroup["id"], string>> = {
  recent: "Recent",
  command: "Commands",
  open: "Open",
  file: "Files",
  folder: "Client folders",
  task: "Tasks",
  inbox: "Inbox",
  workspace: "Workspaces",
  setting: "Settings",
};

/** Each group shows its five best, then "N more" (rule 15). */
export const GROUP_SHOWN = 5;

/** How many files the Files group asks Rust for: five shown, the rest behind "N more". */
export const FILES_ASKED = 50;

/** The action whose chord a palette command shows (rule 9). Commands without a chord show none. */
const COMMAND_ACTION: Readonly<Record<string, AppAction>> = Object.fromEntries(
  SHORTCUT_ACTIONS.filter((a) => a !== "palette").map((a) => [a, a]),
);

/** The palette's commands that match `q`, best first — all of them, in the registry's order, when nothing is typed —
 * each with the chord it is bound to now (a rebound chord shows as rebound). */
export function commandItems(q: string, shortcuts: Shortcuts, run: (c: Command) => void): PaletteItem[] {
  const all = commandsFor("palette");
  const matched = q.trim() === "" ? all : ranked(all, (c) => score(q, c.title));
  return matched.map((c) => {
    const action = COMMAND_ACTION[c.id];
    return { kind: "command", key: `command:${c.id}`, title: c.title, chord: action ? chordLabel(shortcuts[action]) : undefined, act: () => run(c) };
  });
}

/** The client folder a path lies in: the longest folder path it starts with. */
export function folderOf(path: string, folders: readonly SeatedFolder[]): SeatedFolder | null {
  let best: SeatedFolder | null = null;
  for (const f of folders) {
    const inside = path === f.path || path.startsWith(f.path.endsWith("/") ? f.path : `${f.path}/`);
    if (inside && (!best || f.path.length > best.path.length)) best = f;
  }
  return best;
}

/** Rust's answer as rows, in its order: the name, the path under the projects folder in mono, the folder's chip. */
export function fileItems(r: FileSearch, folders: readonly SeatedFolder[], open: (p: string) => void): PaletteItem[] {
  return r.matches.map((m) => {
    const f = folderOf(m.path, folders);
    return {
      kind: "file",
      key: `file:${m.path}`,
      title: m.name,
      detail: m.display_path,
      mono: true,
      dir: m.kind === "dir",
      folder: f ? { name: f.name, cat: f.cat } : undefined,
      act: () => open(m.path),
    };
  });
}

/** A group from its rows: the first `GROUP_SHOWN`, or all when opened; `beyond` counts matches never sent (Files). */
export function toGroup(id: PaletteGroup["id"], items: readonly PaletteItem[], opened: boolean, beyond = 0): PaletteGroup {
  const shown = opened ? items.slice() : items.slice(0, GROUP_SHOWN);
  const more = items.length - shown.length + (opened ? 0 : beyond);
  const note = opened && beyond > 0 ? `${beyond} more not shown. Type more of the name.` : undefined;
  return { id, label: GROUP_LABEL[id], items: shown, more, state: "ready", note };
}
