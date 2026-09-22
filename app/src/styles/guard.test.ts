import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { RATCHET, violations } from "./guard.ts";

// DESIGN.md §9: a test greps app/src for raw colours, raw sizes and raw spacing outside tokens.css and fails on any.
// Until the last old sheet is rewritten (the design-system build, 2026-09-22) the rule is a ratchet: every file's
// count of raw values is written in RATCHET and may only fall; a file not listed there may have none. The stories
// are the catalogue's scaffolding and are held to the colour rule only.

const src = join(import.meta.dir, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(css|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const files = walk(src).map((p) => relative(src, p)).sort();
const EXEMPT = new Set(["styles/tokens.css", "styles/print.css"]);

describe("no colour, size or spacing lives outside tokens.css (DESIGN.md §9)", () => {
  test("the checker sees a planted raw value and names it", () => {
    const hits = violations("ui/Planted.css", ".ui-planted { color: #5b6170; padding: 6px; font-size: 13px; border-radius: 3px; }");
    expect(hits.map((h) => h.message)).toEqual([
      "raw colour #5b6170 — use a token from tokens.css",
      "raw spacing 6px — use --space-*",
      "raw font-size 13px — use --fs-*",
      "raw border-radius 3px — use --radius-*",
    ]);
    expect(hits[0]!.line).toBe(1);
    expect(violations("ui/Fine.css", ".ui-fine { color: var(--ink); padding: var(--space-2); border: 1px solid var(--line); width: 22px; }")).toEqual([]);
    expect(violations("ui/Hover.css", ".ui-x { transition: background-color var(--dur-fast); }").map((h) => h.message)).toEqual(["a background transition freezes across the theme change in WKWebView — transition transform, opacity or width"]);
    // Geometry is the component's own; a page sheet may not size things in px.
    expect(violations("styles/page.css", ".page { width: 22px; }").map((h) => h.message)).toEqual(["raw size 22px outside app/src/ui/ — a layout token, or a component"]);
    expect(violations("ui/Any.tsx", 'const x = <i style={{ color: "#fff" }} />;').map((h) => h.message)).toEqual(["raw colour #fff — use a token from tokens.css"]);
  });

  for (const file of files) {
    if (EXEMPT.has(file)) continue;
    test(`${file}`, () => {
      const hits = violations(file, readFileSync(join(src, file), "utf8"));
      const allowed = RATCHET[file] ?? 0;
      const lines = hits.map((h) => `${file}:${h.line}: ${h.message}`);
      expect(lines.length, `${lines.length} raw values, ${allowed} allowed:\n${lines.slice(0, 12).join("\n")}`).toBeLessThanOrEqual(allowed);
      if (allowed > 0 && lines.length < allowed) {
        // The ratchet only turns one way: when a sheet loses raw values, its allowance in RATCHET comes down with it.
        expect(`${file}: ${lines.length} raw values, RATCHET says ${allowed} — lower it`).toBe(`${file}: ${lines.length} raw values, RATCHET says ${lines.length} — lower it`);
      }
    });
  }

  test("every file in RATCHET still exists — a deleted sheet leaves the list", () => {
    for (const file of Object.keys(RATCHET)) expect(files, file).toContain(file);
  });
});
