import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// print.css redefines the app's colour tokens for white paper. "Readable" is a number, not an opinion: every colour
// that draws text must reach WCAG's 4.5:1 against the page. The screen palette is tuned for a dark ground — its
// yellows and bright blues sit near 1.5:1 on white — so a token forgotten here prints as a near-invisible word.

const css = readFileSync(join(import.meta.dir, "print.css"), "utf8");
const tokens = readFileSync(join(import.meta.dir, "tokens.css"), "utf8");
const reader = readFileSync(join(import.meta.dir, "reader.css"), "utf8");

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

/** `--name: #rrggbb` pairs inside print.css's `:root` block. */
function printPalette(): Map<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  return new Map([...root.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1]!, m[2]!]));
}

describe("the print palette", () => {
  const palette = printPalette();

  test("is entirely inside @media print, so the screen never sees it", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "").trim().startsWith("@media print")).toBe(true);
  });

  test("the page is white and the text is dark", () => {
    expect(palette.get("--ground")).toBe("#ffffff");
    expect(contrastOnWhite(palette.get("--white") ?? "#ffffff")).toBeGreaterThan(12);
  });

  test("every colour that draws text reaches 4.5:1 on white", () => {
    // Text colours: the body, the muted labels, the status gold, and every ANSI step the highlighter maps onto.
    const textTokens = [...palette.keys()].filter((name) => name === "--white" || name === "--muted" || name === "--gold" || name.startsWith("--ansi-"));
    expect(textTokens.length).toBeGreaterThanOrEqual(11);
    for (const name of textTokens) {
      const ratio = contrastOnWhite(palette.get(name)!);
      expect(`${name} ${ratio.toFixed(2)} ${ratio >= 4.5 ? "ok" : "TOO PALE"}`).toBe(`${name} ${ratio.toFixed(2)} ok`);
    }
  });

  test("every ANSI colour the highlighter uses has a print value", () => {
    const used = new Set([...reader.matchAll(/\.hljs-[\s\S]*?\{[^}]*?var\((--ansi-[\w-]+)\)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(`${name}: ${palette.has(name) ? "redefined" : "MISSING from print.css"}`).toBe(`${name}: redefined`);
  });

  test("redefines only tokens that exist", () => {
    for (const name of palette.keys()) expect(`${name}: ${tokens.includes(`${name}:`) ? "known" : "NOT a token"}`).toBe(`${name}: known`);
  });
});
