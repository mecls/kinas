// One line per quota window, shared by `kinas status` and the palette. The menu bar formats the same line
// in Rust; both are held to fixtures/quota-line-cases.json. Left is always floored (build spec
// invariant 6): a rounded-up number would overstate what is left.

import type { ReadingState } from "./staleness.ts";

export type Subscription = "claude-plan" | "ollama-cloud";
export type QuotaWindow = "session" | "week" | "month_credits";

export interface QuotaLineInput {
  provider: Subscription;
  window: QuotaWindow;
  used_pct: number;
  resets_at: number | null;
  updated_at: number | null;
  state: ReadingState;
  reason: string | null;
}

const PROVIDER_LABEL: Record<Subscription, string> = { "claude-plan": "Claude", "ollama-cloud": "Ollama" };
const WINDOW_LABEL: Record<QuotaWindow, string> = { session: "session", week: "week", month_credits: "credits" };
const LABEL_WIDTH = 19;

const lisbonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function lisbon(ms: number): { date: string; time: string } {
  const p = Object.fromEntries(lisbonParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** HH:MM when `ms` falls on the same Lisbon day as `now`, otherwise YYYY-MM-DD HH:MM. */
export function lisbonClock(ms: number, now: number): string {
  const at = lisbon(ms);
  return at.date === lisbon(now).date ? at.time : `${at.date} ${at.time}`;
}

export function leftPct(usedPct: number): number {
  return Math.floor(100 - usedPct);
}

export function quotaLabel(provider: Subscription, window: QuotaWindow): string {
  return `${PROVIDER_LABEL[provider]} · ${WINDOW_LABEL[window]}`;
}

export function formatQuotaLine(q: QuotaLineInput, now: number): string {
  const label = quotaLabel(q.provider, q.window);
  const head = label.padEnd(Math.max(LABEL_WIDTH, label.length + 1));
  const asOf = q.updated_at === null ? null : `as of ${lisbonClock(q.updated_at, now)}`;

  if (q.state === "reset") {
    const at = q.resets_at === null ? "" : ` at ${lisbonClock(q.resets_at, now)}`;
    return `${head}— · reset${at} · waiting for a new reading`;
  }
  if (q.state === "dead") {
    return [`${head}—`, q.reason ?? "no reading", asOf].filter(Boolean).join(" · ");
  }
  const resets = q.resets_at === null ? "resets: not reported" : `resets ${lisbonClock(q.resets_at, now)}`;
  const line = [`${head}${leftPct(q.used_pct)}% left`, resets, asOf].filter(Boolean).join(" · ");
  return q.state === "stale" ? `${line} (stale)` : line;
}
