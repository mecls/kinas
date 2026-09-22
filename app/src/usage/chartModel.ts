// The model behind the 30-day usage chart (R26, R38), kept pure so it is tested without a DOM.
//
// Series are providers (DESIGN.md §5 Usage, 2026-09-22): the bars are coloured by the provider's category and the
// legend lists providers only; the models behind each day are kept for the tooltip and the tables. Colour follows
// the provider's name, never its rank (dataviz): `providerSlot` seats every provider on one of the six --cat-N the
// way client folders are seated, so a provider keeps its colour whatever else is charted.

import type { UsageDay, UsageSnapshot } from "../api.ts";
import { categoriesFor } from "../ui/category.ts";
import type { Category } from "../ui/Dot.tsx";

export interface Series {
  key: string;
  label: string;
  /** 1..6, the provider's category (CSS var --cat-N). */
  slot: Category;
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
  /** The day's harness · model figures, largest first, for the tooltip. */
  models: Segment[];
}

export interface ChartModel {
  series: Series[];
  days: DayStack[];
  ticks: number[];
}

/** How a provider is named on screen; an unknown one reads as stored rather than being hidden. */
const PROVIDER_NAME: Record<string, string> = { anthropic: "Anthropic", ollama: "Ollama" };

export const providerLabel = (provider: string) => PROVIDER_NAME[provider] ?? provider;

export const modelKey = (row: Pick<UsageDay, "harness" | "model">) => `${row.harness} · ${row.model}`;

/** A provider's colour among the providers charted: its name's own category, the next free one on a collision. */
export function providerSlot(provider: string, providers: readonly string[]): Category {
  const names = [...new Set([...providers, provider])].sort((a, b) => a.localeCompare(b));
  return categoriesFor(names, {})[provider]!;
}

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

const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);
const largestFirst = (map: Map<string, number> | undefined): Segment[] =>
  [...(map ?? new Map<string, number>())]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ key, value }));

export function buildChart(snapshot: Pick<UsageSnapshot, "usage" | "days" | "first_usage_date">, includeCache: boolean): ChartModel {
  // Membership and colours depend on names alone, not on the cache toggle, so toggling never repaints a series.
  const providers = [...new Set(snapshot.usage.map((r) => r.provider))].sort((a, b) => a.localeCompare(b));
  const slots = categoriesFor(providers, {});

  const perDay = new Map<string, Map<string, number>>();
  const modelsPerDay = new Map<string, Map<string, number>>();
  const shown = new Map<string, number>();
  for (const row of snapshot.usage) {
    const value = rowValue(row, includeCache);
    const day = perDay.get(row.date) ?? new Map<string, number>();
    add(day, row.provider, value);
    perDay.set(row.date, day);
    const models = modelsPerDay.get(row.date) ?? new Map<string, number>();
    add(models, modelKey(row), value);
    modelsPerDay.set(row.date, models);
    add(shown, row.provider, value);
  }

  const series: Series[] = providers.map((key) => ({ key, label: providerLabel(key), slot: slots[key]!, total: shown.get(key) ?? 0 }));
  const first = snapshot.first_usage_date;
  const days: DayStack[] = snapshot.days.map((date) => {
    const values = perDay.get(date);
    const segments = series.map((s) => ({ key: s.key, value: values?.get(s.key) ?? 0 })).filter((s) => s.value > 0);
    return {
      date,
      noData: first === null || date < first,
      total: segments.reduce((sum, s) => sum + s.value, 0),
      segments,
      models: largestFirst(modelsPerDay.get(date)),
    };
  });

  return { series, days, ticks: niceTicks(Math.max(0, ...days.map((d) => d.total))) };
}

export interface PeriodRow {
  key: string;
  tokens_in: number;
  tokens_cache_read: number;
  tokens_out: number;
  messages: number;
}

/**
 * The "Today" and "Month to date" tables (DESIGN.md §5 Usage): per harness · model, busiest first. Today is the
 * last charted day and the month is that day's calendar month, both Europe/Lisbon like the chart's days.
 */
export function periodRows(snapshot: Pick<UsageSnapshot, "usage" | "days">, period: "today" | "month"): PeriodRow[] {
  const today = snapshot.days.at(-1);
  if (!today) return [];
  const inPeriod = period === "today" ? (date: string) => date === today : (date: string) => date.slice(0, 7) === today.slice(0, 7) && date <= today;
  const rows = new Map<string, PeriodRow>();
  for (const r of snapshot.usage) {
    if (!inPeriod(r.date)) continue;
    const key = modelKey(r);
    const sum = rows.get(key) ?? { key, tokens_in: 0, tokens_cache_read: 0, tokens_out: 0, messages: 0 };
    sum.tokens_in += r.tokens_in;
    sum.tokens_cache_read += r.tokens_cache_read;
    sum.tokens_out += r.tokens_out;
    sum.messages += r.messages;
    rows.set(key, sum);
  }
  const volume = (r: PeriodRow) => r.tokens_in + r.tokens_cache_read + r.tokens_out;
  return [...rows.values()].sort((a, b) => volume(b) - volume(a) || a.key.localeCompare(b.key));
}
