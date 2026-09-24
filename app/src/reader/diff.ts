import type { DiffView } from "../api.ts";
import { diffHtml, refusalHtml } from "../ui/index.ts";
import { sinceLabel } from "./changes.ts";
import { languageFor } from "./language.ts";
import type { Rendered } from "./render.ts";

// The Changes view as the reader renders any document (tree changes rules 21–25): the same `Rendered` shape as
// source.ts, so `swapBody`, `hydrate` — which highlights each line's `pre > code` as it highlights source — and the
// layout effect work untouched. Contents stays away by itself: a diff has no headings.

export function renderDiff(view: DiffView): Rendered {
  return { html: diffHtml(view, languageFor(view.ext), sinceLabel(view.since_ms)), headings: [], frontmatter: null, diagrams: [] };
}

/** One line in the diff's place — Rust's words for why there is nothing to compare, or too much. */
export function renderRefusal(text: string): Rendered {
  return { html: refusalHtml(text), headings: [], frontmatter: null, diagrams: [] };
}
