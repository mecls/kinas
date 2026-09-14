import { expect, test } from "bun:test";
import { join } from "node:path";
import expected from "../fixtures/transcripts/expected.json";
import { lisbonDate, recount } from "./usage-recount.ts";

const fixtures = join(import.meta.dir, "../fixtures/transcripts");

test("recount of the fixture transcripts matches the hand-derived totals", () => {
  expect(recount(join(fixtures, "claude"), join(fixtures, "pi"))).toEqual(expected.rows as never);
});

test("Lisbon dates across the 2026-10-25 DST change (R23)", () => {
  expect(lisbonDate("2026-10-24T23:30:00Z")).toBe("2026-10-25");
  expect(lisbonDate("2026-10-25T23:30:00Z")).toBe("2026-10-25");
});

test("missing roots count nothing", () => {
  expect(recount("/nonexistent/claude", "/nonexistent/pi")).toEqual([]);
});
