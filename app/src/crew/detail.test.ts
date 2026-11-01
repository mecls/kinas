import { describe, expect, test } from "bun:test";
import type { CrewTaskDetail } from "../api.ts";
import { checksOf, clock, detailFor, prDetail, settingsLine, timelineOf, worktreeWord } from "./detail.ts";

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

test("the clock is 24-hour local time with two-digit hours: midnight is 00:00, seven past five is 07:05", () => {
  // Built from the Mac's own calendar, as the clock reads it, so the test holds in any time zone.
  expect(clock(new Date(2026, 9, 31, 0, 0).getTime())).toBe("00:00");
  expect(clock(new Date(2026, 9, 31, 7, 5).getTime())).toBe("07:05");
  expect(clock(new Date(2026, 9, 31, 23, 59).getTime())).toBe("23:59");
});

test("the 24-hour local clock is written once: the Inbox, the task detail, Overnight and Settings → Crew share it", () => {
  const { readdirSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
  const { join, relative } = require("node:path") as typeof import("node:path");
  const src = join(import.meta.dir, "..");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  };
  const RULE = 'toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })';
  const holders = walk(src)
    .filter((path) => readFileSync(path, "utf8").includes(RULE))
    .map((path) => relative(src, path));
  expect(holders).toEqual(["crew/detail.ts"]);
  // Positive control: each of the four surfaces still reaches it.
  for (const file of ["crew/inbox.ts", "pages/overnight.ts", "settings/CrewSection.tsx"]) {
    expect(readFileSync(join(src, file), "utf8")).toMatch(/import \{[^}]*\bclock\b[^}]*\} from "[./]+(crew\/)?detail\.ts"/);
  }
});

describe("what the panel draws for the task selected (detailFor)", () => {
  const a = detail({}, { id: "a-9c2e" });
  const b = detail({}, { id: "b-9c2e" });

  test("the selected task's own answer is drawn and can be acted on", () => {
    expect(detailFor({ id: "a-9c2e", detail: a }, "a-9c2e", false)).toEqual({ detail: a, current: true });
    // A failed re-read of the same task keeps it, beside the error (ADR 0004).
    expect(detailFor({ id: "a-9c2e", detail: a }, "a-9c2e", true)).toEqual({ detail: a, current: true });
  });

  test("another card selected: the last task stays drawn while the new one is read, and nothing acts on it", () => {
    expect(detailFor({ id: "a-9c2e", detail: a }, "b-9c2e", false)).toEqual({ detail: a, current: false });
  });

  test("another card selected and its read failed: the last task is not drawn under the new selection", () => {
    expect(detailFor({ id: "a-9c2e", detail: a }, "b-9c2e", true)).toEqual({ detail: null, current: false });
    expect(detailFor({ id: "b-9c2e", detail: b }, "b-9c2e", true).current).toBe(true);
  });

  test("nothing read yet, or nothing selected", () => {
    expect(detailFor(null, "a-9c2e", false)).toEqual({ detail: null, current: false });
    expect(detailFor({ id: "a-9c2e", detail: null }, "a-9c2e", false)).toEqual({ detail: null, current: true });
  });
});
