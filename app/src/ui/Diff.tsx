import "./Diff.css";

// DESIGN.md §4 Diff (1.6): the reader's Changes view — a file against its text when its tree was first shown. Unified,
// one column: a summary line, then each line with its two numbers, its sign and its text, an added line on the --ok
// tint with +, a removed one on the --danger tint with −. A long unchanged run is one row that opens in place.
//
// `diffHtml` is the one implementation of the markup. The reader swaps its body in as HTML (Reader.tsx `swapBody`) and
// highlights each line's `pre > code` as it highlights source, so the markup is a string; the story mounts the same
// string. Every text in it is escaped: a line of the file is data, whatever it says.

export interface DiffLine {
  kind: "context" | "add" | "remove";
  old: number | null;
  new: number | null;
  text: string;
  fold: number | null;
}

/** What a diff needs of Rust's `DiffView` — the library imports nothing from `api.ts`. */
export interface DiffShape {
  mark: "A" | "M" | "D";
  added: number;
  removed: number;
  rows: DiffLine[];
  folds: { id: number; lines: number }[];
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** The sign says in a word what the tint says in colour (DESIGN.md §2.2): +, the minus sign, or nothing. */
const SIGN = { context: "", add: "+", remove: "−" } as const;

/**
 * The diff as markup. `language` is the highlighter's id for every line's `code` (null: plain monospace); `since` is
 * the baseline, "14:02". A fold's row comes before the lines it hides, which carry `hidden` until it is opened.
 */
export function diffHtml(view: DiffShape, language: string | null, since: string): string {
  const klass = language ? ` class="language-${esc(language)}"` : "";
  const folded = new Map(view.folds.map((f) => [f.id, f.lines]));
  const opened = new Set<number>();
  let rows = "";
  for (const row of view.rows) {
    if (row.fold !== null && !opened.has(row.fold)) {
      opened.add(row.fold);
      const n = folded.get(row.fold) ?? 0;
      rows += `<button type="button" class="ui-diff-fold" data-fold="${row.fold}">${n} unchanged ${n === 1 ? "line" : "lines"}</button>`;
    }
    const hidden = row.fold === null ? "" : ` data-fold="${row.fold}" hidden`;
    rows +=
      `<div class="ui-diff-row" data-kind="${row.kind}"${hidden}>` +
      `<span class="ui-diff-no">${row.old ?? ""}</span><span class="ui-diff-no">${row.new ?? ""}</span>` +
      `<span class="ui-diff-sign">${SIGN[row.kind]}</span><pre><code${klass}>${esc(row.text)}</code></pre></div>`;
  }
  const lead = view.mark === "D" ? `<p class="ui-diff-lead">Deleted since ${esc(since)} — what it said then</p>` : "";
  return (
    `<div class="ui-diff"><p class="ui-diff-summary"><span class="ui-diff-count">+${view.added} −${view.removed}</span> ` +
    `<span class="ui-diff-since">since ${esc(since)}</span></p>${lead}<div class="ui-diff-rows">${rows}</div></div>`
  );
}

/** One line in the diff's place when there is nothing to compare (rules 23, 25), in Rust's words. */
export function refusalHtml(text: string): string {
  return `<div class="ui-diff"><p class="ui-diff-refusal">${esc(text)}</p></div>`;
}

/**
 * Opens the fold a click landed on, inside `within`: its lines show, its row goes. True when the click was a fold's.
 * The reader's body and the story both call it.
 */
export function openFold(target: EventTarget | null, within: Element): boolean {
  const button = (target as Element | null)?.closest?.("button.ui-diff-fold");
  if (!button || !within.contains(button)) return false;
  const id = button.getAttribute("data-fold");
  for (const row of within.querySelectorAll<HTMLElement>(`.ui-diff-row[data-fold="${id}"]`)) row.hidden = false;
  button.remove();
  return true;
}

export function Diff({ view, language = null, since = "14:02" }: { view: DiffShape; language?: string | null; since?: string }) {
  return <div className="ui-diff-host" onClick={(e) => openFold(e.target, e.currentTarget)} dangerouslySetInnerHTML={{ __html: diffHtml(view, language, since) }} />;
}

export function DiffRefusal({ text }: { text: string }) {
  return <div className="ui-diff-host" dangerouslySetInnerHTML={{ __html: refusalHtml(text) }} />;
}
