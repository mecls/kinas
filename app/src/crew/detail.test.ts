import { expect, test } from "bun:test";
import type { CrewTaskDetail } from "../api.ts";
import { checksOf, clock, prDetail, settingsLine, timelineOf, worktreeWord } from "./detail.ts";

// The task detail's words (build spec §4 Task detail): only what Firstmate or GitHub said.

const AT = Date.parse("2026-09-24T09:31:00Z");

const detail = (extra: Partial<CrewTaskDetail> = {}, task: Partial<CrewTaskDetail["task"]> = {}): CrewTaskDetail => ({
  task: {
    id: "t-9c2e",
    title: "Export listing as CSV",
    repo: "o/r",
    project_name: "r",
    kind: "ship",
    word: "CI red",
    overnight_word: "CI red",
    harness: "claude",
    first_seen_at: AT,
    first_working_at: AT,
    done_at: null,
    gone_at: null,
    last_event_at: null,
    last_event_text: null,
    pr: { number: 121, state: "OPEN", draft: false, mergeable: "MERGEABLE", checks_total: 3, checks_failed: 1 },
    has_pane: true,
    ...task,
  },
  state_line: "state: working · source: pane · harness busy (fm-spawn)",
  state_observed_at: "2026-09-24T09:31:00Z",
  mode: "no-mistakes",
  yolo: false,
  backend: "herdr",
  excerpt: null,
  brief_path: null,
  report_path: null,
  report_present: false,
  worktree_display: "~/.treehouse/r/1/r",
  worktree_present: true,
  pr_review: "REVIEW_REQUIRED",
  checks: [],
  events: [],
  decisions: [],
  ...extra,
});

test("the settings line says only what Firstmate said", () => {
  expect(settingsLine(detail())).toBe(`ship · no-mistakes · yolo off · claude · herdr · observed ${clock(AT)}`);
  expect(settingsLine(detail({ mode: null, backend: null, state_observed_at: null }, { harness: null, kind: "scout" }))).toBe("scout");
  expect(settingsLine(detail({ yolo: true }))).toContain("yolo on");
});

test("the PR in GitHub's words", () => {
  expect(prDetail(detail())).toBe("PR #121 · open · mergeable · review required");
  expect(prDetail(detail({ pr_review: "APPROVED" }, { pr: { number: 7, state: "OPEN", draft: true, mergeable: "CONFLICTING", checks_total: null, checks_failed: null } }))).toBe(
    "PR #7 · open · draft · conflicting · approved",
  );
  expect(prDetail(detail({}, { pr: null }))).toBeNull();
});

test("checks: passed, failed, running, the rest quiet", () => {
  const checks = checksOf(detail({ checks: [
    { name: "build", conclusion: "SUCCESS" },
    { name: "test", conclusion: "FAILURE" },
    { name: "deploy", conclusion: "PENDING" },
    { name: "docs", conclusion: "SKIPPED" },
  ] }));
  expect(checks.map((c) => [c.name, c.state, c.result])).toEqual([
    ["build", "done", "passed"],
    ["test", "red", "failed"],
    ["deploy", "working", "running"],
    ["docs", "stale", "skipped"],
  ]);
});

test("the timeline: one dot per event, orders tagged", () => {
  const items = timelineOf(detail({ events: [
    { at: AT, kind: "word", text: "queued" },
    { at: AT, kind: "state", text: "working" },
    { at: AT, kind: "order", text: "use the env" },
    { at: AT, kind: "pr", text: "PR #121 opened" },
    { at: AT, kind: "checks", text: "checks 2/3 · 1 failing" },
    { at: AT, kind: "checks", text: "checks 3/3" },
    { at: AT, kind: "last_event", text: "working: tests" },
    { at: AT, kind: "gone", text: "gone" },
  ] }));
  expect(items.map((i) => i.state)).toEqual(["queued", "working", "order", "pr", "red", "done", "stale", "gone"]);
  expect(items[0]!.time).toBe(clock(AT));
});

test("the worktree: present, gone, or not yet", () => {
  expect(worktreeWord(detail())).toBe("present");
  expect(worktreeWord(detail({ worktree_present: false }))).toBe("gone");
  expect(worktreeWord(detail({ worktree_present: null }))).toBeNull();
});
