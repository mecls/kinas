import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrewSnapshot, CrewTask, ProviderMetricView, ReaderView, UsageSnapshot } from "../api.ts";
import { HomePage } from "./Home.tsx";
import { UsagePage } from "./Usage.tsx";

// What the Usage page and Home's Usage section say when a read fails (ADR 0004): once, in the pages' one wording, and
// never "showing the last reading" over nothing.

const NOW = 1_789_390_320_000;

const reader = (id: ReaderView["reader"], state: ReaderView["state"] = "ok", last_error: string | null = null): ReaderView => ({
  reader: id,
  state,
  last_attempt_at: NOW,
  last_success_at: state === "error" ? null : NOW,
  last_error,
  stale_after_ms: 600_000,
  dead_after_ms: 3_600_000,
});

const snapshot = (extra: Partial<UsageSnapshot> = {}): UsageSnapshot =>
  ({
    now: NOW,
    quotas: [],
    provider_metrics: [],
    readers: [reader("claude-plan"), reader("ollama-cloud"), reader("host"), reader("convex", "not_configured"), reader("hostinger", "not_configured")],
    host: null,
    usage: [],
    first_usage_date: null,
    days: [],
    backfill: { done: 0, total: 0, running: false },
    claude_hook: {} as UsageSnapshot["claude_hook"],
    ...extra,
  }) as UsageSnapshot;

const usage = (props: { snapshot: UsageSnapshot | null; error: string | null; crew?: CrewSnapshot | null; crewError?: string | null }) =>
  renderToStaticMarkup(createElement(UsagePage, props));

const count = (html: string, text: string) => html.split(text).length - 1;

describe("the Hostinger section", () => {
  const ram: ProviderMetricView = {
    provider: "hostinger",
    metric: "ram",
    window: "now",
    used: 554_176_512,
    limit_value: null,
    unit: "bytes",
    used_pct: null,
    left_pct: null,
    detail: "srv-9c2e · KVM 4 · running",
    source: "test",
    updated_at: NOW - 60_000,
    state: "fresh",
  };

  test("a first poll that failed says why once, and claims no last reading", () => {
    const html = usage({ snapshot: snapshot({ readers: [reader("hostinger", "error", "api token rejected")] }), error: null });
    expect(count(html, "api token rejected")).toBe(1);
    expect(html.includes("Hostinger: api token rejected · showing the last reading")).toBe(false);
  });

  test("a stale month of traffic says so where it is, as the machine's other rows do (DESIGN.md §1, rule 4)", () => {
    const bandwidth: ProviderMetricView = { ...ram, metric: "bandwidth", window: "month", used: 4 * 1024 ** 4, unit: "bytes", state: "stale" };
    const html = usage({ snapshot: snapshot({ provider_metrics: [{ ...ram, state: "stale" }, bandwidth], readers: [reader("hostinger")] }), error: null });
    const rows = /<div class="ui-metric-row"[^>]*data-metric="([^"]+)"[^>]*>([\s\S]*?)<\/span><\/span><\/div>/g;
    const text = (metric: string) => [...html.matchAll(rows)].find((m) => m[1] === metric)?.[2]?.replace(/<[^>]+>/g, "") ?? "";
    expect(text("ram")).toContain("stale");
    expect(text("bandwidth")).toContain("calendar month to date (UTC) · stale");
    // Positive control: a fresh month says only its window.
    const fresh = usage({ snapshot: snapshot({ provider_metrics: [ram, { ...bandwidth, state: "fresh" }], readers: [reader("hostinger")] }), error: null });
    expect(fresh).toContain("calendar month to date (UTC)");
    expect(fresh.includes("stale")).toBe(false);
  });

  test("a failed poll over a good reading keeps the rows and says so beside them", () => {
    const html = usage({ snapshot: snapshot({ provider_metrics: [ram], readers: [reader("hostinger", "error", "api token rejected")] }), error: null });
    expect(html).toContain("Hostinger: api token rejected · showing the last reading");
    expect(html).toContain('data-metric="ram"');
  });
});

describe("a snapshot never read", () => {
  test("says what could not be read, as every page does, and not the bare reason", () => {
    expect(usage({ snapshot: null, error: "database is locked" })).toContain("Could not read the readings: database is locked<");
    expect(usage({ snapshot: null, error: null })).toContain("Reading…");
    const home = renderToStaticMarkup(
      createElement(HomePage, { usage: null, usageError: "database is locked", projects: [], folder: null, onOpen: () => {}, onGo: () => {}, onLaunch: () => {} }),
    );
    expect(home).toContain("Could not read the readings: database is locked<");
  });

  test("Settings says it the same way before its first good read", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    expect(readFileSync(join(import.meta.dir, "Settings.tsx"), "utf8")).toMatch(/failedRead\("settings", loadError, false\) \?\? "Reading settings…"/);
  });
});

describe("the Crew section on Usage", () => {
  const task = (id: string): CrewTask => ({
    id,
    title: null,
    repo: null,
    project_name: "p-9c2e",
    kind: "ship",
    word: "working",
    overnight_word: "working",
    harness: "claude",
    first_seen_at: NOW,
    first_working_at: NOW,
    done_at: null,
    gone_at: null,
    last_event_at: null,
    last_event_text: null,
    pr: null,
    has_pane: false,
    finished: false,
    board_seen_at: null,
    overnight_seen_at: null,
    dispatched_at: null,
    merged_at: null,
    merged_via: null,
    review: null,
  });
  const crew = { now: NOW, generated: new Date(NOW).toISOString(), reader: reader("crew"), page: "running", blocked: null, tasks: [task("a-9c2e")], decisions: [], reconcile: [], waiting: 0, overnight_since: NOW, crew_repos: [] } as CrewSnapshot;

  test("a crew reading that failed after a good one is said beside the last one, as Crew, Inbox and Home say it", () => {
    const html = usage({ snapshot: snapshot(), error: null, crew, crewError: "could not read the crew: database is locked" });
    expect(html).toContain("Crew: could not read the crew: database is locked · showing the last reading");
    expect(html).toContain('data-metric="crew-claude"');
    expect(usage({ snapshot: snapshot(), error: null, crew, crewError: null }).includes("showing the last reading")).toBe(false);
  });

  test("App hands the Usage page the crew's failure", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    expect(readFileSync(join(import.meta.dir, "..", "App.tsx"), "utf8")).toMatch(/<UsagePage [^>]*crewError=\{crewError\}/);
  });
});
