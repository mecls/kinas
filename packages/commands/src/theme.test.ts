import { describe, expect, test } from "bun:test";
import { LOGO_GRID } from "./logo-grid.ts";
import { accentLine, BANNER, BANNER_WIDTH, bannerLines, colorEnabled, LOGO_HEIGHT, LOGO_WIDTH, logoLines, paint, palette, polarityFromEnv, visibleWidth } from "./theme.ts";

describe("theme", () => {
  test("the banner is six rows of one width that fit any 100-column screen", () => {
    expect(BANNER).toHaveLength(6);
    for (const row of BANNER) expect(visibleWidth(row)).toBe(BANNER_WIDTH);
    expect(BANNER_WIDTH).toBeLessThanOrEqual(60);
  });

  test("the palette holds only what is painted exactly: the two brand colours, and the logo's warm white", () => {
    expect(palette).toEqual({ blue: "#00549E", white: "#F4F2EC", crimson: "#C4262E" });
  });

  test("text rides the terminal's own colours, so it reads on a dark ground and on a light one", () => {
    // Primary text is the terminal's foreground: no colour at all, bold when asked.
    expect(paint("white", "x", true)).toBe("x");
    expect(paint("white", "x", true, true)).toBe("\x1b[1mx\x1b[0m");
    // Secondary text and gold are ANSI slots, which the Kinas pane sets to --muted and --gold on either ground.
    expect(paint("muted", "x", true)).toBe("\x1b[90mx\x1b[0m");
    expect(paint("gold", "x", true)).toBe("\x1b[33mx\x1b[0m");
    // Gold is never bold: a terminal draws bold ANSI yellow in the bright slot, which is another colour.
    expect(paint("gold", "x", true, true)).toBe("\x1b[33mx\x1b[0m");
    // The brand colours read on both grounds and stay exact.
    expect(paint("blue", "x", true, true)).toBe("\x1b[1;38;2;0;84;158mx\x1b[0m");
    expect(paint("crimson", "x", true)).toBe("\x1b[38;2;196;38;46mx\x1b[0m");
  });

  test("without colour the banner and text are plain", () => {
    expect(bannerLines(false)).toEqual([...BANNER]);
    expect(paint("crimson", "x", false)).toBe("x");
    expect(accentLine(3, false)).toBe("━━━");
  });

  test("with colour the face is royal blue, the shadow muted, and widths are unchanged", () => {
    const lines = bannerLines(true);
    expect(lines[0]).toContain("\x1b[38;2;0;84;158m██");
    expect(lines[0]).toContain("\x1b[90m╗");
    for (const l of lines) expect(visibleWidth(l)).toBe(BANNER_WIDTH);
    expect(accentLine(2, true)).toBe("\x1b[38;2;196;38;46m━━\x1b[0m");
  });

  test("the logo is braille, 22 columns by 11 rows, every line one width", () => {
    expect(LOGO_GRID).toHaveLength(44);
    for (const row of LOGO_GRID) expect(row).toMatch(/^[#. ]{44}$/);
    const plain = logoLines(false);
    expect([plain.length, LOGO_WIDTH, LOGO_HEIGHT]).toEqual([11, 22, 11]);
    for (const l of plain) expect(l).toMatch(/^[⠀-⣿]{22}$/);
    expect(plain.join("").replace(/⠀/g, "").length).toBeGreaterThan(60);
  });

  test("with colour the logo's dots are warm white on its navy disc, and widths are unchanged", () => {
    const colored = logoLines(true);
    expect(colored.join("")).toContain("\x1b[38;2;244;242;236;48;2;10;20;32m");
    // The rim, where a character is mostly off the disc: the same warm white, on the terminal's own ground.
    expect(colored.join("")).toContain("\x1b[38;2;244;242;236m");
    for (const l of colored) expect(visibleWidth(l)).toBe(LOGO_WIDTH);
    expect(logoLines(false).join("")).not.toContain("\x1b[");
    // Dark is what a terminal is taken for unless it says otherwise.
    expect(logoLines(true, "dark")).toEqual(colored);
  });

  test("on a light ground the disc is royal blue, and the rim is drawn in the disc's own dots so the shield stays round", () => {
    const light = logoLines(true, "light").join("");
    expect(light).toContain("\x1b[38;2;244;242;236;48;2;0;84;158m");
    expect(light).not.toContain("48;2;10;20;32");
    // Warm-white rim dots would vanish on warm white. The rim draws the disc instead, in blue, and the ground shows
    // through where the dots were.
    expect(light).toContain("\x1b[38;2;0;84;158m");
    expect(light).not.toContain("\x1b[38;2;244;242;236m");
    for (const l of logoLines(true, "light")) expect(visibleWidth(l)).toBe(LOGO_WIDTH);
    // Without colour there is one logo, whatever the ground.
    expect(logoLines(false, "light")).toEqual(logoLines(false, "dark"));
  });

  test("the ground is read from COLORFGBG, by vim's rule, and is dark unless it says light", () => {
    // The Kinas pane writes "0;15" or "15;0" on the launch screen's command line (app/src-tauri/src/pty.rs).
    expect(polarityFromEnv({ COLORFGBG: "0;15" })).toBe("light");
    expect(polarityFromEnv({ COLORFGBG: "15;0" })).toBe("dark");
    // rxvt's three-field form; 7 is light grey; 8 is dark grey.
    expect(polarityFromEnv({ COLORFGBG: "0;default;15" })).toBe("light");
    expect(polarityFromEnv({ COLORFGBG: "0;7" })).toBe("light");
    expect(polarityFromEnv({ COLORFGBG: "15;8" })).toBe("dark");
    for (const unknown of [undefined, "", "light", "0;", "0;default", "0;16", "0;1.5"]) expect(polarityFromEnv({ COLORFGBG: unknown })).toBe("dark");
  });

  test("colour only on a TTY, never with NO_COLOR, always with FORCE_COLOR", () => {
    expect(colorEnabled({ isTTY: true }, {})).toBe(true);
    expect(colorEnabled({ isTTY: false }, {})).toBe(false);
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(true);
    expect(colorEnabled({ isTTY: true }, { FORCE_COLOR: "0" })).toBe(true);
  });
});
