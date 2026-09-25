import { expect, test } from "bun:test";
import type { CrewDecision, CrewSnapshot } from "../api.ts";
import { ageText, copiedText, inboxGroups, titleOf } from "./inbox.ts";

// The Inbox's words (build spec §4 Inbox page): groups in Rust's order, held tasks apart, the Copied line, the age.

const MIN = 60_000;
const NOW = Date.parse("2026-09-25T15:30:00Z");

const decision = (key: string, verb: string, extra: Partial<CrewDecision> = {}): CrewDecision => ({
  task_id: "t-9c2e",
  key,
  verb,
  summary: `${key}?`,
  task_title: "Export listing as CSV",
  repo: "o/r",
  opened_at: NOW - 12 * MIN,
  copied_at: null,
  ...extra,
});

const snapshot = (decisions: CrewDecision[], reconcile: string[] = []) => ({ decisions, reconcile }) as unknown as CrewSnapshot;

test("decisions and held tasks in their own groups, newest first as Rust sent them", () => {
  const g = inboxGroups(snapshot([decision("new", "needs-decision"), decision("t-held", "captain-hold"), decision("old", "blocked")], ["a line"]));
  expect(g.decisions.map((d) => d.key)).toEqual(["new", "old"]);
  expect(g.held.map((d) => d.key)).toEqual(["t-held"]);
  expect(g.reconcile).toEqual(["a line"]);
});

test("the Copied line only after a copy, in local time", () => {
  expect(copiedText(null)).toBeNull();
  const at = new Date(2026, 8, 25, 15, 2).getTime();
  expect(copiedText(at)).toBe("Copied 15:02 — paste it into the first mate's pane");
});

test("ages in minutes, hours and days", () => {
  expect(ageText(NOW - 20_000, NOW)).toBe("just now");
  expect(ageText(NOW - 12 * MIN, NOW)).toBe("12 min ago");
  expect(ageText(NOW - 125 * MIN, NOW)).toBe("2 h ago");
  expect(ageText(NOW - 50 * 60 * MIN, NOW)).toBe("2 d ago");
  expect(ageText(NOW + MIN, NOW)).toBe("just now", "a clock skew is never negative");
});

test("a task's title, else its id", () => {
  expect(titleOf(decision("k", "needs-decision"))).toBe("Export listing as CSV");
  expect(titleOf(decision("k", "needs-decision", { task_title: null }))).toBe("t-9c2e");
});
