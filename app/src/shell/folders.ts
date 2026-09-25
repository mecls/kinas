import type { AddOutcome, ProjectRow } from "../api.ts";
import { categoriesFor } from "../ui/category.ts";
import type { Category } from "../ui/Dot.tsx";
import type { MenuEntry } from "../ui/Menu.tsx";

// The client folders as every surface shows them (DESIGN.md §3.1): the sidebar, the Settings card and Home's Overnight.
// Colours are seated over the names in name order, so the three agree whatever order the listing arrives in and
// wherever a folder sits on screen; the internal ones are listed last, each group in the listing's order.
//
// Folder views (2026-09-23): the listing holds hidden and removed folders too, and they are seated with the rest —
// a surface filters **after** seating, so hiding one folder never repaints another (tasks/folder-views/prd.md rule 8).

export interface SeatedFolder extends ProjectRow {
  cat: Category;
}

export function seatFolders(projects: readonly ProjectRow[]): SeatedFolder[] {
  const names = projects.map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const cats = categoriesFor(names, Object.fromEntries(projects.map((p) => [p.name, p.category])));
  const seated = projects.map((p) => ({ ...p, cat: cats[p.name]! }));
  return [...seated.filter((p) => !p.internal), ...seated.filter((p) => p.internal)];
}

/** On the sidebar and Home: neither hidden nor removed. */
export const shownFolders = <T extends ProjectRow>(folders: readonly T[]): T[] => folders.filter((f) => !f.hidden && !f.removed);

/** Settings' main list: every folder not removed, a hidden one with its In sidebar switch off. */
export const listedFolders = <T extends ProjectRow>(folders: readonly T[]): T[] => folders.filter((f) => !f.removed);

/** Settings' Removed list. */
export const removedFolders = <T extends ProjectRow>(folders: readonly T[]): T[] => folders.filter((f) => f.removed);

/** Hidden and not removed — what the right-click menu offers to show again — in name order. */
export const hiddenFolders = <T extends ProjectRow>(folders: readonly T[]): T[] =>
  folders.filter((f) => f.hidden && !f.removed).sort((a, b) => a.name.localeCompare(b.name));

/** What Add to crew needs to know about the crew: whether Firstmate is installed, and which repositories it has. */
export interface CrewForMenu {
  installed: boolean;
  repos: readonly string[];
}

/** Why Add to crew cannot be used on this folder, or null when it can (build spec §4 Sidebar). */
export function addToCrewReason(folder: ProjectRow, crew: CrewForMenu): string | null {
  if (!folder.repo) return "No GitHub remote";
  if (!crew.installed) return "Firstmate isn't installed";
  if (crew.repos.includes(folder.repo)) return "Already in the crew";
  return null;
}

/**
 * The client folders' right-click menu (DESIGN.md §3.1, 1.3): Hide from sidebar and Add to crew when a folder was
 * right-clicked (the heading has neither), a divider, Add a client folder…, then a divider and Show for each hidden
 * folder. Add to crew stays in place, disabled with its reason, when it cannot be used (the first mate, 2026-09-25).
 * Removal is not here: it lives in Settings, where the Removed list and Restore are in view.
 */
export function folderMenu(
  target: ProjectRow | null,
  hidden: readonly ProjectRow[],
  act: { hide: (f: ProjectRow) => void; add: () => void; show: (f: ProjectRow) => void; addToCrew?: (f: ProjectRow) => void },
  crew: CrewForMenu = { installed: false, repos: [] },
): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (target) {
    entries.push({ id: "hide", label: "Hide from sidebar", onSelect: () => act.hide(target) });
    entries.push({ id: "crew", label: "Add to crew", disabledReason: addToCrewReason(target, crew), onSelect: () => act.addToCrew?.(target) });
    entries.push({ id: "folder", divider: true });
  }
  entries.push({ id: "add", label: "Add a client folder…", onSelect: act.add });
  if (hidden.length > 0) {
    entries.push({ id: "hidden", divider: true });
    for (const f of hidden) entries.push({ id: `show:${f.path}`, label: `Show ${f.name}`, onSelect: () => act.show(f) });
  }
  return entries;
}

/**
 * Where a menu opened at the pointer sits: at the pointer, moved back inside the window by `margin` when its size
 * would run past the right or bottom edge, and never past the top-left corner.
 */
export function menuAt(x: number, y: number, size: { width: number; height: number }, window: { width: number; height: number }, margin: number): { left: number; top: number } {
  const left = Math.max(margin, Math.min(x, window.width - size.width - margin));
  const top = Math.max(margin, Math.min(y, window.height - size.height - margin));
  return { left, top };
}

/** What the shell says after Add a client folder…; nothing after Cancel. */
export function addedLine(result: AddOutcome): string | null {
  switch (result.outcome) {
    case "cancelled":
      return null;
    case "added":
      return `Added ${result.name}`;
    case "shown":
      return `${result.name} is back in the sidebar`;
    case "restored":
      return `Restored ${result.name}`;
    case "already":
      return `${result.name} is already in the sidebar`;
  }
}
