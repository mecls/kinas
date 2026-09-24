import { describe, expect, test } from "bun:test";
import type { CrewStore, CrewTaskRow } from "@kinas/store/types";
import { crewStatusFromStore, crewStatusJson, crewStatusLines } from "./crew-status.ts";

const NOW = 1_790_000_000_000;
const MIN = 60_000;

const row = (over: Partial<CrewTaskRow>): CrewTaskRow => ({
  state: null,
  backlog_state: "in_flight",
  pending_decision: 0,
  captain_actionable: 0,
  blocked_event: 0,
  pr_url: null,
  pr_number: null,
  pr_state: null,
  pr_draft: null,
  pr_mergeable: null,
  pr_checks_total: null,
  pr_checks_failed: null,
  first_working_at: null,
  done_at: null,
  gone_at: null,
  ...over,
});

const store = (rows: CrewTaskRow[], health: unknown = null, waiting = 0): CrewStore => ({
  schemaVersion: () => 5,
  getCrewTasks: () => rows,
  getCrewWaiting: () => waiting,
  getCrewHealth: () => health,
});

const FORBIDDEN = ["id", "title", "repo", "path", "url", "worktree", "home", "key", "summary", "text"];

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, into);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) (into.add(k), keysOf(v, into));
  return into;
}

describe("kinas crew status", () => {
  const rows = [
    row({ backlog_state: "queued" }),
    row({ state: "working", first_working_at: NOW - 12 * MIN }),
    row({ state: "working", first_working_at: NOW - 30 * MIN, pr_url: "https://github.com/o/r-9c2e/pull/12", pr_number: 12, pr_checks_total: 4, pr_checks_failed: 1 }),
    row({ state: "parked", captain_actionable: 1 }),
    row({ backlog_state: "done", first_working_at: NOW - 60 * MIN, done_at: NOW - 19 * MIN }),
  ];
  const health = { at: "f9f74a1d91cc7e105ec3df2249eda4e07f9ba540", tools: [{ name: "tasks-axi", version: "0.2.5", ok: true }, { name: "treehouse", version: null, ok: false }] };
  const status = crewStatusFromStore(store(rows, health, 2), NOW, true);

  test("counts by word, the waiting count, and each task's word, elapsed and PR number", () => {
    expect(status.counts).toEqual({ queued: 1, in_flight: 3, needs_decision: 1, ci_red: 1, ready: 0, done_7d: 1 });
    expect(status.waiting).toBe(2);
    expect(status.tasks).toEqual([
      { word: "queued", elapsed_s: null, pr: null },
      { word: "working", elapsed_s: 720, pr: null },
      { word: "CI red", elapsed_s: 1800, pr: 12 },
      { word: "needs decision", elapsed_s: null, pr: null },
      { word: "done", elapsed_s: 2460, pr: null },
    ]);
    expect(status.at).toBe("f9f74a1");
    expect(status.tools.find((t) => t.name === "tasks-axi")).toEqual({ name: "tasks-axi", version: "0.2.5", ok: true });
    expect(status.tools.find((t) => t.name === "lavish-axi")).toEqual({ name: "lavish-axi", version: null, ok: false });
  });

  test("the JSON carries none of the forbidden keys and no task's name", () => {
    const json = crewStatusJson(status);
    const keys = keysOf(json);
    for (const k of FORBIDDEN) expect(keys.has(k), k).toBe(false);
    expect(JSON.stringify(json)).not.toContain("9c2e");
    expect(Object.keys(json)).toEqual(["installed", "pin", "at", "tools", "counts", "waiting", "tasks"]);
  });

  test("the lines say the pin, the missing tools and the counts", () => {
    const lines = crewStatusLines(status);
    expect(lines[0]).toBe("Firstmate   f9f74a1 (pinned)");
    expect(lines[1]).toContain("missing: treehouse");
    expect(lines[2]).toBe("Crew        3 in flight · 1 queued · 1 needs decision · 1 CI red · 0 ready · 1 done this week");
    expect(lines[3]).toBe("Waiting     2 on you");
    expect(crewStatusLines(crewStatusFromStore(store([]), NOW, false))[0]).toBe("Firstmate   not installed — run kinas crew setup in the Work pane");
  });

  test("a moved pin says so", () => {
    const moved = crewStatusFromStore(store([], { at: "9296f9b0000", tools: [] }), NOW, true);
    expect(crewStatusLines(moved)[0]).toBe("Firstmate   9296f9b — moved from f9f74a1");
  });
});
