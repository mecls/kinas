// Colour arithmetic the design system needs in two places that cannot ask the engine: the tests, which read
// tokens.css off disk and must know what `color-mix(in oklab, …)` will paint, and the Accent field, which must say
// whether a shade the captain picked will read before it is saved. OKLab per Björn Ottosson (the matrices are the
// reference ones, in linear sRGB); the mix is what CSS Color 4 specifies for `color-mix(in oklab, A pA%, B pB%)`.
// No DOM: pure functions, `#rrggbb` in and out.

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = Math.max(0, Math.min(1, v));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
};

/** WCAG 2.x relative luminance of `#rrggbb` (the WCAG curve, which differs from sRGB's at the toe). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

type Lab = [number, number, number];

export function rgbToOklab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbToHex([
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** `color-mix(in oklab, a (1 − t), b t)`: the share of `b` is `t`, 0 to 1. */
export function okmix(a: string, b: string, t: number): string {
  const la = rgbToOklab(a);
  const lb = rgbToOklab(b);
  return oklabToRgb([la[0] * (1 - t) + lb[0] * t, la[1] * (1 - t) + lb[1] * t, la[2] * (1 - t) + lb[2] * t]);
}

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000" };

/**
 * A token's value as a `#rrggbb`: follows `var(--x)` through `lookup`, evaluates the two `color-mix(in oklab, …)`
 * shapes tokens.css uses (`A p%, B` and `A, B p%`), and accepts `#rrggbb`, `#rgb`, `white` and `black`. Anything else
 * throws — a token the tests cannot read is a token the Accent field cannot check either.
 */
export function resolveColor(expr: string, lookup: (name: string) => string | undefined): string {
  const value = expr.trim();
  const v = /^var\((--[\w-]+)\)$/.exec(value);
  if (v) {
    const next = lookup(v[1]!);
    if (next === undefined) throw new Error(`no value for ${v[1]}`);
    return resolveColor(next, lookup);
  }
  const mix = /^color-mix\(in oklab,\s*(.+?)(?:\s+([\d.]+)%)?\s*,\s*(.+?)(?:\s+([\d.]+)%)?\s*\)$/.exec(value);
  if (mix) {
    const [, a, pa, b, pb] = mix;
    const shareA = pa !== undefined ? Number(pa) / 100 : pb !== undefined ? 1 - Number(pb) / 100 : 0.5;
    return okmix(resolveColor(a!, lookup), resolveColor(b!, lookup), 1 - shareA);
  }
  if (NAMED[value]) return NAMED[value]!;
  if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(value)) return rgbToHex(hexToRgb(value));
  throw new Error(`cannot resolve colour: ${expr}`);
}
