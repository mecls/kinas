import { describe, expect, test } from "bun:test";
import { toneOf } from "./Bar.tsx";
import { formatUsed } from "./Gauge.tsx";

describe("the bar's colour is the reading's state (DESIGN.md §2.2)", () => {
  test("meter below 80 % used, warn from 80, danger from 95, stale when the reading is old, whatever the number", () => {
    expect(toneOf(0)).toBe("meter");
    expect(toneOf(79.9)).toBe("meter");
    expect(toneOf(80)).toBe("warn");
    expect(toneOf(94.9)).toBe("warn");
    expect(toneOf(95)).toBe("danger");
    expect(toneOf(312)).toBe("danger");
    expect(toneOf(null)).toBe("meter");
    expect(toneOf(97, true)).toBe("stale");
  });

  test("the number reads as the providers' own pages show it", () => {
    expect(formatUsed(42)).toBe("42");
    expect(formatUsed(2.5)).toBe("2.5");
    expect(formatUsed(5.04)).toBe("5");
    expect(formatUsed(62.6)).toBe("63");
    expect(formatUsed(0)).toBe("0");
  });
});
