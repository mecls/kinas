import { expect, test } from "bun:test";
import { CAPS, capsViolation, conforms, summary, type Summary } from "./summary.ts";

const good = (): Summary => ({
  v: 1,
  asOf: 1_700_000_000_000,
  label: "homelab",
  board: [{ task: "fix-login", project: "shop", title: "Fix the login", word: "working", kind: "ship", harness: "claude", elapsedS: 120, pr: null, checks: null }],
  waiting: [{ key: "fix-login@fix-login@1700000000000", task: "fix-login", project: "shop", title: "Fix the login", question: "Which license?", recommendation: null, since: 1_700_000_000_000 }],
  counts: { tasks: 1, working: 1, waiting: 1, blocked: 0, inReview: 0 },
  usage: { planWeekPct: 13, planSessionPct: null },
  host: { cpu: 3, memPct: 40, diskPct: 20 },
  heartbeatAt: 1_700_000_000_000,
  lanes: { free: 2, cap: 4 },
});

test("a summary of the allowed shape conforms", () => {
  expect(conforms(summary, good())).toBeNull();
});

test("an unknown field is refused at every level, so a path or a branch can't ride along", () => {
  const top = { ...good(), cwd: "/home/claude/projects/shop" };
  expect(conforms(summary, top)).toMatch(/field the store doesn't hold: cwd/);
  const task = good();
  (task.board[0] as Record<string, unknown>).branch = "fm/fix-login";
  expect(conforms(summary, task)).toMatch(/board\[0\] has a field the store doesn't hold: branch/);
  const item = good();
  (item.waiting[0] as Record<string, unknown>).transcript = "…";
  expect(conforms(summary, item)).toMatch(/waiting\[0\] has a field the store doesn't hold: transcript/);
  const host = good();
  (host.host as Record<string, unknown>).hostname = "homelab";
  expect(conforms(summary, host)).toMatch(/summary\.host has a field/);
});

test("a wrong type, a missing field and a word the board doesn't use are refused", () => {
  const a = good();
  (a as Record<string, unknown>).asOf = "now";
  expect(conforms(summary, a)).toMatch(/asOf is not a number/);
  const b = good() as Record<string, unknown>;
  delete b.host;
  expect(conforms(summary, b)).toMatch(/host is missing/);
  const c = good();
  (c.board[0] as Record<string, unknown>).word = "sleeping";
  expect(conforms(summary, c)).toMatch(/board\[0\]\.word matches none/);
  expect(conforms(summary, { ...good(), v: 2 })).toMatch(/is not 1/);
});

test("a string over its cap is refused, by the characters it holds", () => {
  expect(capsViolation(good())).toBeNull();
  const q = good();
  q.waiting[0]!.question = "x".repeat(CAPS.question + 1);
  expect(capsViolation(q)).toBe("question is over 2000 characters");
  const exact = good();
  exact.waiting[0]!.question = "é".repeat(CAPS.question);
  expect(capsViolation(exact)).toBeNull();
  const t = good();
  t.board[0]!.title = "t".repeat(CAPS.title + 1);
  expect(capsViolation(t)).toBe("title is over 200 characters");
  const r = good();
  r.waiting[0]!.recommendation = "r".repeat(CAPS.recommendation + 1);
  expect(capsViolation(r)).toBe("recommendation is over 500 characters");
});
