import { describe, expect, test } from "bun:test";
import type { CrewSnapshot, CrewTask, ProviderMetricView, QuotaView, ReaderView, UsageSnapshot } from "../api.ts";
import { crewTotals, crewWords, popoverBlocks, statusModel } from "./statusBar.ts";

const NOW = 1_789_390_320_000; // 2026-09-14T12:52:00Z = 13:52 in Lisbon
const MIN = 60_000;

const quota = (subscription: QuotaView["subscription"], window: QuotaView["window"], used_pct: number, extra: Partial<QuotaView> = {}): QuotaView => ({
  subscription,
  window,
  used_pct,
  left_pct: 100 - used_pct,
  resets_at: NOW + 119 * MIN,
  plan: null,
  source: "test",
  updated_at: NOW - 2 * MIN,
  state: "fresh",
  models: [],
  ...extra,
});

const metric = (name: string, used_pct: number | null, extra: Partial<ProviderMetricView> = {}): ProviderMetricView => ({
  provider: "convex",
  metric: name,
  window: "month",
  used: 1,
  limit_value: used_pct === null ? null : 1,
  unit: null,
  used_pct,
  left_pct: used_pct === null ? null : 100 - used_pct,
  detail: null,
  source: "test",
  updated_at: NOW - 5 * MIN,
  state: "fresh",
  ...extra,
});

const reader = (id: ReaderView["reader"], state: ReaderView["state"] = "ok"): ReaderView => ({
  reader: id,
  state,
  last_attempt_at: NOW,
  last_success_at: NOW - MIN,
  last_error: null,
  stale_after_ms: 600_000,
  dead_after_ms: 3_600_000,
});

const snapshot = (extra: Partial<UsageSnapshot> = {}): UsageSnapshot =>
  ({
    now: NOW,
    quotas: [quota("claude-plan", "week", 24), quota("claude-plan", "session", 97), quota("ollama-cloud", "session", 2.5), quota("ollama-cloud", "week", 34)],
    provider_metrics: [],
    readers: [reader("claude-plan"), reader("ollama-cloud"), reader("host"), reader("convex", "not_configured"), reader("hostinger", "not_configured")],
    host: null,
    linux_host: null,
    usage: [],
    first_usage_date: null,
    days: [],
    backfill: { done: 0, total: 0, running: false },
    claude_hook: {} as UsageSnapshot["claude_hook"],
    ...extra,
  }) as UsageSnapshot;

const task = (id: string, word: CrewTask["word"], finished = false): CrewTask =>
  ({ id, word, finished, title: id, repo: null, project_name: null, kind: "ship", overnight_word: word, harness: null, first_seen_at: 0 }) as CrewTask;

const crew = (tasks: CrewTask[], waiting: number, page: CrewSnapshot["page"] = "running"): CrewSnapshot => ({ page, tasks, waiting }) as unknown as CrewSnapshot;

describe("statusModel (rules 23–24)", () => {
  test("tone only when it matters: a fine reading has no dot, 97 % is danger, a stale one is stale", () => {
    const s = snapshot({ quotas: [quota("claude-plan", "week", 24), quota("claude-plan", "session", 97), quota("ollama-cloud", "session", 2.5, { state: "stale" })] });
    expect(statusModel(s, null).readings).toEqual([
      { key: "claude-plan/week", label: "Claude week", pct: "24%", tone: null },
      { key: "claude-plan/session", label: "Claude session", pct: "97%", tone: "danger" },
      { key: "ollama-cloud/session", label: "Ollama session", pct: "2.5%", tone: "stale" },
    ]);
    expect(statusModel(snapshot({ quotas: [quota("claude-plan", "week", 85)] }), null).readings[0]!.tone).toBe("warn");
  });

  test("a dead or reset window shows a dash and no dot; Home's three slots, in Home's order", () => {
    const s = snapshot({ quotas: [quota("claude-plan", "session", 50, { state: "reset" }), quota("claude-plan", "week", 50, { state: "dead" })] });
    expect(statusModel(s, null).readings.map((r) => [r.label, r.pct, r.tone])).toEqual([
      ["Claude week", "—", null],
      ["Claude session", "—", null],
    ]);
  });

  test("empty and no crew: no quotas says so; the crew before its setup draws nothing; no snapshot is not empty", () => {
    expect(statusModel(snapshot({ quotas: [] }), null)).toEqual({ readings: [], empty: true, crew: null, vps: null });
    expect(statusModel(null, null).empty).toBe(false);
    expect(statusModel(snapshot(), crew([], 0, "uninstalled")).crew).toBeNull();
  });

  test("the VPS is the sidebar's connection, from the same snapshot", () => {
    const s = snapshot({ readers: [reader("hostinger")] });
    expect(statusModel(s, null).vps).toEqual({ name: "Hostinger VPS", state: "connected", detail: "as of 13:51" });
    const machine = { name: "vps-1", state: "unreachable" as const, word: "unreachable", detail: "vps-1 · unreachable since 14:02" };
    expect(statusModel(s, null, null, machine).vps).toEqual(machine);
    expect(statusModel(null, null, null, machine).vps).toEqual(machine);
  });
});

describe("crew totals", () => {
  test("the sidebar's three words over every task in flight; finished work is left out", () => {
    const c = crew([task("a", "working"), task("b", "queued"), task("c", "failed"), task("d", "CI red"), task("e", "needs decision"), task("r", "ready"), task("f", "failed", true), task("g", "done", true)], 1);
    expect(crewTotals(c)).toEqual({ needsYou: 2, failed: 2, working: 2 });
    expect(crewWords({ needsYou: 1, failed: 0, working: 2 }).map((w) => w.text)).toEqual(["1 needs you", "2 working"]);
    expect(crewWords({ needsYou: 0, failed: 0, working: 0 })).toEqual([]);
  });
});

describe("popoverBlocks (rule 25)", () => {
  test("a block per configured provider, one as-of each, a window per quota with its reset", () => {
    const blocks = popoverBlocks(snapshot());
    expect(blocks.map((b) => [b.provider, b.asOf, b.windows.map((w) => w.label)])).toEqual([
      ["Claude", "as of 13:50", ["week", "session"]],
      ["Ollama", "as of 13:50", ["session", "week"]],
    ]);
    expect(blocks[0]!.windows[1]).toEqual({ key: "claude-plan/session", label: "session", used: 97, tone: "danger", usedText: "97% used", reset: "resets in 1 h 59 m", resetTitle: "resets Mon 14 Sep, 15:51" });
    expect(new Set(blocks.map((b) => b.cat)).size).toBe(blocks.length);
  });

  test("Convex's metrics with an allowance are windows; one without is left out; the VPS never is a block", () => {
    const s = snapshot({ quotas: [], provider_metrics: [metric("functionCalls", 12), metric("databaseIoGb", 81), metric("aiGatewayCost", null)], readers: [reader("hostinger"), reader("convex")] });
    const blocks = popoverBlocks(s);
    expect(blocks.map((b) => b.provider)).toEqual(["Convex"]);
    expect(blocks[0]!.windows.map((w) => [w.key, w.usedText, w.tone])).toEqual([
      ["convex/functionCalls", "12% used", "meter"],
      ["convex/databaseIoGb", "81% used", "warn"],
    ]);
  });

  test("a dead reading says so and draws no bar; nothing configured is no block", () => {
    const blocks = popoverBlocks(snapshot({ quotas: [quota("claude-plan", "week", 30, { state: "dead" })] }));
    expect(blocks[0]!.windows[0]).toMatchObject({ used: null, usedText: "No reading", reset: "" });
    expect(popoverBlocks(snapshot({ quotas: [] }))).toEqual([]);
  });
});
