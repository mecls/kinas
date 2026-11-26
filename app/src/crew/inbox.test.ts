import { expect, test } from "bun:test";
import type { CrewDecision, CrewSnapshot, SentAnswer } from "../api.ts";
import { ageText, answeredText, copiedText, heldLine, inboxGroups, reconcileRows, replyText, sentDone, sentNotice, titleOf } from "./inbox.ts";

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
  pr_number: null,
  answered: null,
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

test("a held item's quiet line names its PR when Firstmate does (Firstmate, current)", () => {
  expect(heldLine(decision("t-9c2e", "captain-hold"), NOW)).toBe("Held for you · Export listing as CSV · 12 min ago");
  expect(heldLine(decision("t-9c2e", "captain-hold", { pr_number: 91, opened_at: NOW - 7 * 60 * MIN }), NOW)).toBe("Held for you · Export listing as CSV · PR #91 · 7 h ago");
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

test("reconcile lines are drawn in order with keys that stay distinct when two tasks say the same thing", () => {
  // Rust prefixes a line with the task's title, so two tasks of one title with the same trouble read the same.
  const lines = ["Fix login 9c2e: Firstmate's endpoint (none) is absent", "Fix login 9c2e: Firstmate's endpoint (none) is absent", "Add CSV 9c2e: worktree ~/w is gone"];
  const rows = reconcileRows(lines);
  expect(rows.map((r) => r.line)).toEqual(lines);
  expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  expect(reconcileRows([])).toEqual([]);
});

// Slice 6.2: with the agents on a Linux machine, an answer is a note in Firstmate's inbox, and the item says what became
// of it (build spec §4 Inbox; DESIGN.md 1.14).

const at = (h: number, m: number) => new Date(2026, 10, 26, h, m).getTime();

test("an answered item's quiet line: where from and when, then when the first mate read it", () => {
  expect(answeredText(null)).toBeNull();
  expect(answeredText({ from: "mac", at: at(14, 5), read_at: null, reply: null })).toBe("Answered from the Mac at 14:05");
  expect(answeredText({ from: "phone", at: at(14, 5), read_at: null, reply: null })).toBe("Answered from the phone at 14:05");
  expect(answeredText({ from: "mac", at: at(14, 5), read_at: at(14, 6), reply: null })).toBe("Answered from the Mac at 14:05 · read by the first mate at 14:06");
});

test("the first mate's reply on its own line, only when there is one", () => {
  expect(replyText(null)).toBeNull();
  expect(replyText({ from: "mac", at: 1, read_at: 2, reply: null })).toBeNull();
  expect(replyText({ from: "mac", at: 1, read_at: 2, reply: "On it-9c2e" })).toBe("The first mate: On it-9c2e");
});

const sent = (extra: Partial<SentAnswer>): SentAnswer => ({ outcome: "delivered", woken: true, answered_at: null, why: null, ...extra });

test("the toast says what became of the note, and only a delivery is not an error", () => {
  expect(sentNotice(sent({}))).toEqual({ text: "Sent to the first mate", error: false });
  expect(sentNotice(sent({ woken: false }))).toEqual({ text: "Sent to the first mate — the first mate reads it at its next turn", error: false });
  expect(sentNotice(sent({ outcome: "already", woken: false, answered_at: at(14, 5) }))).toEqual({ text: "Already answered at 14:05", error: true });
  expect(sentNotice(sent({ outcome: "already", woken: false }))).toEqual({ text: "Already answered", error: true });
  expect(sentNotice(sent({ outcome: "not_open", woken: false }))).toEqual({ text: "No longer waiting", error: true });
  expect(sentNotice(sent({ outcome: "unreachable", woken: false, why: "can't reach homelab: timed out" }))).toEqual({ text: "Not delivered: can't reach homelab: timed out", error: true });
});

test("the box closes once the question has its answer, and stays for a resend when the door failed", () => {
  expect(sentDone("delivered")).toBe(true);
  expect(sentDone("already")).toBe(true);
  expect(sentDone("not_open")).toBe(true);
  expect(sentDone("unreachable")).toBe(false);
});
