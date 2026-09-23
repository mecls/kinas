import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { declarations, mediaBlock, ruleBlock } from "./testing/palette.ts";

// DESIGN.md §2 is the law and tokens.css is its one implementation (DESIGN.md 1.2): every value §2 writes in its code
// blocks is the value tokens.css declares, in the theme the block names. A token changed in one and not the other
// fails here, naming the token and both values — the four artifacts agree (build-spec §6.12).

const repo = join(import.meta.dir, "../../..");
const design = readFileSync(join(repo, "DESIGN.md"), "utf8");
const tokens = readFileSync(join(import.meta.dir, "tokens.css"), "utf8");
const light = declarations(ruleBlock(tokens, ":root"));
const dark = new Map([...light, ...declarations(ruleBlock(mediaBlock(tokens, "screen and (prefers-color-scheme: dark)"), ":root"))]);

/** The code blocks of one numbered section of DESIGN.md (`### 2.2 …` up to the next heading). */
function blocks(section: string): string[] {
  const start = design.indexOf(`### ${section} `);
  if (start < 0) throw new Error(`DESIGN.md has no section ${section}`);
  const end = design.indexOf("\n#", start + 1);
  const body = design.slice(start, end < 0 ? undefined : end);
  return [...body.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

/** One spelling for a value, so "#00549E" and "#00549e", ".12" and "0.12", "4" and "4px" compare as equal. */
function normal(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s(,/])\.(\d)/g, "$10.$2")
    .replace(/\s+/g, " ");
}

/** A value as §2 writes one: a hex, a var(), a color-mix() (its var()s balanced), a quoted font, or a number. */
const TOKEN = /(--[a-z0-9-]+)\s+(#[0-9a-fA-F]{6}\b|color-mix\((?:[^()]|\([^()]*\))*\)|var\([^)]*\)|"[^"]+"|\d+(?:\.\d+)?(?:ms)?\b)/g;

/** Every `--name value` a block writes. A bare number is a px length (or ms, written); the rest compare as written. */
function written(block: string): [name: string, value: string][] {
  const out: [string, string][] = [];
  for (const line of block.split("\n")) {
    // A shadow is a list of lengths and colours: the rest of its line is the value.
    const shadow = /^(--shadow-[a-z]+)\s+(.+)$/.exec(line.trim());
    if (shadow) {
      out.push([shadow[1]!, shadow[2]!]);
      continue;
    }
    for (const m of line.matchAll(TOKEN)) {
      const [, name, raw] = m as unknown as [string, string, string];
      out.push([name, /^\d+(\.\d+)?$/.test(raw) ? `${raw}px` : raw]);
    }
  }
  return out;
}

function agree(theme: Map<string, string>, pairs: [string, string][]) {
  const checked: string[] = [];
  for (const [name, value] of pairs) {
    if (!theme.has(name)) continue;
    checked.push(name);
    expect(`${name}: DESIGN.md ${normal(value)}`).toBe(`${name}: DESIGN.md ${normal(theme.get(name)!)}`);
  }
  return checked;
}

describe("DESIGN.md §2 and tokens.css agree", () => {
  test("2.1 the brand layer", () => {
    expect(agree(light, blocks("2.1").flatMap(written))).toEqual(["--brand-accent", "--brand-font-ui", "--brand-font-mono", "--brand-font-display"]);
  });

  test("2.2 the light theme, the terminal's light values included", () => {
    const [block] = blocks("2.2");
    // "--term-bg #F4F2EC   light; #10192B dark": the first value is the light one, the one before "dark" the dark.
    const both = [...block!.matchAll(/(--term-[a-z]+)\s+(#[0-9a-fA-F]{6})\s+light; (#[0-9a-fA-F]{6}) dark/g)];
    expect(both.length).toBe(3);
    for (const [, name, lightValue, darkValue] of both) {
      expect(`${name} light ${normal(lightValue!)}`).toBe(`${name} light ${normal(light.get(name!)!)}`);
      expect(`${name} dark ${normal(darkValue!)}`).toBe(`${name} dark ${normal(dark.get(name!)!)}`);
    }
    expect(agree(light, written(block!)).length).toBeGreaterThanOrEqual(27);
  });

  test("2.3 the dark theme", () => {
    expect(agree(dark, blocks("2.3").flatMap(written)).length).toBeGreaterThanOrEqual(24);
  });

  test("2.5 the type scales, as the --fs / --lh pairs tokens.css declares", () => {
    const [block] = blocks("2.5");
    const mac = [...block!.matchAll(/--text-([a-z]+)\s+(\d+) \/ (\d+)/g)];
    const phone = [...block!.matchAll(/--m-text-([a-z]+)\s+(\d+) \/ (\d+)/g)];
    expect(mac.length).toBe(6);
    expect(phone.length).toBe(4);
    for (const [, step, size, line] of mac) {
      expect(`--fs-${step} ${light.get(`--fs-${step}`)} / --lh-${step} ${light.get(`--lh-${step}`)}`).toBe(`--fs-${step} ${size}px / --lh-${step} ${line}px`);
    }
    for (const [, step, size, line] of phone) {
      expect(`--m-fs-${step} ${light.get(`--m-fs-${step}`)} / --m-lh-${step} ${light.get(`--m-lh-${step}`)}`).toBe(`--m-fs-${step} ${size}px / --m-lh-${step} ${line}px`);
    }
    // The three stacks, each written on one line: "--font-ui     var(--brand-font-ui), -apple-system, …".
    for (const name of ["--font-ui", "--font-mono", "--font-display"]) {
      const line = new RegExp(`^${name}\\s+(.+?)(\\s{3,}.*)?$`, "m").exec(block!);
      expect(`${name}: DESIGN.md ${normal(line?.[1] ?? "missing")}`).toBe(`${name}: DESIGN.md ${normal(light.get(name)!)}`);
    }
  });

  test("2.6 space, radius, layout and geometry", () => {
    const checked = agree(light, blocks("2.6").flatMap(written));
    for (const name of ["--space-0", "--space-1h", "--space-7", "--radius-lg", "--sidebar-w", "--panel-w", "--pane-min", "--chrome-h", "--page-max", "--hit", "--tabbar-h", "--dot", "--bar-h-inline", "--dur-slow"]) {
      expect(checked).toContain(name);
    }
  });
});
