import { describe, expect, test } from "bun:test";
import { asOf, compactTokens, gib, leftPct, resetsIn, tone } from "./format.ts";

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

test("tone thresholds: crimson at ≤ 10, gold at ≤ 25", () => {
  expect(tone(10)).toBe("crimson");
  expect(tone(10.5)).toBe("gold");
  expect(tone(25)).toBe("gold");
  expect(tone(26)).toBe("blue");
});

test("left is floored", () => {
  expect(leftPct(2.5)).toBe(97);
});

test("compact numbers", () => {
  expect(compactTokens(950)).toBe("950");
  expect(compactTokens(34_000)).toBe("34k");
  expect(compactTokens(1_250_000)).toBe("1.3M");
  expect(compactTokens(6_130_000_000)).toBe("6.1B");
  expect(gib(7.44)).toBe("7.4 GiB");
  expect(gib(460.2)).toBe("460 GiB");
});
