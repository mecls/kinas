// Frontmatter (reader PRD R25): a YAML block at the very top of the file, shown as a card and never passed to
// markdown. The first line (after a BOM) is exactly `---`, and a later line within the first 200 is exactly `---` or
// `...`. Without that closing line, the opening `---` is an ordinary horizontal rule.

import { parse } from "yaml";

export type FrontmatterView =
  | { ok: true; title: string | null; rows: { key: string; value: string }[] }
  | { ok: false; error: string; raw: string };

const MAX_LINES = 200;

const bare = (line: string) => line.replace(/\r$/, "");

export function splitFrontmatter(text: string): { frontmatter: FrontmatterView | null; body: string } {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const lines = source.split("\n");
  if (lines[0] === undefined || bare(lines[0]) !== "---") return { frontmatter: null, body: source };
  const end = lines.slice(1, MAX_LINES).findIndex((line) => bare(line) === "---" || bare(line) === "...");
  if (end < 0) return { frontmatter: null, body: source };
  const raw = lines.slice(1, end + 1).map(bare).join("\n");
  return { frontmatter: view(raw), body: lines.slice(end + 2).join("\n") };
}

function scalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function view(raw: string): FrontmatterView | null {
  let value: unknown;
  try {
    // No aliases at all: a crafted block cannot expand into something huge.
    value = parse(raw, { maxAliasCount: 0 });
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).split("\n")[0] ?? "invalid YAML", raw };
  }
  // An empty block (`---` then `---`) says nothing, so there is no card.
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "the block is not a set of keys and values", raw };
  }
  let title: string | null = null;
  const rows: { key: string; value: string }[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "title" && typeof v === "string") {
      title = v;
      continue;
    }
    const text = scalar(v) ? (v === null ? "" : String(v)) : Array.isArray(v) && v.every(scalar) ? v.map((x) => (x === null ? "" : String(x))).join(", ") : JSON.stringify(v);
    rows.push({ key, value: text });
  }
  return { ok: true, title, rows };
}
