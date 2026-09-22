// The Accent field's arithmetic (DESIGN.md §4 "Accent field", §8): whether a shade the captain picked will read in
// both themes, and the nearest one that does when it will not. The derivations are tokens.css's — the light accent is
// the brand colour itself under white ink; the dark accent is the brand colour lightened 32 % toward white in OKLab
// under the dark ink — so what is checked here is what the page will paint. Pure; no DOM.

import { contrast, okmix } from "../styles/color.ts";

/** The brand's own accent (tokens.css --brand-accent). */
export const BRAND_ACCENT = "#00549e";
/** What sits on the accent in each theme (tokens.css --accent-ink). */
const ACCENT_INK = { light: "#ffffff", dark: "#0e1420" } as const;
/** DESIGN.md §2.4: text on the accent must reach 4.5:1. */
export const FLOOR = 4.5;

/** The swatches Settings offers, every one of which passes both themes (tokens.test.ts checks the same list). */
export const SWATCHES: readonly { name: string; hex: string }[] = [
  { name: "Blue", hex: "#00549e" },
  { name: "Green", hex: "#1f6b4a" },
  { name: "Violet", hex: "#5b3fb8" },
  { name: "Rust", hex: "#8a3a1f" },
  { name: "Teal", hex: "#3e7c8a" },
  { name: "Rose", hex: "#a8527a" },
];

export const isAccent = (value: string): boolean => /^#[0-9a-f]{6}$/.test(value);

/** The accent as the dark theme derives it. */
export function darkAccent(accent: string): string {
  return okmix(accent, "#ffffff", 0.32);
}

/** The ink's contrast on the accent, per theme. */
export function contrastOf(accent: string): { light: number; dark: number } {
  return { light: contrast(ACCENT_INK.light, accent), dark: contrast(ACCENT_INK.dark, darkAccent(accent)) };
}

export const passes = (accent: string): boolean => {
  const c = contrastOf(accent);
  return c.light >= FLOOR && c.dark >= FLOOR;
};

/**
 * The nearest shade that passes: the light theme wants a darker accent under white ink, the dark theme a lighter
 * one under dark ink, so the shade is walked toward black while only light fails, toward white while only dark
 * fails, and the two are alternated when both do — 2 % steps in OKLab, as the preview's checker did in sRGB. A
 * shade that already passes is returned as it is.
 */
export function nearestPassing(accent: string): string {
  let hex = accent;
  for (let i = 0; i < 100; i++) {
    const c = contrastOf(hex);
    if (c.light >= FLOOR && c.dark >= FLOOR) return hex;
    const target = c.light < FLOOR && (c.dark >= FLOOR || i % 2 === 0) ? "#000000" : "#ffffff";
    hex = okmix(hex, target, 0.02);
  }
  return hex;
}

/** The field's line: "Light 7.6:1, dark 5.1:1, passes" or "Light 1.4:1, dark 2.1:1. Kinas would offer #8a7a00". */
export function describe(accent: string): { text: string; offer: string | null } {
  const c = contrastOf(accent);
  const ratios = `Light ${c.light.toFixed(1)}:1, dark ${c.dark.toFixed(1)}:1`;
  if (c.light >= FLOOR && c.dark >= FLOOR) return { text: `${ratios}, passes`, offer: null };
  const offer = nearestPassing(accent);
  return { text: `${ratios}. Kinas would offer ${offer}`, offer };
}
