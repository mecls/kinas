import { describe, expect, test } from "bun:test";
import { asOf, compactTokens, gb, gib, leftPct, lisbonDayClock, resetsCaption, tone, usedPct, withStale } from "./format.ts";

test("a stale row's unit says stale after its words, or alone when it had none — never ' · stale' with nothing before it", () => {
  expect(withStale("of 8 GiB", true)).toBe("of 8 GiB · stale");
  expect(withStale("", true)).toBe("stale");
  expect(withStale("of 8 GiB", false)).toBe("of 8 GiB");
  expect(withStale("", false)).toBe("");
});

const NOW = 1_789_390_320_000; // 2026-09-14T12:52:00Z = 13:52 in Lisbon
const MIN = 60_000;

describe("resetsCaption (DESIGN.md §6, 1.13)", () => {
  test("within a day it reads relative, the absolute time its tooltip", () => {
    expect(resetsCaption(NOW + 119 * MIN, NOW)).toEqual({ text: "resets in 1 h 59 m", title: "resets Mon 14 Sep, 15:51" });
    expect(resetsCaption(NOW + 18 * MIN, NOW).text).toBe("resets in 18 m");
    expect(resetsCaption(NOW + 30_000, NOW).text).toBe("resets in <1 m");
    expect(resetsCaption(NOW + 24 * 60 * MIN - 1, NOW).text).toBe("resets in 23 h 59 m");
  });

  test("beyond a day it reads absolute, the relative time its tooltip", () => {
    expect(resetsCaption(1_789_714_800_000, NOW)).toEqual({ text: "resets Fri 18 Sep, 08:00", title: "resets in 3 d 18 h" });
    expect(resetsCaption(NOW + 24 * 60 * MIN, NOW).text).toBe("resets Tue 15 Sep, 13:52");
  });

  test("no reset reported says so, with nothing to hover", () => {
    expect(resetsCaption(null, NOW)).toEqual({ text: "resets not reported", title: "" });
  });

  test("the day clock is Lisbon's, with the month and weekday from fixed names", () => {
    expect(lisbonDayClock(Date.UTC(2026, 9, 1, 23, 30))).toBe("Fri 2 Oct, 00:30");
    expect(lisbonDayClock(Date.UTC(2026, 11, 31, 23, 59))).toBe("Thu 31 Dec, 23:59");
    expect(lisbonDayClock(Date.UTC(2026, 6, 15, 11, 5))).toBe("Wed 15 Jul, 12:05");
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
  // Rounding at a unit's ceiling moves up a unit: never "1000k" or "1000M".
  expect(compactTokens(999_600)).toBe("1M");
  expect(compactTokens(999_950_000)).toBe("1B");
  expect(compactTokens(999)).toBe("999");
  expect(compactTokens(999.6)).toBe("1k");
  expect(gib(7.44)).toBe("7.4 GiB");
  expect(gib(460.2)).toBe("460 GiB");
});

test("disk sizes in Finder's GB, floored", () => {
  // Measured on this Mac on 2026-09-14: Finder "40,27 GB available", NSURL 40.28 GB = 37.51 GiB; the volume 494.38 GB.
  expect(gb(37.51)).toBe("40.2 GB");
  expect(gb(460.43)).toBe("494 GB");
  expect(gb(29.5)).toBe("31.6 GB");
});
