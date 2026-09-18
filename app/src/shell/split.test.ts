import { describe, expect, test } from "bun:test";
import { DEFAULT_PANEL_PCT, panelPctAt } from "./split.ts";

describe("the divider's position (reader R32, amended; the panel is on the right)", () => {
  test("is the panel's share measured from the stage's right edge, to a tenth of a percent", () => {
    // A 1000 px stage ending at x = 1000: a pointer at 600 leaves 400 px to its right.
    expect(panelPctAt(600, 1000, 1000)).toBe(40);
    // The same stage starting at x = 100, so it ends at 1100.
    expect(panelPctAt(587.66, 1100, 1000)).toBe(51.2);
  });

  test("dragging left widens the panel, dragging right narrows it", () => {
    expect(panelPctAt(300, 1000, 1000)).toBeGreaterThan(panelPctAt(700, 1000, 1000));
  });

  test("stays within 20–80 % and leaves both sides at least 280 px", () => {
    expect(panelPctAt(2000, 2000, 2000)).toBe(20);
    expect(panelPctAt(0, 2000, 2000)).toBe(80);
    // A 700 px stage: 280 px is 40 %, so the panel moves between 40 % and 60 %.
    expect(panelPctAt(690, 700, 700)).toBe(40);
    expect(panelPctAt(10, 700, 700)).toBe(60);
  });

  test("a stage with no width keeps the default", () => {
    expect(panelPctAt(100, 0, 0)).toBe(DEFAULT_PANEL_PCT);
  });

  test("the default is 45 — the same number commands.rs falls back to", () => {
    // READER_WIDTH_DEFAULT in app/src-tauri/src/commands.rs pins the same value from its side.
    expect(DEFAULT_PANEL_PCT).toBe(45);
  });
});
