// Syntax highlighting for the reader (reader PRD R10, R11). Shaped after `mermaid.ts`: the library is imported only
// when a page has code, so Vite keeps it out of the main bundle, and each block is highlighted once per source for
// the session.
//
// highlight.js was chosen over Shiki because it has zero transitive dependencies against Shiki's eight, and every
// pinned version is a thing to maintain (R22). Its emitter escapes text before wrapping it in spans -- verified in
// lib/core.js, where `this.buffer += escapeHTML(text)` precedes any span -- which is what makes it safe to point at
// a file an agent wrote. No CSS theme ships with it: `.hljs-*` is mapped onto the ANSI tokens the terminal already
// uses, so code in the reader matches code in the pane beside it.

import type { HLJSApi, LanguageFn } from "highlight.js";
import { hashText } from "./render.ts";

const CACHE_LIMIT = 200;
/** Above this, a file renders as plain monospace: a minified bundle is not worth highlighting. */
export const MAX_HIGHLIGHT_BYTES = 512 * 1024;
/** A minified bundle is one enormous line; highlighting it is slow and pointless. */
export const MAX_HIGHLIGHT_LINE = 5000;

const cache = new Map<string, string>();
let core: Promise<HLJSApi> | null = null;
const registered = new Map<string, Promise<void>>();

/**
 * One grammar per entry, each a literal `import()`.
 *
 * Never build the path from a language id: for a markdown fence the id comes out of the file, which is untrusted
 * content. A fixed record means Vite emits one chunk per grammar and an unknown fence is simply not a key here.
 *
 * Every id `language.ts` can return must appear below — a mapping whose loader is missing would ask for a chunk
 * that does not exist and render nothing. `language.test.ts` pins that list.
 */
const LOADERS: Record<string, () => Promise<{ default: LanguageFn }>> = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  diff: () => import("highlight.js/lib/languages/diff"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  go: () => import("highlight.js/lib/languages/go"),
  graphql: () => import("highlight.js/lib/languages/graphql"),
  ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  less: () => import("highlight.js/lib/languages/less"),
  lua: () => import("highlight.js/lib/languages/lua"),
  makefile: () => import("highlight.js/lib/languages/makefile"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  php: () => import("highlight.js/lib/languages/php"),
  python: () => import("highlight.js/lib/languages/python"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  rust: () => import("highlight.js/lib/languages/rust"),
  scss: () => import("highlight.js/lib/languages/scss"),
  sql: () => import("highlight.js/lib/languages/sql"),
  swift: () => import("highlight.js/lib/languages/swift"),
  toml: () => import("highlight.js/lib/languages/ini"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};

/** Whether a block is worth highlighting at all (R10). Plain monospace is the honest rendering of the rest. */
export function shouldHighlight(text: string): boolean {
  if (text.length > MAX_HIGHLIGHT_BYTES) return false;
  for (const line of text.split("\n")) {
    if (line.length > MAX_HIGHLIGHT_LINE) return false;
  }
  return true;
}

function load(): Promise<HLJSApi> {
  core ??= import("highlight.js/lib/core").then((m) => m.default as HLJSApi);
  return core;
}

function register(hljs: HLJSApi, id: string): Promise<void> {
  const already = registered.get(id);
  if (already) return already;
  const loader = LOADERS[id];
  if (!loader) return Promise.reject(new Error(`no grammar for ${id}`));
  const pending = loader().then(({ default: grammar }) => {
    hljs.registerLanguage(id, grammar);
  });
  registered.set(id, pending);
  return pending;
}

/**
 * The highlighted HTML for one block, or null to leave it as plain text.
 *
 * `ignoreIllegals` is on so a file caught mid-save by the watcher never throws: half-written code is the normal
 * state of a file being edited in the pane beside the reader.
 */
export async function highlightCode(code: string, id: string): Promise<string | null> {
  const key = `${hashText(code)}:${id}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    // A hit counts as recent use.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  if (!LOADERS[id]) return null;
  try {
    const hljs = await load();
    await register(hljs, id);
    const { value } = hljs.highlight(code, { language: id, ignoreIllegals: true });
    cache.set(key, value);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    return value;
  } catch {
    // A grammar that will not load leaves the file readable as monospace: a degraded render, never an error page.
    return null;
  }
}
