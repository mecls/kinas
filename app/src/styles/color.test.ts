import { describe, expect, test } from "bun:test";
import { contrast, hexToRgb, okmix, oklabToRgb, resolveColor, rgbToHex, rgbToOklab } from "./color.ts";

describe("the colour arithmetic the tokens and the Accent field stand on", () => {
  test("hex round-trips, short form included", () => {
    expect(rgbToHex(hexToRgb("#00549E"))).toBe("#00549e");
    expect(rgbToHex(hexToRgb("#abc"))).toBe("#aabbcc");
    expect(() => hexToRgb("blue")).toThrow();
  });

  test("contrast is WCAG's: black on white is 21:1, white on the brand blue is what DESIGN.md §2.4 measured", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#00549e")).toBeCloseTo(7.6, 1);
    expect(contrast("#1b1f27", "#f4f2ec")).toBeCloseTo(14.7, 1);
  });

  test("OKLab round-trips and its midpoint of black and white is the one CSS paints", () => {
    for (const hex of ["#00549e", "#f4f2ec", "#1b1f27", "#d9a03a", "#000000", "#ffffff"]) {
      expect(oklabToRgb(rgbToOklab(hex))).toBe(hex);
    }
    // color-mix(in oklab, black, white) — the reference result every engine agrees on.
    expect(okmix("#000000", "#ffffff", 0.5)).toBe("#636363");
    expect(okmix("#00549e", "#00549e", 0.3)).toBe("#00549e");
  });

  test("resolveColor follows var() chains and both color-mix shapes tokens.css uses", () => {
    const tokens = new Map([
      ["--brand-accent", "#00549e"],
      ["--accent", "var(--brand-accent)"],
      ["--surface", "#ffffff"],
      ["--accent-soft", "color-mix(in oklab, var(--accent) 11%, var(--surface))"],
      ["--accent-dark", "color-mix(in oklab, var(--brand-accent), white 32%)"],
    ]);
    const lookup = (name: string) => tokens.get(name);
    expect(resolveColor("var(--accent)", lookup)).toBe("#00549e");
    expect(resolveColor("var(--accent-soft)", lookup)).toBe(okmix("#00549e", "#ffffff", 0.89));
    expect(resolveColor("var(--accent-dark)", lookup)).toBe(okmix("#00549e", "#ffffff", 0.32));
    expect(() => resolveColor("var(--nope)", lookup)).toThrow("no value for --nope");
    expect(() => resolveColor("hsl(1 2% 3%)", lookup)).toThrow("cannot resolve");
  });
});
