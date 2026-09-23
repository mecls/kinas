import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { braced, declarations, mediaBlock, ruleBlock, stripComments } from "./testing/palette.ts";

// design/preview.html is the mockup every screen was drawn from, and it keeps its own copy of the tokens so it opens
// on its own. DESIGN.md §9 ("Adding a surface", step 5): the preview and the app never drift. Every token the two
// both declare holds the same value, in the light theme and in each of the preview's two dark blocks (the system
// one and the forced one its theme switch uses).

const preview = stripComments(readFileSync(join(import.meta.dir, "../../../design/preview.html"), "utf8"));
const tokens = readFileSync(join(import.meta.dir, "tokens.css"), "utf8");
const light = declarations(ruleBlock(tokens, ":root"));
const dark = new Map([...light, ...declarations(ruleBlock(mediaBlock(tokens, "screen and (prefers-color-scheme: dark)"), ":root"))]);

/** The body of every rule in the preview whose selector is exactly `selector`, joined. */
function rules(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of preview.matchAll(new RegExp(`(^|[}\\s])${escaped}\\s*\\{`, "g"))) {
    for (const [name, value] of declarations(braced(preview, m.index!))) out.set(name, value);
  }
  return out;
}

const normal = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s(,/])\.(\d)/g, "$10.$2")
    .replace(/\s+/g, " ");

function agree(block: Map<string, string>, theme: Map<string, string>, floor: number) {
  const shared = [...block.keys()].filter((name) => theme.has(name));
  expect(shared.length).toBeGreaterThanOrEqual(floor);
  for (const name of shared) expect(`${name}: preview ${normal(block.get(name)!)}`).toBe(`${name}: preview ${normal(theme.get(name)!)}`);
}

describe("design/preview.html and tokens.css agree", () => {
  test("the light theme: the brand layer, colours, type, space, layout, geometry and motion", () => {
    agree(rules(":root"), light, 89);
  });

  test("the dark theme, as the system chooses it", () => {
    agree(rules(':root:not([data-theme="light"])'), dark, 25);
  });

  test("the dark theme, as the preview's switch forces it", () => {
    agree(rules(':root[data-theme="dark"]'), dark, 25);
  });

  test("tasks/_templates/mockup.html carries every token, as tokens.css declares it (scripts/mockup-template.ts)", () => {
    const template = stripComments(readFileSync(join(import.meta.dir, "../../../tasks/_templates/mockup.html"), "utf8"));
    const lightInTemplate = declarations(braced(template, template.indexOf(":root{")));
    expect([...lightInTemplate]).toEqual([...light]);
    const forced = template.indexOf(':root[data-theme="dark"]{');
    expect(new Map([...light, ...declarations(braced(template, forced))])).toEqual(dark);
    expect(mediaBlock(template, "(prefers-color-scheme: dark)")).toContain(':root:not([data-theme="light"])');
  });
});
