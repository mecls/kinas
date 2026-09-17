// A file shown as source, and a file shown as an image (reader PRD R2, R9). Pure: no DOM and no Tauri, so bun
// tests cover it.
//
// Both return the same `Rendered` shape `renderMarkdown` does, which is the whole reason this is cheap: `swapBody`,
// `hydrate`, the pre-paint layout effect and the Contents gate in Reader.tsx all work untouched. Contents
// disappears by itself, because `headings` is empty.
//
// Source is nothing but escaping. The file's bytes go into a `<pre>` and must come out as text — `<script>`,
// `onerror=` and all — because the reader shares its webview with the code that can type into the terminal (R19).
// So this uses markdown-it's own escaper, exported from render.ts, rather than a second implementation.

import { escape, type Rendered } from "./render.ts";

/**
 * A file's text as a highlightable source block.
 *
 * The `language-*` class is what `hydrate` looks for when it highlights; an unknown language still renders, as
 * plain monospace. `splitFrontmatter` is deliberately not called: `renderMarkdown` calls it unconditionally, so a
 * `---`-leading `.yaml` or a Jekyll `.html` would silently lose its head if source reused that path.
 */
export function renderSource(text: string, language: string | null): Rendered {
  const klass = language === null ? "" : ` class="language-${escape(language)}"`;
  // A trailing newline would otherwise count as one more line than the file has.
  const lines = text.replace(/\n$/, "").split("\n").length;
  // The numbers sit in a sibling element rather than on each line: highlight.js returns one HTML string whose
  // spans can cross line boundaries, so per-line wrapping would produce unbalanced markup. Generated-looking
  // content in an unselectable gutter is also what keeps digits out of a copied selection (R20).
  const gutter = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  return {
    html: `<div class="reader-source-wrap"><pre class="reader-gutter" aria-hidden="true">${gutter}</pre><pre class="reader-source"><code${klass}>${escape(text)}</code></pre></div>`,
    headings: [],
    frontmatter: null,
    diagrams: [],
  };
}

/**
 * A file that is an image.
 *
 * `data-src` and no `src`, exactly as the markdown image rule emits, so `hydrate`'s existing `loadImage` does the
 * Blob work and nothing is ever fetched (R20). The alt text is the file's name: an image opened by name has no
 * caption to borrow.
 *
 * `data-src` is the **bare file name**, not the absolute path, because `classifyLink` reads a leading `/` as
 * "relative to the projects root" rather than as an absolute path — an absolute one would resolve to
 * `<root>/Users/…` and fall back to alt text. The document here *is* the image, so its own folder is the base and
 * the name alone resolves to itself.
 */
export function renderImage(path: string): Rendered {
  const name = path.slice(path.lastIndexOf("/") + 1) || path;
  return {
    html: `<div class="reader-image"><img data-src="${escape(name)}" alt="${escape(name)}"></div>`,
    headings: [],
    frontmatter: null,
    diagrams: [],
  };
}
