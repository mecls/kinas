import { describe, expect, test } from "bun:test";
import { accentLine, BANNER, BANNER_WIDTH, bannerLines, colorEnabled, paint, palette, visibleWidth } from "./theme.ts";

describe("theme", () => {
  test("the banner is six rows of one width that fit any 100-column screen", () => {
    expect(BANNER).toHaveLength(6);
    for (const row of BANNER) expect(visibleWidth(row)).toBe(BANNER_WIDTH);
    expect(BANNER_WIDTH).toBeLessThanOrEqual(60);
  });

  test("the palette is the brief's", () => {
    expect(palette).toEqual({ blue: "#00549E", white: "#F4F2EC", muted: "#8593A6", crimson: "#C4262E", gold: "#DFAE3C" });
  });

  test("without colour the banner and text are plain", () => {
    expect(bannerLines(false)).toEqual([...BANNER]);
    expect(paint("crimson", "x", false)).toBe("x");
    expect(accentLine(3, false)).toBe("━━━");
  });

  test("with colour the face is royal blue, the shadow muted, and widths are unchanged", () => {
    const lines = bannerLines(true);
    expect(lines[0]).toContain("\x1b[38;2;0;84;158m██");
    expect(lines[0]).toContain("\x1b[38;2;133;147;166m╗");
    for (const l of lines) expect(visibleWidth(l)).toBe(BANNER_WIDTH);
    expect(accentLine(2, true)).toBe("\x1b[38;2;196;38;46m━━\x1b[0m");
  });

  test("colour only on a TTY, never with NO_COLOR, always with FORCE_COLOR", () => {
    expect(colorEnabled({ isTTY: true }, {})).toBe(true);
    expect(colorEnabled({ isTTY: false }, {})).toBe(false);
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(true);
    expect(colorEnabled({ isTTY: true }, { FORCE_COLOR: "0" })).toBe(true);
  });
});
