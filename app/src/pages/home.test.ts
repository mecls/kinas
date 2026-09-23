import { describe, expect, test } from "bun:test";
import type { HostView, ProviderMetricView, QuotaView, ReaderView, UsageSnapshot } from "../api.ts";
import { attention, heroSlots } from "./home.ts";

const NOW = 1_789_390_320_000;

const quota = (subscription: QuotaView["subscription"], window: QuotaView["window"], used_pct: number, extra: Partial<QuotaView> = {}): QuotaView => ({
  subscription,
  window,
  used_pct,
  left_pct: 100 - used_pct,
  resets_at: NOW + 3_600_000,
  plan: null,
  source: "test",
  updated_at: NOW - 60_000,
  state: "fresh",
  models: [],
  ...extra,
});

const metric = (provider: ProviderMetricView["provider"], name: string, used_pct: number | null, extra: Partial<ProviderMetricView> = {}): ProviderMetricView => ({
  provider,
  metric: name,
  window: "month",
  used: 1,
  limit_value: used_pct === null ? null : 1,
  unit: null,
  used_pct,
  left_pct: used_pct === null ? null : 100 - used_pct,
  detail: null,
  source: "test",
  updated_at: NOW - 60_000,
  state: "fresh",
  ...extra,
});

const reader = (id: ReaderView["reader"], state: ReaderView["state"] = "ok", last_error: string | null = null): ReaderView => ({
  reader: id,
  state,
  last_attempt_at: NOW,
  last_success_at: NOW,
  last_error,
  stale_after_ms: 600_000,
  dead_after_ms: 3_600_000,
});

const host = (extra: Partial<HostView> = {}): HostView => ({
  machine: "mac",
  cpu_pct: 10,
  mem_used_gb: 4,
  mem_total_gb: 16,
  disk_used_gb: 100,
  disk_total_gb: 500,
  disk_available_gb: 400,
  updated_at: NOW - 60_000,
  state: "fresh",
  ...extra,
});

const snapshot = (extra: Partial<UsageSnapshot> = {}): UsageSnapshot =>
  ({
    now: NOW,
    quotas: [quota("claude-plan", "week", 24), quota("claude-plan", "session", 42), quota("ollama-cloud", "session", 2.5), quota("ollama-cloud", "week", 34)],
    provider_metrics: [],
    readers: [reader("claude-plan"), reader("ollama-cloud"), reader("host"), reader("convex", "not_configured"), reader("hostinger", "not_configured")],
    host: host(),
    usage: [],
    first_usage_date: null,
    days: [],
    backfill: { done: 0, total: 0, running: false },
    claude_hook: {} as UsageSnapshot["claude_hook"],
    ...extra,
  }) as UsageSnapshot;

const summary = (s: UsageSnapshot) => attention(s).map((r) => [r.label, r.tone, `${r.value} ${r.unit}`.trim()]);

describe("attention (DESIGN.md §5 Home: anything in --warn, --danger or stale)", () => {
  test("everything within limits: nothing, and providers that were never set up are not a problem", () => {
    expect(attention(snapshot())).toEqual([]);
  });

  test("a quota at 97 % is one danger row; 80 % is warn; 79 % is nothing; danger comes first", () => {
    const s = snapshot({ quotas: [quota("claude-plan", "week", 80), quota("claude-plan", "session", 97), quota("ollama-cloud", "session", 79)] });
    expect(summary(s)).toEqual([
      ["Claude · session", "danger", "97% used"],
      ["Claude · week", "warn", "80% used"],
    ]);
  });

  test("a stale reading is listed whatever its number; a reset window is not", () => {
    const s = snapshot({ quotas: [quota("claude-plan", "session", 12, { state: "stale" }), quota("claude-plan", "week", 99, { state: "reset" }), quota("ollama-cloud", "session", 1)] });
    expect(summary(s)).toEqual([["Claude · session", "stale", "12% used · stale"]]);
  });

  test("no readings at all: each hero provider as a dead row, with the reader's reason when it gave one", () => {
    const s = snapshot({ quotas: [], readers: [reader("claude-plan", "not_configured"), reader("ollama-cloud", "error", "rate limited (HTTP 429)"), reader("host")] });
    expect(summary(s)).toEqual([
      ["Claude", "meter", "— no reading"],
      ["Ollama", "meter", "— rate limited (HTTP 429)"],
    ]);
  });

  test("Convex past its allowance is danger and says upper bound; a reader in error says why once", () => {
    const s = snapshot({
      provider_metrics: [metric("convex", "functionCalls", 312), metric("convex", "databaseIoGb", 20), metric("convex", "aiGatewayCostDollars", null)],
      readers: [reader("claude-plan"), reader("ollama-cloud"), reader("host"), reader("convex", "error", "deploy key rejected"), reader("hostinger", "not_configured")],
    });
    expect(summary(s)).toEqual([
      ["Convex · Function calls", "danger", "312% used · upper bound"],
      ["Convex", "meter", "— deploy key rejected"],
    ]);
  });

  test("this Mac: memory or disk past 80 % used, or a dead sample", () => {
    expect(summary(snapshot({ host: host({ disk_used_gb: 470, disk_total_gb: 500 }) }))).toEqual([["This Mac · disk", "warn", "94% used"]]);
    expect(summary(snapshot({ host: host({ state: "dead" }) }))).toEqual([["This Mac", "meter", "— no recent reading"]]);
  });
});

describe("heroSlots", () => {
  test("Claude week, Claude session, then Ollama's first window; a missing one is null in its place", () => {
    const slots = heroSlots(snapshot());
    expect(slots.map((s) => (s.quota ? `${s.quota.subscription}/${s.quota.window}` : null))).toEqual(["claude-plan/week", "claude-plan/session", "ollama-cloud/session"]);
    const none = heroSlots(snapshot({ quotas: [] }));
    expect(none.map((s) => [s.subscription, s.window, s.quota])).toEqual([
      ["claude-plan", "week", null],
      ["claude-plan", "session", null],
      ["ollama-cloud", "session", null],
    ]);
  });
});
