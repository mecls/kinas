import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EVENTS, MON, PLAN, SPANS } from "./scenario.ts";
import { week } from "./week.ts";

// The fixture the Mac's mirror and the e2e read is the hand-counted scenario, line for line: change one and this fails.
test("fixtures/factory-events.synthetic.jsonl is the scenario's events", () => {
  const lines = readFileSync(new URL("../../../fixtures/factory-events.synthetic.jsonl", import.meta.url), "utf8").trim().split("\n");
  expect(lines.map((l) => JSON.parse(l))).toEqual(EVENTS);
});

test("counted from the fixture's own lines, the week is the same", () => {
  const lines = readFileSync(new URL("../../../fixtures/factory-events.synthetic.jsonl", import.meta.url), "utf8").trim().split("\n");
  const w = week(lines.map((l) => JSON.parse(l)), SPANS, PLAN, MON);
  expect(w.merged).toBe(6);
  expect(w.cycle.median.value).toBe(8 * 3_600_000);
});
