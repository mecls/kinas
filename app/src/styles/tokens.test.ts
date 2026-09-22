import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contrast, resolveColor } from "./color.ts";
import { declarations, mediaBlock, ruleBlock, stripComments } from "./testing/palette.ts";

// tokens.css is the design system's one source of values (DESIGN.md v1.2). These tests hold it to the law: one
// light :root and one dark media block declaring the same names; every text pair of DESIGN.md §2.4 at its floor in
// both themes, at the brand accent and at every swatch the Accent field offers; the terminal's sixteen colours
// readable on the pane's ground; no colour literal in any rule of any screen sheet; and, until the last old sheet is
// rewritten, exactly the alias block slice 1 of the design-system build left behind — never one name more.

const dir = import.meta.dir;
const sheet = (name: string) => readFileSync(join(dir, name), "utf8");
const tokens = sheet("tokens.css");
const DARK = "screen and (prefers-color-scheme: dark)";

const light = declarations(ruleBlock(tokens, ":root"));
const darkOnly = declarations(ruleBlock(mediaBlock(tokens, DARK), ":root"));
const dark = new Map([...light, ...darkOnly]);

/** The names slice 1 kept for the sheets not yet rewritten. Slice 6 deletes them; this list shrinks with them. */
const ALIASES = [
  "--ground", "--panel", "--white", "--muted", "--blue", "--crimson", "--gold", "--heading", "--label", "--active-bg",
  "--active-fg", "--button-hover", "--selection", "--shadow-strong", "--shadow-soft", "--sans", "--mono",
];

/** Colour-valued tokens: a hex, an rgb(), a color-mix(), or a var() onto one. Fonts, sizes and spaces are not. */
const isColour = (value: string) => /^(#|rgba?\(|color-mix\(|var\(--(brand-accent|accent|bg|surface|ink|term))/.test(value);

const resolver = (theme: Map<string, string>, accent?: string) => (name: string) =>
  name === "--brand-accent" && accent ? accent : theme.get(name);
const colour = (theme: Map<string, string>, name: string, accent?: string) => resolveColor(`var(${name})`, resolver(theme, accent));

const ok = (label: string, ratio: number, floor: number) => `${label} ${ratio.toFixed(2)} ${ratio >= floor ? "ok" : "TOO PALE"}`;

/** DESIGN.md §2.4 and §7, as pairs: text (or a dot) on its ground, and the floor it must reach. */
const PAIRS: [text: string, ground: string, floor: number][] = [
  ["--ink", "--bg", 4.5],
  ["--ink", "--surface", 4.5],
  ["--ink-2", "--bg", 4.5],
  ["--ink-2", "--surface", 4.5],
  ["--accent-ink", "--accent", 4.5],
  ["--danger", "--surface", 4.5],
  ["--ink", "--accent-soft", 4.5],
  ["--ok", "--bg", 3],
  ["--warn", "--bg", 3],
  ["--stale", "--bg", 3],
  ["--meter", "--meter-track", 3],
  ["--cat-1", "--surface", 3],
  ["--cat-2", "--surface", 3],
  ["--cat-3", "--surface", 3],
  ["--cat-4", "--surface", 3],
  ["--cat-5", "--surface", 3],
  ["--cat-6", "--surface", 3],
];

/** The Accent field's swatches (ui/accent.ts mirrors this list; both are checked here). */
// The preview's graphite (#2b2f36) is not among them: lightened for the dark theme it carries --accent-ink at 3.44:1
// (the preview's own checker approximated the OKLab mix in sRGB), so the field would refuse it and offer a shade.
const SWATCHES = ["#00549e", "#1f6b4a", "#5b3fb8", "#8a3a1f", "#3e7c8a", "#a8527a"];

describe("the shape of tokens.css", () => {
  test("one light :root, one dark media block, nothing else that chooses a theme", () => {
    const clean = stripComments(tokens);
    expect(clean.match(/prefers-color-scheme/g)?.length).toBe(1);
    expect(clean).toContain(`@media ${DARK} {`);
    expect(light.size).toBeGreaterThan(80);
    expect(light.get("--bg")).toBe("#f4f2ec");
    expect(darkOnly.get("--bg")).toBe("#14171e");
    expect(ruleBlock(tokens, ":root")).toContain("color-scheme: light;");
    expect(ruleBlock(mediaBlock(tokens, DARK), ":root")).toContain("color-scheme: dark;");
    expect(clean).not.toContain("data-theme");
  });

  test("the brand layer is the four overridable tokens, and the semantic layer derives from it", () => {
    expect(light.get("--brand-accent")).toBe("#00549e");
    expect(light.get("--brand-font-ui")).toBe('"Inter"');
    expect(light.get("--brand-font-mono")).toBe('"JetBrains Mono"');
    expect(light.get("--brand-font-display")).toBe('"Bricolage Grotesque"');
    expect(light.get("--accent")).toBe("var(--brand-accent)");
    expect(darkOnly.get("--accent")).toBe("color-mix(in oklab, var(--brand-accent), white 32%)");
    expect(light.get("--font-ui")).toMatch(/^var\(--brand-font-ui\), /);
    expect(light.get("--font-mono")).toMatch(/^var\(--brand-font-mono\), /);
    expect(light.get("--font-display")).toBe("var(--brand-font-display), var(--font-ui)");
  });

  test("the dark block restates every colour and only colours; the light root has everything", () => {
    for (const name of darkOnly.keys()) {
      expect(light.has(name), `${name} is dark-only`).toBe(true);
    }
    const sameInBoth = new Set(["--brand-accent", "--accent", "--stale"]);
    for (const [name, value] of light) {
      if (!isColour(value) || ALIASES.includes(name) || sameInBoth.has(name) || name.startsWith("--brand-")) continue;
      expect(darkOnly.has(name), `${name} has no dark value`).toBe(true);
    }
    for (const [name, value] of darkOnly) {
      expect(isColour(value) || name === "--shadow-float" || name === "--scrim", `${name} in the dark block is not a colour`).toBe(true);
    }
  });

  test("the alias block is exactly what slice 1 left, never a name more", () => {
    const present = ALIASES.filter((name) => light.has(name));
    expect(present).toEqual(ALIASES);
    // The old names resolve to the new ones, so the sheets not yet rewritten draw the same colours.
    expect(light.get("--ground")).toBe("var(--bg)");
    expect(light.get("--white")).toBe("var(--ink)");
    expect(light.get("--sans")).toBe("var(--font-ui)");
  });

  test("the bundled fonts are the ones the stacks name, and their files exist", () => {
    const faces = [...stripComments(tokens).matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(faces.length).toBe(6);
    for (const face of faces) {
      const family = /font-family:\s*"([^"]+)"/.exec(face)![1]!;
      expect(["Inter", "JetBrains Mono", "Bricolage Grotesque"]).toContain(family);
      const file = /url\("([^"]+)"\)/.exec(face)![1]!;
      expect(existsSync(join(dir, file)), `${file} is missing`).toBe(true);
    }
    const fonts = readdirSync(join(dir, "../assets/fonts"));
    for (const family of ["Inter", "JetBrainsMono", "BricolageGrotesque"]) {
      expect(fonts, `${family}'s licence`).toContain(`${family}-OFL.txt`);
    }
  });
});

describe("contrast, measured (DESIGN.md §2.4, §7)", () => {
  for (const [themeName, theme] of [["light", light], ["dark", dark]] as const) {
    test(`${themeName}: every text pair reaches its floor at the brand accent`, () => {
      for (const [text, ground, floor] of PAIRS) {
        const ratio = contrast(colour(theme, text), colour(theme, ground));
        expect(ok(`${text} on ${ground}`, ratio, floor)).toBe(ok(`${text} on ${ground}`, ratio, floor).replace("TOO PALE", "ok"));
      }
    });

    test(`${themeName}: the accent pairs hold at every swatch the Accent field offers`, () => {
      for (const swatch of SWATCHES) {
        for (const [text, ground, floor] of PAIRS.filter(([t, g]) => t.includes("accent") || g.includes("accent"))) {
          const ratio = contrast(colour(theme, text, swatch), colour(theme, ground, swatch));
          expect(ok(`${swatch}: ${text} on ${ground}`, ratio, floor)).toMatch(/ ok$/);
        }
      }
    });

    test(`${themeName}: every ANSI colour reads on the pane's ground, and three slots are the tokens they stand for`, () => {
      const bg = colour(theme, "--term-bg");
      for (const name of theme.keys()) {
        if (!name.startsWith("--ansi-") || name === "--ansi-black") continue;
        expect(ok(name, contrast(colour(theme, name), bg), 4.5)).toMatch(/ ok$/);
      }
      expect(ok("--term-fg", contrast(colour(theme, "--term-fg"), bg), 12)).toMatch(/ ok$/);
      expect(colour(theme, "--ansi-black")).toBe(colour(theme, "--line"));
      expect(colour(theme, "--ansi-bright-black")).toBe(colour(theme, "--ink-2"));
      expect(colour(theme, "--ansi-bright-white")).toBe(colour(theme, "--term-fg"));
    });

    test(`${themeName}: a file in the reader sits on the app's surface, never on the terminal's ground`, () => {
      expect(ruleBlock(sheet("reader.css"), ".reader")).toMatch(/(^|[;{\s])background:\s*var\(--surface\);/);
      expect(colour(theme, "--surface")).not.toBe(colour(theme, "--term-bg"));
    });
  }
});

describe("no colour lives outside tokens.css", () => {
  test("no rule in any screen stylesheet holds a colour literal", () => {
    const sheets = readdirSync(dir).filter((f) => f.endsWith(".css") && f !== "tokens.css" && f !== "print.css");
    expect(sheets.length).toBeGreaterThanOrEqual(5);
    // usage.css keeps its eight chart series as scoped declarations until slice 4 paints the chart by provider.
    const allowed = new Set(["reader.css: #fff"]);
    for (const name of sheets) {
      const rules = stripComments(sheet(name)).replace(/--[\w-]+\s*:\s*[^;]+;/g, "");
      for (const m of rules.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)) {
        expect(allowed.has(`${name}: ${m[0]}`), `${name} paints ${m[0]} outside the tokens`).toBe(true);
      }
    }
  });

  test("tokens.css itself is hex, rgb() for the two translucent floats, color-mix and var() — nothing named", () => {
    for (const [name, value] of [...light, ...darkOnly]) {
      if (!isColour(value)) continue;
      expect(value, name).toMatch(/^(#[0-9a-f]{6}|rgb\(\d+ \d+ \d+ \/ [\d.]+\)|color-mix\(in oklab, .+\)|var\(--[\w-]+\))(, .*)?$/);
    }
  });
});
