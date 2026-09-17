// Text and grouping for the Convex section of the Usage page (prd-convex-usage.md R4, R6, R7, R8, R15).
// Pure: no DOM and no Tauri, so bun tests cover it.
//
// The split below is the whole point. Five metrics have a published plan allowance and so can be gauged; the
// rest are figures. A gauge needs a denominator, and inventing one would be a lie with a progress bar on it (R8).

import type { ProviderMetricView } from "../api.ts";

/** The metrics with a plan allowance, in the order the page shows them. Keyed as stored in `provider_metrics`. */
export const GAUGED = ["functionCalls", "databaseIoGb", "dataEgressGb", "searchQueryGb", "actionCompute"] as const;

/**
 * The metrics shown as plain figures under the gauges.
 *
 * The three `actionCompute*` parts are here rather than gauged because the plan's single allowance covers them
 * together (R7) — they are listed so a spike can be attributed to one of them. `queryMutationComputeGbHours` is
 * metered separately and is **not** part of that sum. `aiGatewayCostDollars` has no allowance at all (R8).
 */
export const DETAIL = [
  "queryMutationComputeGbHours",
  "actionComputeConvexGbHours",
  "actionComputeNodeJsGbHours",
  "actionComputeCpuGbHours",
  "aiGatewayCostDollars",
] as const;

export const METRIC_LABEL: Record<string, string> = {
  functionCalls: "Function calls",
  databaseIoGb: "Database I/O",
  dataEgressGb: "Data egress",
  searchQueryGb: "Search queries",
  actionCompute: "Action compute",
  queryMutationComputeGbHours: "Query & mutation compute",
  actionComputeConvexGbHours: "Action compute · Convex",
  actionComputeNodeJsGbHours: "Action compute · Node.js",
  actionComputeCpuGbHours: "Action compute · CPU",
  aiGatewayCostDollars: "AI gateway",
};

/** A metric name for display, falling back to the raw key: a new beta dimension should read oddly, not crash. */
export function metricLabel(metric: string): string {
  return METRIC_LABEL[metric] ?? metric;
}

/**
 * A stored value with its unit, as the API reported it.
 *
 * The unit is never assumed: it comes from the response, because a mismatch with the pricing page's units would
 * silently skew a percentage (PRD §7 Q3). A dollar figure is written as money because "4.2 USD" reads wrongly.
 */
export function metricValue(used: number, unit: string | null): string {
  if (unit === "USD") return `$${used.toFixed(2)}`;
  const n = used >= 1000 ? Math.round(used).toLocaleString("en-GB") : Math.round(used * 100) / 100;
  return unit ? `${n} ${unit}` : String(n);
}

/**
 * The window's label. `day` is calendar-aligned **UTC**, which is not Europe/Lisbon — so it says so, rather than
 * letting Miguel read it as lining up with the chart's Lisbon days (R4).
 */
export function windowLabel(window: string): string {
  return window === "day" ? "today (UTC)" : window === "month" ? "this month (UTC)" : window;
}

/** The Convex rows for one window, in the page's order; anything unknown is appended rather than dropped. */
export function forWindow(metrics: ProviderMetricView[], window: string, order: readonly string[]): ProviderMetricView[] {
  const rows = metrics.filter((m) => m.provider === "convex" && m.window === window);
  const rank = (metric: string) => {
    const i = order.indexOf(metric);
    return i === -1 ? order.length : i;
  };
  return rows.filter((m) => order.includes(m.metric)).sort((a, b) => rank(a.metric) - rank(b.metric));
}

/**
 * What this API cannot report at all (R15), said once under the gauges with a link.
 *
 * Storage, file storage, search storage, backup storage and seat counts exist only in Convex's web dashboard.
 * No placeholder gauges: a gauge with no data behind it is worse than a sentence admitting the gap.
 */
export const NOT_AVAILABLE = "Storage, file storage, search storage, backups and seats are not in this API — only in the Convex dashboard.";
