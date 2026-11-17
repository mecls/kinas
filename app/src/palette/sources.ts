import { commandsFor, type Command } from "@kinas/commands";
import type { CrewDecision, CrewTask, FileSearch, HerdrWorkspace, RecentItem } from "../api.ts";
import { BADGE_OF, largestUnit } from "../crew/board.ts";
import { ageText, titleOf } from "../crew/inbox.ts";
import { sectionOf, SETTINGS, settingMatches } from "../settings/index.ts";
import { chordLabel, SHORTCUT_ACTIONS, type AppAction, type Shortcuts } from "../settings/shortcuts.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import type { Category, DotKind } from "../ui/Dot.tsx";
import { BADGE } from "../ui/StatusBadge.tsx";
import { ranked, score } from "./match.ts";

// What the palette searches, as groups of rows (tasks/interface-polish, PRD rules 13–17; build-spec §11.2). Each
// source is a pure function of what the window already holds, so it answers as the query changes; the Files group
// and Workspaces wait on Rust (`search.rs`, Herdr's live view). Slice 2: Commands and Files. Slice 3: Open, Client
// folders, Tasks, Inbox and Settings, each searched only once something is typed (rule 14). Slice 4: Workspaces, and
// Recent, the empty box's first group.

export type PaletteKind = "command" | "open" | "file" | "folder" | "task" | "inbox" | "workspace" | "setting";

/** One row. `key` is unique across the palette; `detail` is one line, in mono when `mono`. */
export interface PaletteItem {
  kind: PaletteKind;
  key: string;
  title: string;
  detail?: string;
  mono?: boolean;
  dot?: { color: string; kind: DotKind };
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

/** The empty box's Recent shows the last eight (rule 14). */
export const RECENT_SHOWN = 8;

/** The groups' one lines (rule 18): a source still being read, or one that failed. */
export const NOTE = {
  indexing: "Indexing files…",
  readingHerdr: "Reading Herdr…",
  noHerdr: "Herdr is not running, so no workspace can be searched.",
  capped: "Only the first 200,000 files and folders are searched.",
  filesFailed: (reason: string) => `Files could not be searched: ${reason}`,
} as const;

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

/** The last part of a path: what a tab or a folder is called. */
const baseName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/** The reader's tabs this session, by name, then by where they lie (rule 13, Open). */
export function openItems(q: string, tabs: readonly { path: string; displayPath: string }[], folders: readonly SeatedFolder[], open: (p: string) => void): PaletteItem[] {
  return ranked(tabs, (t) => score(q, baseName(t.path), t.displayPath)).map((t) => {
    const f = folderOf(t.path, folders);
    return {
      kind: "open",
      key: `open:${t.path}`,
      title: baseName(t.path),
      detail: t.displayPath,
      mono: true,
      folder: f ? { name: f.name, cat: f.cat } : undefined,
      act: () => open(t.path),
    };
  });
}

/** The client folders the sidebar lists, hidden ones included and marked so; removed ones are out of Kinas. */
export function folderItems(q: string, folders: readonly SeatedFolder[], open: (p: string) => void): PaletteItem[] {
  return ranked(
    folders.filter((f) => !f.removed),
    (f) => score(q, f.name, f.display),
  ).map((f) => ({
    kind: "folder",
    key: `folder:${f.path}`,
    title: f.name,
    detail: f.hidden ? "Hidden from the sidebar" : f.display,
    mono: !f.hidden,
    folder: { name: f.name, cat: f.cat },
    act: () => open(f.path),
  }));
}

/** The client folder whose repository is the task's or the decision's, matched by repository as the board does. */
const folderOfRepo = (repo: string | null, folders: readonly SeatedFolder[]) => (repo ? folders.find((f) => !f.removed && f.repo === repo) : undefined);

/**
 * The crew's tasks the board shows now: every task but a finished one the board has already shown (done work
 * clears) — by title, then id and project. Each with its word and that word's dot.
 */
export function taskItems(q: string, tasks: readonly CrewTask[], folders: readonly SeatedFolder[], openTask: (id: string) => void): PaletteItem[] {
  const shown = tasks.filter((t) => !(t.finished && t.board_seen_at !== null));
  return ranked(shown, (t) => score(q, t.title ?? t.id, `${t.id} ${t.project_name ?? ""} ${t.repo ?? ""}`)).map((t) => {
    const badge = BADGE[BADGE_OF[t.word]];
    const f = folderOfRepo(t.repo, folders);
    return {
      kind: "task",
      key: `task:${t.id}`,
      title: t.title ?? t.id,
      detail: badge.word,
      dot: { color: badge.color, kind: badge.kind },
      folder: f ? { name: f.name, cat: f.cat } : undefined,
      act: () => openTask(t.id),
    };
  });
}

/** Opens the Inbox with an item selected (rule 16). */
export type OpenItem = (task: string, key: string) => void;

/** The decisions waiting on the captain, held ones included, by what they ask and the task they belong to. */
export function inboxItems(q: string, decisions: readonly CrewDecision[], folders: readonly SeatedFolder[], now: number, openItem: OpenItem): PaletteItem[] {
  return ranked(decisions, (d) => score(q, d.summary || titleOf(d), `${titleOf(d)} ${d.key}`)).map((d) => {
    const f = folderOfRepo(d.repo, folders);
    return {
      kind: "inbox",
      key: `inbox:${d.task_id}:${d.key}`,
      title: d.summary || titleOf(d),
      detail: `${d.verb === "captain-hold" ? "Held for you" : "Decision"} · ${titleOf(d)}`,
      folder: f ? { name: f.name, cat: f.cat } : undefined,
      age: ageText(d.opened_at, now),
      act: () => openItem(d.task_id, d.key),
    };
  });
}

/** Every Settings row whose label or description matches (rules 13, 34), with its section beside it. */
export function settingItems(q: string, openSetting: (id: string) => void): PaletteItem[] {
  return settingMatches(q).map((s) => ({
    kind: "setting",
    key: `setting:${s.id}`,
    title: s.label,
    detail: sectionOf(s).title,
    act: () => openSetting(s.id),
  }));
}

/** Herdr's workspaces by label and folder, in Herdr's order; the focused one says so. */
export function workspaceItems(q: string, ws: readonly HerdrWorkspace[], folders: readonly SeatedFolder[], focus: (w: HerdrWorkspace) => void): PaletteItem[] {
  return ranked(ws, (w) => score(q, w.label, w.cwd ?? undefined)).map((w) => {
    const f = w.cwd ? folderOf(w.cwd, folders) : null;
    return {
      kind: "workspace",
      key: `workspace:${w.id}`,
      title: w.label,
      detail: w.focused ? "Herdr workspace · focused" : "Herdr workspace",
      folder: f ? { name: f.name, cat: f.cat } : undefined,
      act: () => focus(w),
    };
  });
}

/** What Recent's rows open: each kind's own door. */
export interface RecentDoors {
  open: (path: string) => void;
  task: (id: string) => void;
  workspace: (label: string) => void;
  setting: (id: string) => void;
}

/** A path as Recent shows it: under the client folder that holds it, by that folder's name; else whole. */
function shownPath(path: string, folders: readonly SeatedFolder[]): string {
  const f = folderOf(path, folders);
  if (!f) return path;
  const rest = path.slice(f.path.length).replace(/^\/+/, "");
  return rest === "" ? f.name : `${f.name}/${rest}`;
}

/** The last eight things opened, newest first, each saying what it is and how long ago (rule 14). */
export function recentItems(list: readonly RecentItem[], now: number, folders: readonly SeatedFolder[], tasks: readonly CrewTask[], doors: RecentDoors): PaletteItem[] {
  return list.slice(0, RECENT_SHOWN).map((r) => {
    const base = { key: `recent:${r.kind}:${r.key}`, title: r.label, age: largestUnit(now - r.at) };
    if (r.kind === "file" || r.kind === "folder") {
      const f = folderOf(r.key, folders);
      const client = r.kind === "folder" && f?.path === r.key;
      return {
        ...base,
        kind: r.kind === "file" ? "file" : "folder",
        dir: r.kind === "folder",
        detail: client ? "Client folder" : (r.display ?? shownPath(r.key, folders)),
        mono: !client,
        folder: f ? { name: f.name, cat: f.cat } : undefined,
        act: () => doors.open(r.key),
      };
    }
    if (r.kind === "task") {
      const t = tasks.find((x) => x.id === r.key);
      const badge = t ? BADGE[BADGE_OF[t.word]] : null;
      return {
        ...base,
        kind: "task",
        detail: badge ? badge.word : "Task",
        dot: badge ? { color: badge.color, kind: badge.kind } : undefined,
        act: () => doors.task(r.key),
      };
    }
    if (r.kind === "workspace") return { ...base, kind: "workspace", detail: "Herdr workspace", act: () => doors.workspace(r.key) };
    const setting = SETTINGS.find((x) => x.id === r.key);
    return { ...base, kind: "setting", detail: setting ? `Settings · ${sectionOf(setting).title}` : "Settings", act: () => doors.setting(r.key) };
  });
}

/** A group from its rows: the first `GROUP_SHOWN`, or all when opened; `beyond` counts matches never sent (Files). */
export function toGroup(id: PaletteGroup["id"], items: readonly PaletteItem[], opened: boolean, beyond = 0): PaletteGroup {
  const shown = opened ? items.slice() : items.slice(0, GROUP_SHOWN);
  const more = items.length - shown.length + (opened ? 0 : beyond);
  const note = opened && beyond > 0 ? `${beyond} more not shown. Type more of the name.` : undefined;
  return { id, label: GROUP_LABEL[id], items: shown, more, state: "ready", note };
}
