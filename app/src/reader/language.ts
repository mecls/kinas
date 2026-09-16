// An extension to a highlighter's language id (reader PRD R11). Pure, so bun tests cover it.
//
// Rust sends a neutral fact — the lowercased extension, or the file name when there is none — and the mapping to
// highlight.js's own vocabulary lives here, in the webview, because that vocabulary is the library's private
// business and changes when the library does. `typescript`, not `ts`.
//
// The fallback is null, meaning plain monospace, and never highlight.js's auto-detection: that is slow, pulls many
// grammars, and is confidently wrong often enough to be worse than no highlighting. An unfamiliar extension — a
// `.prisma`, a `.tf` — renders as clean unhighlighted source, which is what Cursor falls back to as well.

/**
 * Extension (or extensionless file name) to a highlight.js language id.
 *
 * Only ids whose grammar is registered in `highlight.ts` may appear here: a value with no loader is worse than no
 * value, because the code would ask for a chunk that does not exist and render nothing.
 */
const LANGUAGES: Record<string, string> = {
  // Aliases, where the extension and the library disagree.
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sh: "bash",
  zsh: "bash",
  bash: "bash",
  fish: "bash",
  yml: "yaml",
  rs: "rust",
  py: "python",
  rb: "ruby",
  kt: "kotlin",
  h: "cpp",
  hpp: "cpp",
  cc: "cpp",
  md: "markdown",
  mdx: "markdown",
  htm: "xml",
  html: "xml",
  svg: "xml",
  // Direct hits, where the extension is already the id.
  sql: "sql",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  xml: "xml",
  toml: "toml",
  ini: "ini",
  diff: "diff",
  patch: "diff",
  go: "go",
  java: "java",
  swift: "swift",
  php: "php",
  lua: "lua",
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  graphql: "graphql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  // Names with no extension at all, matched whole.
  gemfile: "ruby",
  rakefile: "ruby",
  procfile: "bash",
};

/** The highlight.js id for an extension, or null to render plain. */
export function languageFor(ext: string): string | null {
  return LANGUAGES[ext.toLowerCase()] ?? null;
}

/** The id for a markdown fence's info string (` ```ts `), which comes from untrusted file content. */
export function languageForFence(info: string): string | null {
  const first = info.trim().split(/\s+/)[0] ?? "";
  return first === "" ? null : languageFor(first);
}
