import { expect, test } from "bun:test";
import fixture from "../../../fixtures/quota-line-cases.json";
import { formatQuotaLine, leftPct, type QuotaLineInput } from "./quota-line.ts";

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
