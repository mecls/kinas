// Text for the Usage page. Times are Europe/Lisbon (R11); "left" is always floored (build spec invariant 6).

import { leftPct, lisbonClock } from "@kinas/store/quota-line";

export { leftPct, lisbonClock };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "resets in 2 h 14 m (14:10)"; a day or more away: "resets in 3 d 19 h (2026-09-18 08:00)". */
export function resetsIn(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return "resets: not reported";
  const left = Math.max(0, resetsAt - now);
  const clock = lisbonClock(resetsAt, now);
  if (left < MINUTE) return `resets in <1 m (${clock})`;
  if (left >= DAY) return `resets in ${Math.floor(left / DAY)} d ${Math.floor((left % DAY) / HOUR)} h (${clock})`;
  const hours = Math.floor(left / HOUR);
  const minutes = Math.floor((left % HOUR) / MINUTE);
  return hours > 0 ? `resets in ${hours} h ${minutes} m (${clock})` : `resets in ${minutes} m (${clock})`;
}

export function asOf(updatedAt: number | null, now: number): string {
  return updatedAt === null ? "never read" : `as of ${lisbonClock(updatedAt, now)}`;
}

export type Tone = "blue" | "gold" | "crimson";

/** Bar colour by % left (R38): crimson at ≤ 10, gold at ≤ 25, blue above. */
export function tone(left: number): Tone {
  if (left <= 10) return "crimson";
  if (left <= 25) return "gold";
  return "blue";
}

/** 950 · 34k · 1.2M · 6.1B */
export function compactTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}k`;
  return String(Math.round(n));
}

function trim(v: number): string {
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(1).replace(/\.0$/, "");
}

export function gib(n: number): string {
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} GiB`;
}

export const PROVIDER_LABEL = { "claude-plan": "Claude", "ollama-cloud": "Ollama" } as const;
export const WINDOW_LABEL = { session: "session", week: "week", month_credits: "credits" } as const;
