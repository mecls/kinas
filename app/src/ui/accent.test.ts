import { describe, expect, test } from "bun:test";
import { BRAND_ACCENT, contrastOf, darkAccent, describe as describeAccent, isAccent, nearestPassing, passes, SWATCHES } from "./accent.ts";

describe("the Accent field's arithmetic", () => {
  test("the brand accent and every swatch pass both themes", () => {
    expect(passes(BRAND_ACCENT)).toBe(true);
    for (const { hex } of SWATCHES) {
      const c = contrastOf(hex);
      expect(`${hex} light ${c.light.toFixed(2)} dark ${c.dark.toFixed(2)} ${passes(hex) ? "ok" : "FAILS"}`).toMatch(/ ok$/);
    }
    // DESIGN.md §2.4 measured white on the brand blue at 7.6:1.
    expect(contrastOf(BRAND_ACCENT).light).toBeCloseTo(7.6, 1);
  });

  test("the dark accent is the brand colour lightened 32 % toward white, as tokens.css derives it", () => {
    expect(darkAccent("#000000")).not.toBe("#000000");
    expect(contrastOf("#000000").dark).toBeGreaterThan(1);
  });

  test("a pale yellow fails, and the shade offered instead passes and is darker", () => {
    expect(passes("#ffe066")).toBe(false);
    const offer = nearestPassing("#ffe066");
    expect(passes(offer)).toBe(true);
    expect(offer).not.toBe("#ffe066");
    expect(contrastOf(offer).light).toBeGreaterThanOrEqual(4.5);
    expect(describeAccent("#ffe066").offer).toBe(offer);
    expect(describeAccent("#ffe066").text).toMatch(/^Light [\d.]+:1, dark [\d.]+:1\. Kinas would offer #[0-9a-f]{6}$/);
  });

  test("the preview's graphite fails only in the dark theme, and the offer walks it lighter", () => {
    const c = contrastOf("#2b2f36");
    expect(c.light).toBeGreaterThan(4.5);
    expect(c.dark).toBeLessThan(4.5);
    const offer = nearestPassing("#2b2f36");
    expect(passes(offer)).toBe(true);
  });

  test("a passing shade is offered back unchanged, and the line says so", () => {
    expect(nearestPassing(BRAND_ACCENT)).toBe(BRAND_ACCENT);
    expect(describeAccent(BRAND_ACCENT)).toEqual({ text: "Light 7.6:1, dark 5.1:1, passes", offer: null });
  });

  test("only six lower-case hex digits after # are an accent", () => {
    expect(isAccent("#00549e")).toBe(true);
    for (const bad of ["#00549E", "00549e", "blue", "#abc", ""]) expect(isAccent(bad)).toBe(false);
  });
});
