import { describe, expect, test } from "bun:test";
import type { ProviderMetricView } from "../api.ts";
import { DETAIL, forWindow, GAUGED, metricLabel, metricValue, windowLabel } from "./convex.ts";

const row = (metric: string, window: string, used: number, unit: string | null = "calls"): ProviderMetricView => ({
  provider: "convex",
  metric,
  window,
  used,
  limit_value: null,
  unit,
  used_pct: null,
  left_pct: null,
  source: "convex.cloud/api/v1/get_current_usage",
  updated_at: 1,
  state: "fresh",
});

describe("what is gauged and what is only a figure", () => {
  test("the three action-compute parts are figures, not gauges", () => {
    // Their plan allowance covers them together, so only the R7 sum is gauged. Gauging a part against the
    // whole allowance would read as far more headroom than there is.
    for (const part of ["actionComputeConvexGbHours", "actionComputeNodeJsGbHours", "actionComputeCpuGbHours"]) {
      expect(GAUGED).not.toContain(part);
      expect(DETAIL).toContain(part);
    }
    expect(GAUGED).toContain("actionCompute");
  });

  test("query and mutation compute is metered separately, so it is never part of the gauged sum", () => {
    expect(GAUGED).not.toContain("queryMutationComputeGbHours");
    expect(DETAIL).toContain("queryMutationComputeGbHours");
  });

  test("a cost has no allowance, so it is never gauged (R8)", () => {
    expect(GAUGED).not.toContain("aiGatewayCostDollars");
    expect(DETAIL).toContain("aiGatewayCostDollars");
  });

  test("every gauged metric is one the limits table can price", () => {
    // Mirrors readers/convex/limits.rs. If a metric is added to one list and not the other, a gauge appears
    // with no denominator, which is exactly what R8 forbids.
    expect([...GAUGED]).toEqual(["functionCalls", "databaseIoGb", "dataEgressGb", "searchQueryGb", "actionCompute"]);
  });
});

describe("labels", () => {
  test("a day window says UTC, because it is not Lisbon", () => {
    // R4: the windows are calendar-aligned UTC. Left unlabelled, "today" would read as the chart's Lisbon day.
    expect(windowLabel("day")).toBe("today (UTC)");
    expect(windowLabel("month")).toBe("this month (UTC)");
  });

  test("an unknown metric reads oddly rather than crashing", () => {
    expect(metricLabel("functionCalls")).toBe("Function calls");
    expect(metricLabel("newDimensionGb")).toBe("newDimensionGb");
  });
});

describe("values carry the unit the API reported", () => {
  test("money is money", () => {
    expect(metricValue(4.2, "USD")).toBe("$4.20");
    expect(metricValue(0, "USD")).toBe("$0.00");
  });

  test("large counts are grouped, small ones keep two decimals", () => {
    expect(metricValue(250_000, "calls")).toBe("250,000 calls");
    expect(metricValue(0.25, "GB")).toBe("0.25 GB");
    expect(metricValue(6, "GB-hours")).toBe("6 GB-hours");
  });

  test("a missing unit is not invented", () => {
    expect(metricValue(12, null)).toBe("12");
  });
});

describe("selecting a window's rows", () => {
  test("keeps the page's order and ignores other providers and windows", () => {
    const metrics = [
      row("searchQueryGb", "month", 150),
      { ...row("functionCalls", "month", 250_000), provider: "hostinger" as unknown as "convex" },
      row("functionCalls", "month", 250_000),
      row("functionCalls", "day", 12_000),
    ];
    const rows = forWindow(metrics, "month", GAUGED);
    // functionCalls before searchQueryGb, per GAUGED; the day row and the other provider are excluded.
    expect(rows.map((r) => r.metric)).toEqual(["functionCalls", "searchQueryGb"]);
    expect(rows.every((r) => r.window === "month" && r.provider === "convex")).toBe(true);
  });

  test("a metric outside the requested list is left out rather than shown unordered", () => {
    const rows = forWindow([row("aiGatewayCostDollars", "month", 4.2, "USD")], "month", GAUGED);
    expect(rows).toEqual([]);
    expect(forWindow([row("aiGatewayCostDollars", "month", 4.2, "USD")], "month", DETAIL)).toHaveLength(1);
  });
});
