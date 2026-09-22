import { describe, expect, test } from "bun:test";
import { okmix } from "./styles/color.ts";
import { toHex } from "./theme.ts";

describe("what a painted token comes back as", () => {
  test("rgb() and rgba() become hex, translucency kept", () => {
    expect(toHex("rgb(244, 242, 236)")).toBe("#f4f2ec");
    expect(toHex("rgb(16 25 43)")).toBe("#10192b");
    expect(toHex("rgba(0, 0, 0, 0.5)")).toBe("#00000080");
    expect(toHex("#abcdef")).toBe("#abcdef");
  });

  test("oklab(), which is how WebKit reports a color-mix(in oklab) it painted, lands where the page's own mix does", () => {
    // Observed 2026-09-22 (appearance.e2e.ts): violet #5b3fb8 lightened 32 % toward white, the dark theme's accent.
    expect(toHex("oklab(0.639852 0.038045 -0.117053)")).toBe(okmix("#5b3fb8", "#ffffff", 0.32));
    expect(toHex("oklab(100% 0 0)")).toBe("#ffffff");
    expect(toHex("oklab(0 0 0 / 0.5)")).toBe("#00000080");
  });
});
