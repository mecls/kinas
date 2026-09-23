import type { ProjectRow } from "../api.ts";
import { categoriesFor } from "../ui/category.ts";
import type { Category } from "../ui/Dot.tsx";

// The client folders as every surface shows them (DESIGN.md §3.1): the sidebar, the Settings card and Home's Overnight.
// Colours are seated over the names in name order, so the three agree whatever order the listing arrives in and
// wherever a folder sits on screen; the internal ones are listed last, each group in the listing's order.

export interface SeatedFolder extends ProjectRow {
  cat: Category;
}

export function seatFolders(projects: readonly ProjectRow[]): SeatedFolder[] {
  const names = projects.map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const cats = categoriesFor(names, Object.fromEntries(projects.map((p) => [p.name, p.category])));
  const seated = projects.map((p) => ({ ...p, cat: cats[p.name]! }));
  return [...seated.filter((p) => !p.internal), ...seated.filter((p) => p.internal)];
}
