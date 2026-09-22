import { describe, expect, test } from "bun:test";
import { asOf, compactTokens, gb, gib, leftPct, resetsIn, tone, usedPct } from "./format.ts";

const NOW = 1_789_390_320_000; // 2026-09-14T12:52:00Z = 13:52 in Lisbon
const MIN = 60_000;

describe("resetsIn", () => {
  test("hours and minutes, with the Lisbon clock time", () => {
    expect(resetsIn(NOW + 2 * 60 * MIN + 14 * MIN, NOW)).toBe("resets in 2 h 14 m (16:06)");
  });
  test("under an hour", () => {
    expect(resetsIn(NOW + 18 * MIN, NOW)).toBe("resets in 18 m (14:10)");
  });
  test("under a minute", () => {
    expect(resetsIn(NOW + 30_000, NOW)).toBe("resets in <1 m (13:52)");
  });
  test("days away shows the date", () => {
    expect(resetsIn(1_789_714_800_000, NOW)).toBe("resets in 3 d 18 h (2026-09-18 08:00)");
  });
  test("no reset time reported", () => {
    expect(resetsIn(null, NOW)).toBe("resets: not reported");
  });
});

test("asOf uses the Lisbon clock, with the date when it is not today", () => {
  expect(asOf(NOW - 2 * MIN, NOW)).toBe("as of 13:50");
  expect(asOf(1_789_290_000_000, NOW)).toBe("as of 2026-09-13 10:00");
  expect(asOf(null, NOW)).toBe("never read");
});

test("tone by % used (DESIGN.md §2.2): warn from 80, danger from 95; a stale reading is stale whatever its number", () => {
  expect(tone(79, "fresh")).toBe("meter");
  expect(tone(80, "fresh")).toBe("warn");
  expect(tone(94.9, "fresh")).toBe("warn");
  expect(tone(95, "fresh")).toBe("danger");
  expect(tone(312, "fresh")).toBe("danger");
  expect(tone(97, "stale")).toBe("stale");
  // No number, no warning: a dead or reset reading draws no fill, and its bar is the neutral meter.
  expect(tone(97, "dead")).toBe("meter");
  expect(tone(97, "reset")).toBe("meter");
  expect(tone(null, "fresh")).toBe("meter");
});

test("left is floored", () => {
  expect(leftPct(2.5)).toBe(97);
});

test("used reads like ollama.com: one decimal under 10, rounded up, whole numbers from 10", () => {
  expect(usedPct(0)).toBe("0");
  expect(usedPct(0.1)).toBe("0.1");
  expect(usedPct(0.003 * 100)).toBe("0.3"); // not 0.4 from floating-point noise
  expect(usedPct(0.8)).toBe("0.8");
  expect(usedPct(0.84)).toBe("0.9");
  expect(usedPct(2)).toBe("2");
  expect(usedPct(2.5)).toBe("2.5");
  expect(usedPct(33.5)).toBe("34");
  expect(usedPct(100)).toBe("100");
});

test("compact numbers", () => {
  expect(compactTokens(950)).toBe("950");
  expect(compactTokens(34_000)).toBe("34k");
  expect(compactTokens(1_250_000)).toBe("1.3M");
  expect(compactTokens(6_130_000_000)).toBe("6.1B");
  expect(gib(7.44)).toBe("7.4 GiB");
  expect(gib(460.2)).toBe("460 GiB");
});

test("disk sizes in Finder's GB, floored", () => {
  // Measured on this Mac on 2026-09-14: Finder "40,27 GB available", NSURL 40.28 GB = 37.51 GiB; the volume 494.38 GB.
  expect(gb(37.51)).toBe("40.2 GB");
  expect(gb(460.43)).toBe("494 GB");
  expect(gb(29.5)).toBe("31.6 GB");
});
