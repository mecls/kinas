import { expect, test } from "bun:test";
import fixture from "../../../fixtures/quota-line-cases.json";
import { compactTokens, formatQuotaLine, leftPct, type QuotaLineInput } from "./quota-line.ts";

for (const c of fixture.cases) {
  test(c.name, () => {
    expect(formatQuotaLine(c.input as QuotaLineInput, fixture.now)).toBe(c.expected);
  });
}

test("left is floored, never rounded up", () => {
  expect(leftPct(2.5)).toBe(97);
  expect(leftPct(0.1)).toBe(99);
  expect(leftPct(0)).toBe(100);
  expect(leftPct(100)).toBe(0);
});

test("a token count reads the same on the Usage page and in kinas status: 950 · 34k · 1.3M · 6.1B, three figures, never 1000k", () => {
  expect([950, 34_000, 150_400, 1_250_000, 6_130_000_000].map(compactTokens)).toEqual(["950", "34k", "150k", "1.3M", "6.1B"]);
  expect([999.6, 999_600, 999_950_000].map(compactTokens)).toEqual(["1k", "1M", "1B"]);
});
