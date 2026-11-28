// The factory's weeks (build spec §11.2 `packages/factory`; PRD rules 18–21): each figure is counted from recorded events,
// never estimated, and a figure with fewer than three tasks behind it is `null` with its `n`. Pure: the Mac's page, the
// phone's tab and the companion all count with this one file.

/** What the factory records (build spec §7). `tokens` is a task's model tokens for one day, in `value`. */
export type EventName = "dispatched" | "pr_ready" | "merged" | "cleaned_up" | "held" | "answered" | "hold_closed" | "red" | "tokens";

export interface FactoryEvent {
  task: string;
  project: string;
  event: EventName;
  /** Milliseconds since the epoch. */
  at: number;
  value?: number;
}

/** A figure and the number of tasks (or questions) behind it; `value` is null under three. */
export interface Figure {
  value: number | null;
  n: number;
}

interface Figures {
  merged: number;
  cycle: { median: Figure; p90: Figure };
  waiting: { median: Figure; longest: Figure; questions: number };
  neededYou: Figure;
  wentRed: Figure;
  away: Figure;
  tokensPerTask: Figure;
}

export interface Week extends Figures {
  start: number;
  end: number;
  mergedPrev: number;
  /** The weekly window's highest reading in the week, in percent; null without a reading. */
  planPeak: number | null;
  byProject: (Figures & { project: string })[];
}

export const MIN_N = 3;
export const ZONE = "Europe/Lisbon";
const DAY_MS = 86_400_000;

const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });

function lisbon(at: number): { y: number; m: number; d: number; hour: number; minute: number; weekday: number } {
  const p: Record<string, string> = {};
  for (const x of parts.formatToParts(at)) p[x.type] = x.value;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday!);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), weekday };
}

/** Lisbon's offset from UTC at an instant, in milliseconds. */
function offsetAt(at: number): number {
  const l = lisbon(at);
  const asUtc = Date.UTC(l.y, l.m - 1, l.d, l.hour, l.minute, new Date(at).getUTCSeconds());
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant a Lisbon calendar day begins at 00:00. */
function midnight(y: number, m: number, d: number): number {
  const utc = Date.UTC(y, m - 1, d);
  return utc - offsetAt(utc - offsetAt(utc));
}

/** Monday 00:00 Lisbon time of the week an instant falls in. */
export function weekStart(at: number): number {
  const l = lisbon(at);
  const back = new Date(Date.UTC(l.y, l.m - 1, l.d - l.weekday));
  return midnight(back.getUTCFullYear(), back.getUTCMonth() + 1, back.getUTCDate());
}

/** The Monday 00:00 after a week's start: 167, 168 or 169 hours on, by the clocks. */
function weekEnd(start: number): number {
  return weekStart(start + 7 * DAY_MS + 12 * 3_600_000);
}

/** 09:00 up to, not including, 21:00 Lisbon time: when the captain can be expected to answer. */
export function inDay(at: number): boolean {
  const { hour } = lisbon(at);
  return hour >= 9 && hour < 21;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The 90th percentile by nearest rank: the value at ceil(0.9 · n) of the sorted values. */
export function p90(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.ceil(0.9 * s.length) - 1]!;
}

const figure = (n: number, value: number | null): Figure => ({ value: n >= MIN_N ? value : null, n });
const share = (hits: number, of: number): Figure => figure(of, of === 0 ? null : hits / of);

interface Hold {
  task: string;
  project: string;
  start: number;
  /** When the answer reached the first mate or the hold was closed, or null while it is open. */
  end: number | null;
}

interface Life {
  task: string;
  project: string;
  dispatched: number | null;
  merged: number | null;
  cleanedUp: number | null;
  red: boolean;
  held: boolean;
  tokens: number | null;
  holds: Hold[];
}

/** Each task's life from every event kept, the same event told twice counted once. */
function lives(events: FactoryEvent[], upTo: number): Map<string, Life> {
  const seen = new Set<string>();
  const sorted = events.filter((e) => e.at < upTo).sort((a, b) => a.at - b.at);
  const out = new Map<string, Life>();
  const heldAt = new Map<string, number[]>();
  const endsAt = new Map<string, number[]>();
  for (const e of sorted) {
    const id = `${e.task}\u0000${e.event}\u0000${e.at}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let l = out.get(e.task);
    if (!l) {
      l = { task: e.task, project: e.project, dispatched: null, merged: null, cleanedUp: null, red: false, held: false, tokens: null, holds: [] };
      out.set(e.task, l);
    }
    if (e.event === "dispatched" && l.dispatched === null) l.dispatched = e.at;
    else if (e.event === "merged" && l.merged === null) l.merged = e.at;
    else if (e.event === "cleaned_up" && l.cleanedUp === null) l.cleanedUp = e.at;
    else if (e.event === "red") l.red = true;
    else if (e.event === "held") {
      l.held = true;
      heldAt.set(e.task, [...(heldAt.get(e.task) ?? []), e.at]);
    } else if (e.event === "answered" || e.event === "hold_closed") endsAt.set(e.task, [...(endsAt.get(e.task) ?? []), e.at]);
    else if (e.event === "tokens" && e.value !== undefined) l.tokens = (l.tokens ?? 0) + e.value;
  }
  // A hold ends at the first answer or close after it and before the next hold.
  for (const [task, starts] of heldAt) {
    const l = out.get(task)!;
    const ends = endsAt.get(task) ?? [];
    starts.forEach((start, i) => {
      const next = starts[i + 1] ?? Infinity;
      const end = ends.find((t) => t >= start && t < next) ?? null;
      l.holds.push({ task, project: l.project, start, end });
    });
  }
  return out;
}

function overlaps(from: number, to: number, spans: [number, number][]): boolean {
  return spans.some(([a, b]) => a <= to && b >= from);
}

function figures(all: Map<string, Life>, mine: (l: Life) => boolean, start: number, end: number, spans: [number, number][]): Figures {
  const inWeek = (t: number | null) => t !== null && t >= start && t < end;
  const merged = [...all.values()].filter((l) => mine(l) && inWeek(l.merged));
  const cycles = merged.filter((l) => l.dispatched !== null).map((l) => l.merged! - l.dispatched!);
  const finished = [...all.values()].filter((l) => mine(l) && (inWeek(l.merged) || inWeek(l.cleanedUp)));
  // A question counts once it has an end: an open one is not yet a wait.
  const holds = [...all.values()].filter(mine).flatMap((l) => l.holds).filter((h) => h.end !== null && h.start >= start && h.start < end);
  const waits = holds.map((h) => h.end! - h.start);
  const dayWaits = holds.filter((h) => inDay(h.start)).map((h) => h.end! - h.start);
  const away = merged.filter((l) => l.dispatched !== null);
  const tokens = merged.filter((l) => l.tokens !== null).map((l) => l.tokens!);
  return {
    merged: merged.length,
    cycle: { median: figure(cycles.length, median(cycles)), p90: figure(cycles.length, p90(cycles)) },
    waiting: { median: figure(dayWaits.length, median(dayWaits)), longest: figure(waits.length, waits.length === 0 ? null : Math.max(...waits)), questions: holds.length },
    neededYou: share(merged.filter((l) => l.held).length, merged.length),
    wentRed: share(finished.filter((l) => l.red).length, finished.length),
    away: share(away.filter((l) => !overlaps(l.dispatched!, l.merged!, spans)).length, away.length),
    tokensPerTask: figure(tokens.length, median(tokens)),
  };
}

/** One week's figures, for every project and for each. `plan` is the weekly window's readings (`pct` in percent). */
export function week(events: FactoryEvent[], spans: [number, number][], plan: { at: number; pct: number }[], start: number): Week {
  const end = weekEnd(start);
  const all = lives(events, end);
  const prevStart = weekStart(start - 1);
  const prev = figures(all, () => true, prevStart, start, spans).merged;
  const active = new Set(events.filter((e) => e.at >= start && e.at < end).map((e) => e.project));
  const peaks = plan.filter((r) => r.at >= start && r.at < end).map((r) => r.pct);
  return {
    start,
    end,
    ...figures(all, () => true, start, end, spans),
    mergedPrev: prev,
    planPeak: peaks.length === 0 ? null : Math.max(...peaks),
    byProject: [...active].sort().map((project) => ({ project, ...figures(all, (l) => l.project === project, start, end, spans) })),
  };
}

/** The last `count` weeks up to and including the one starting at `last`, oldest first. */
export function weeks(events: FactoryEvent[], spans: [number, number][], plan: { at: number; pct: number }[], last: number, count: number): Week[] {
  const starts: number[] = [];
  for (let s = last, i = 0; i < count; i++, s = weekStart(s - 1)) starts.unshift(s);
  return starts.map((s) => week(events, spans, plan, s));
}
