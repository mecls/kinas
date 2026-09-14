// The model behind the 30-day usage chart (R26, R38), kept pure so it is tested without a DOM.
//
// Series are harness·model. Colour follows the series name, never its rank (dataviz): kept series take
// categorical slots in alphabetical order, and past 8 series the smallest fold into "Other" so no ninth
// hue is ever generated.

import type { UsageDay, UsageSnapshot } from "../api.ts";

export const MAX_SERIES = 8;
export const OTHER = "Other";

export interface Series {
  key: string;
  label: string;
  /** 1..8, the categorical slot (CSS var --series-N). */
  slot: number;
  total: number;
}

export interface Segment {
  key: string;
  value: number;
}

export interface DayStack {
  date: string;
  /** Before the first ingested line: rendered hatched, never as zero (R26). */
  noData: boolean;
  total: number;
  /** Bottom to top, in series order; zero-value series are omitted. */
  segments: Segment[];
}

export interface ChartModel {
  series: Series[];
  days: DayStack[];
  ticks: number[];
}

export const seriesKey = (row: Pick<UsageDay, "harness" | "model">) => `${row.harness} · ${row.model}`;

export function rowValue(row: UsageDay, includeCache: boolean): number {
  return row.tokens_in + row.tokens_out + (includeCache ? row.tokens_cache_read : 0);
}

/** Clean ticks from 0 to at least `max`: steps of 1, 2 or 5 × 10^n, about four intervals. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * magnitude >= raw) ?? 10) * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

export function buildChart(snapshot: Pick<UsageSnapshot, "usage" | "days" | "first_usage_date">, includeCache: boolean): ChartModel {
  // Membership and colours depend on names and all-token totals, not on the cache toggle, so toggling
  // never repaints a series.
  const totals = new Map<string, number>();
  for (const row of snapshot.usage) {
    totals.set(seriesKey(row), (totals.get(seriesKey(row)) ?? 0) + rowValue(row, true));
  }
  const byTotal = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const fold = byTotal.length > MAX_SERIES;
  const kept = new Set((fold ? byTotal.slice(0, MAX_SERIES - 1) : byTotal).map(([k]) => k));
  const keyFor = (row: UsageDay) => (kept.has(seriesKey(row)) ? seriesKey(row) : OTHER);

  const names = [...kept].sort((a, b) => a.localeCompare(b));
  if (fold) names.push(OTHER);

  const perDay = new Map<string, Map<string, number>>();
  const shown = new Map<string, number>();
  for (const row of snapshot.usage) {
    const key = keyFor(row);
    const value = rowValue(row, includeCache);
    const day = perDay.get(row.date) ?? new Map<string, number>();
    day.set(key, (day.get(key) ?? 0) + value);
    perDay.set(row.date, day);
    shown.set(key, (shown.get(key) ?? 0) + value);
  }

  const series: Series[] = names.map((key, i) => ({ key, label: key, slot: i + 1, total: shown.get(key) ?? 0 }));
  const first = snapshot.first_usage_date;
  const days: DayStack[] = snapshot.days.map((date) => {
    const values = perDay.get(date);
    const segments = series.map((s) => ({ key: s.key, value: values?.get(s.key) ?? 0 })).filter((s) => s.value > 0);
    return {
      date,
      noData: first === null || date < first,
      total: segments.reduce((sum, s) => sum + s.value, 0),
      segments,
    };
  });

  return { series, days, ticks: niceTicks(Math.max(0, ...days.map((d) => d.total))) };
}
