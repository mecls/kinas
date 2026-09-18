// Text and grouping for the Hostinger section of the Usage page (prd-hostinger-usage.md R9, R11, R12, R18).
// Pure: no DOM and no Tauri, so bun tests cover it.
//
// The split here is not the Convex one. Convex asks "does this metric have a published allowance?"; Hostinger
// asks "is this a quota, or is it the state of a running machine?" CPU, RAM and disk all *have* denominators —
// the API reports them — but they are live readings that move every minute, and a progress bar on one reads as
// a quota being consumed. Only monthly bandwidth is a quota that resets, so only bandwidth can be a gauge (R11).

import type { ProviderMetricView } from "../api.ts";

/** The tile's metrics, in the order it shows them. Keyed as stored in `provider_metrics`. */
export const TILE = ["cpu", "ram", "disk", "uptime"] as const;

/**
 * The only metric that could ever be a gauge here.
 *
 * "Could" is doing real work: the bar appears only when the reader stored a `limit_value`, and today it does
 * not — whether a traffic sample is an interval delta or a cumulative counter is unanswered (PRD §7 Q1), so
 * bandwidth ships as a figure until a probe settles it. `MetricGauge` already renders a NULL limit as a plain
 * number, so nothing here needs a branch for that.
 */
export const GAUGED = ["bandwidth"] as const;

export const METRIC_LABEL: Record<string, string> = {
  cpu: "CPU",
  ram: "RAM",
  disk: "Disk",
  uptime: "Uptime",
  bandwidth: "Bandwidth",
};

/** A metric name for display, falling back to the raw key: a new dimension should read oddly, not crash. */
export function metricLabel(metric: string): string {
  return METRIC_LABEL[metric] ?? metric;
}

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const TIB = GIB * 1024;

/**
 * A byte count in the largest unit that keeps it readable, always 1024-based.
 *
 * Binary units throughout, deliberately: the API's allowances are MiB (`memory: 8192` for an 8 GB box), so
 * showing usage in decimal GB beside a binary denominator would make the pair not add up on screen. This is the
 * display half of the same trap R7 guards in the reader.
 */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= TIB) return `${(n / TIB).toFixed(2)} TiB`;
  if (n >= GIB) return `${(n / GIB).toFixed(1)} GiB`;
  if (n >= MIB) return `${Math.round(n / MIB)} MiB`;
  if (n >= KIB) return `${Math.round(n / KIB)} KiB`;
  return `${Math.round(n)} B`;
}

/** Uptime in milliseconds as days and hours; under a day, hours and minutes. */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} d ${hours % 24} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} m`;
  return `${minutes} m`;
}

/**
 * A stored value with the unit the API reported.
 *
 * The unit comes from the response and is never assumed: `ram_usage` and `disk_space` are bytes while `cpu_usage`
 * is a percentage and `uptime` is milliseconds, and treating one as another is the error that would silently
 * show 554 MiB of memory as 554 million percent.
 */
export function metricValue(used: number, unit: string | null): string {
  if (unit === "bytes") return bytes(used);
  if (unit === "ms") return duration(used);
  if (unit === "%") return `${Math.round(used)}%`;
  return unit ? `${Math.round(used * 100) / 100} ${unit}` : String(Math.round(used * 100) / 100);
}

/** `used of limit` for the tile's second line, when the API gave a denominator. */
export function ofLimit(m: ProviderMetricView): string | null {
  if (m.limit_value === null) return null;
  return `of ${metricValue(m.limit_value, m.unit)}`;
}

/**
 * The window's label. `now` is a live reading; `month` is the **calendar** month, which may not be the window
 * the allowance resets on (R12).
 */
export function windowLabel(window: string): string {
  return window === "month" ? "calendar month to date (UTC)" : window === "now" ? "now" : window;
}

/**
 * Why a bandwidth percentage would be an upper bound, said on screen (R12).
 *
 * `bandwidth` is documented as "monthly internet traffic available" with no reset date in the payload, while the
 * figure above it is the UTC calendar month to date. If the allowance actually resets on the subscription's
 * anniversary the two windows differ — the same shape as Convex's billing-period problem, and the same answer:
 * label it honestly rather than imply a precision the API cannot give.
 */
export const BILLING_WINDOW =
  "Traffic is counted over the calendar month (UTC). Hostinger does not report when the monthly allowance resets, so if it resets on your subscription date rather than the 1st, this figure covers a different window than the allowance does.";

/** What this API cannot report at all (R18), said once under the tile. */
export const NOT_AVAILABLE = "Snapshots, backups, firewall rules and Docker containers are not shown here — this is resource usage only.";

/** The Hostinger rows for one window, in the page's order; anything outside the list is left out. */
export function forWindow(metrics: ProviderMetricView[], window: string, order: readonly string[]): ProviderMetricView[] {
  // Deliberately a sibling of `convex.ts`'s function rather than a shared generic: each provider's module owns
  // its own ordering and provider id, which is what lets one change without touching the other.
  const rank = (metric: string) => {
    const i = order.indexOf(metric);
    return i === -1 ? order.length : i;
  };
  return metrics
    .filter((m) => m.provider === "hostinger" && m.window === window && order.includes(m.metric))
    .sort((a, b) => rank(a.metric) - rank(b.metric));
}
