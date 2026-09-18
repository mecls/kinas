import { describe, expect, test } from "bun:test";
import { DEFAULT_READER_PCT, readerPctAt } from "./split.ts";

describe("the divider's position (reader R32, amended)", () => {
  test("follows the pointer as a share of the row, to a tenth of a percent", () => {
    expect(readerPctAt(400, 0, 1000)).toBe(40);
    expect(readerPctAt(612.34, 100, 1000)).toBe(51.2);
  });

  test("stays within 20–80 % and leaves both sides at least 280 px", () => {
    expect(readerPctAt(0, 0, 2000)).toBe(20);
    expect(readerPctAt(2000, 0, 2000)).toBe(80);
    // A 700 px row: 280 px is 40 %, so the reader moves between 40 % and 60 %.
    expect(readerPctAt(10, 0, 700)).toBe(40);
    expect(readerPctAt(690, 0, 700)).toBe(60);
  });

  test("a row with no width keeps the default", () => {
    expect(readerPctAt(100, 0, 0)).toBe(DEFAULT_READER_PCT);
  });
});
