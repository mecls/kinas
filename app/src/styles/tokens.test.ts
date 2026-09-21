import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contrast, declarations, isHex, mediaBlock, ruleBlock, stripComments } from "./testing/palette.ts";

// Kinas has two grounds: the dark one, and warm white with the Quinas blue. Both live in tokens.css (and the Usage
// page's own block in usage.css) under one set of names, so every rule in the app is written once. That only works
// if the two sets stay the same set, and if the light one is readable — which is a number, not an opinion: every
// colour that draws text must reach WCAG's 4.5:1 on the ground AND on the raised panels.

const LIGHT = "screen and (prefers-color-scheme: light)";
const sheet = (name: string) => readFileSync(join(import.meta.dir, name), "utf8");
const tokens = sheet("tokens.css");
const usage = sheet("usage.css");

const isColour = (value: string) => /^(#|rgba?\(|var\(--)/.test(value);
const colours = (all: Map<string, string>) => new Map([...all].filter(([name, value]) => isColour(value) && name !== "--mono" && name !== "--sans"));

const dark = new Map([...colours(declarations(ruleBlock(tokens, ":root"))), ...colours(declarations(ruleBlock(usage, ".usage")))]);
const light = new Map([
  ...colours(declarations(ruleBlock(mediaBlock(tokens, LIGHT), ":root"))),
  ...colours(declarations(ruleBlock(mediaBlock(usage, LIGHT), ".usage"))),
]);

/** The same in both schemes, on purpose: the two brand colours read on either ground, --surface-1 follows --panel, and
 * the rest clear their floor on both (the series test below checks the four series). Anything else needs a light value. */
const SAME_IN_BOTH = ["--blue", "--crimson", "--surface-1", "--dot-fresh", "--series-3", "--series-4", "--series-5", "--series-6"];

/** A token's colour in a scheme, aliases followed; the light scheme falls back to dark for what it does not set. */
function resolve(name: string, scheme: "dark" | "light"): string {
  const value = (scheme === "light" ? light.get(name) : undefined) ?? dark.get(name) ?? "";
  const alias = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  return alias ? resolve(alias, scheme) : value;
}

const ok = (label: string, ratio: number, floor: number) => `${label} ${ratio.toFixed(2)} ${ratio >= floor ? "ok" : "TOO PALE"}`;

describe("the kit these tests stand on", () => {
  test("knows black on white is 21:1, and finds nothing where there is nothing", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(mediaBlock(tokens, "screen and (prefers-color-scheme: sepia)")).toBe("");
    expect(dark.get("--ground")).toBe("#0b0d10");
  });
});

describe("the light ground", () => {
  test("is on screen only, so a print from either scheme is what print.css says", () => {
    for (const css of [tokens, usage]) {
      expect(mediaBlock(css, LIGHT)).not.toBe("");
      expect(stripComments(css).match(/prefers-color-scheme/g)?.length).toBe(1);
    }
    expect(ruleBlock(mediaBlock(tokens, LIGHT), ":root")).toContain("color-scheme: light;");
  });

  test("is warm white, with pure white for what is raised off it", () => {
    expect(light.get("--ground")).toBe("#f4f2ec");
    expect(light.get("--panel")).toBe("#ffffff");
  });

  test("gives every colour token a second value, and invents none", () => {
    expect(dark.size).toBeGreaterThan(40);
    for (const name of dark.keys()) {
      const expected = SAME_IN_BOTH.includes(name) ? "same in both" : "set";
      const found = light.has(name) ? "set" : "same in both";
      expect(`${name}: ${found}`).toBe(`${name}: ${expected}`);
    }
    for (const name of light.keys()) expect(`${name}: ${dark.has(name) ? "known" : "NOT a dark token"}`).toBe(`${name}: known`);
  });

  test("every colour that draws text reaches 4.5:1 on the ground and on a panel", () => {
    const text = [...dark.keys()].filter(
      (name) => ["--white", "--muted", "--gold", "--blue", "--crimson", "--heading", "--label", "--active-fg"].includes(name) || (name.startsWith("--ansi-") && name !== "--ansi-black"),
    );
    expect(text.length).toBe(23);
    for (const name of text) {
      for (const surface of ["--ground", "--panel"]) {
        const ratio = contrast(resolve(name, "light"), resolve(surface, "light"));
        expect(ok(`${name} on ${surface}`, ratio, 4.5)).toBe(`${name} on ${surface} ${ratio.toFixed(2)} ok`);
      }
    }
    const current = contrast(resolve("--active-fg", "light"), resolve("--active-bg", "light"));
    expect(ok("--active-fg on --active-bg", current, 4.5)).toBe(`--active-fg on --active-bg ${current.toFixed(2)} ok`);
  });
});

describe("both schemes", () => {
  // The CLI paints its secondary text in ANSI bright-black and its gold in ANSI yellow, and leaves primary text to
  // the terminal's foreground (packages/commands/src/theme.ts). In the pane those must be the app's own colours.
  test("keep four ANSI slots equal to four tokens, which is how the CLI wears the app's colours", () => {
    const pairs = [
      ["--ansi-black", "--line"],
      ["--ansi-bright-black", "--muted"],
      ["--ansi-yellow", "--gold"],
      ["--ansi-bright-white", "--white"],
    ] as const;
    for (const scheme of ["dark", "light"] as const) {
      for (const [slot, token] of pairs) expect(`${scheme} ${slot} ${resolve(slot, scheme)}`).toBe(`${scheme} ${slot} ${resolve(token, scheme)}`);
    }
  });

  test("draw every chart series at 3:1 or better on the chart's surface", () => {
    for (const scheme of ["dark", "light"] as const) {
      for (let slot = 1; slot <= 8; slot++) {
        const ratio = contrast(resolve(`--series-${slot}`, scheme), resolve("--surface-1", scheme));
        expect(ok(`${scheme} --series-${slot}`, ratio, 3)).toBe(`${scheme} --series-${slot} ${ratio.toFixed(2)} ok`);
      }
    }
  });

  test("resolve every token to a colour", () => {
    for (const scheme of ["dark", "light"] as const) {
      for (const name of dark.keys()) {
        const value = resolve(name, scheme);
        expect(`${scheme} ${name}: ${isHex(value) || /^rgba?\(/.test(value) ? "a colour" : `"${value}"`}`).toBe(`${scheme} ${name}: a colour`);
      }
    }
  });
});

describe("the screen stylesheets", () => {
  test("name every colour: no literal sits in a rule, so no rule is stuck on one ground", () => {
    // The HTML preview's frame is white under every scheme, deliberately (reader.css says why).
    const allowed = new Set(["reader.css: #fff"]);
    const sheets = readdirSync(import.meta.dir).filter((name) => name.endsWith(".css") && name !== "print.css");
    expect(sheets.length).toBeGreaterThanOrEqual(6);
    for (const name of sheets) {
      const rules = stripComments(sheet(name)).replace(/--[\w-]+\s*:[^;]+;/g, "");
      const literals = [...rules.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => `${name}: ${m[0]}`);
      expect(literals.filter((found) => !allowed.has(found))).toEqual([]);
    }
  });
});
