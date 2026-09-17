// Markdown to HTML for the reader (reader PRD R19, R23, R26, R27). Pure: no DOM and no Tauri, so bun tests cover it.
//
// Nothing in a file may run: markdown-it has `html: false`, so raw HTML (a `<script>` included) comes out as text, and
// its own validateLink leaves `javascript:`, `vbscript:`, `file:` and `data:` links without an href. The page runs in
// the webview that can type into the terminal, which is why these are rules and not preferences.

import MarkdownIt, { type Env, type Token } from "markdown-it";
import { type FrontmatterView, splitFrontmatter } from "./frontmatter.ts";
import { slugger } from "./slug.ts";

export interface Heading {
  level: 1 | 2 | 3;
  text: string;
  slug: string;
}

export interface Diagram {
  index: number;
  hash: string;
  source: string;
}

export interface Rendered {
  html: string;
  headings: Heading[];
  frontmatter: FrontmatterView | null;
  diagrams: Diagram[];
  /**
   * The document for an HTML preview's frame, already carrying its injected policy.
   *
   * Optional, so `renderMarkdown` and `renderSource` are untouched and every existing case still passes. It
   * travels beside `html` rather than inside it because `swapBody` puts `html` through `innerHTML`: that does not
   * run `<script>`, but it *does* fire inline handlers and *does* load remote resources, so a page's own bytes
   * there would breach the reader's guarantee while the current AC-6 assertion still passed (R13). `hydrate`
   * assigns this to `iframe.srcdoc` as a property instead.
   */
  preview?: string;
}

/** What one render collects; markdown-it hands it to every rule as `env`. */
interface RenderEnv extends Env {
  slug: (text: string) => string;
  headings: Heading[];
  diagrams: Diagram[];
}

/** FNV-1a (32-bit) over the UTF-16 code units, plus the length: the key a diagram's SVG is cached under (R27). */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length.toString(16)}`;
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
/**
 * markdown-it's own HTML escaper, exported so `source.ts` uses this one rather than a second implementation.
 *
 * A source view is nothing but escaping: the file's bytes go into a `<pre>` and must come out as text, including
 * `<script>` and `onerror=`. One escaper, used everywhere, is the only version of that worth having.
 */
export const escape = md.utils.escapeHtml;

const inlineText = (token: Token | undefined) =>
  (token?.children ?? [])
    .filter((t) => t.type === "text" || t.type === "code_inline")
    .map((t) => t.content)
    .join("");

md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const collected = env as RenderEnv;
  const token = tokens[idx]!;
  const text = inlineText(tokens[idx + 1]);
  const slug = collected.slug(text);
  token.attrSet("id", slug);
  const level = Number(token.tag.slice(1));
  if (level <= 3) collected.headings.push({ level: level as 1 | 2 | 3, text, slug });
  return self.renderToken(tokens, idx, options);
};

const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  if (token.info.trim().split(/\s+/)[0] !== "mermaid") return defaultFence(tokens, idx, options, env, self);
  const { diagrams } = env as RenderEnv;
  const index = diagrams.length;
  const hash = hashText(token.content);
  diagrams.push({ index, hash, source: token.content });
  return `<div class="mermaid-block" data-index="${index}" data-hash="${hash}"></div>\n`;
};

// Images keep their source as data-src and get no src, so nothing loads until the reader resolves it: a local file
// through Rust, a remote one never (R20).
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const src = String(token.attrGet("src") ?? "");
  const title = token.attrGet("title");
  const alt = self.renderInlineAsText(token.children ?? [], options, env ?? {});
  return `<img data-src="${escape(src)}" alt="${escape(alt)}"${title !== null && title !== "" ? ` title="${escape(String(title))}"` : ""}>`;
};

// `- [ ] ` and `- [x] ` at the start of a list item become disabled checkboxes: never clickable, the reader never
// edits (R26).
md.core.ruler.after("inline", "task-list", (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]!;
    if (inline.type !== "inline" || tokens[i - 1]!.type !== "paragraph_open" || tokens[i - 2]!.type !== "list_item_open") continue;
    const first = inline.children?.[0];
    const match = first?.type === "text" ? /^\[([ xX])\](?: |$)/.exec(first.content) : null;
    if (!first || !match) continue;
    first.content = first.content.slice(match[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input type="checkbox" disabled${match[1] === " " ? "" : " checked"}> `;
    inline.children!.unshift(box);
    tokens[i - 2]!.attrJoin("class", "task-list-item");
  }
});

export function renderMarkdown(text: string): Rendered {
  const { frontmatter, body } = splitFrontmatter(text);
  const env: RenderEnv = { slug: slugger(), headings: [], diagrams: [] };
  const html = md.render(body, env);
  return { html, headings: env.headings, frontmatter, diagrams: env.diagrams };
}
