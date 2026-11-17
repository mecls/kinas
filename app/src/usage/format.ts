// Text for the Usage page. Times are Europe/Lisbon (R11); "left" is always floored (build spec invariant 6).

import { compactTokens, leftPct, lisbonClock } from "@kinas/store/quota-line";
import type { ReadingState } from "../api.ts";
import { toneOf, type Tone } from "../ui/Bar.tsx";

export { compactTokens, leftPct, lisbonClock };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lisbonDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Thu 2 Oct, 12:43" on the Lisbon clock: names from fixed tables, so a locale's "Sept" never shows up. */
export function lisbonDayClock(ms: number): string {
  const p = Object.fromEntries(lisbonDay.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const weekday = WEEKDAY[new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay()];
  return `${weekday} ${Number(p.day)} ${MONTH[Number(p.month) - 1]}, ${p.hour}:${p.minute}`;
}

/** "1 h 59 m", "18 m", "<1 m", "3 d 18 h": how long until `at`. */
function until(at: number, now: number): string {
  const left = Math.max(0, at - now);
  if (left < MINUTE) return "<1 m";
  if (left >= DAY) return `${Math.floor(left / DAY)} d ${Math.floor((left % DAY) / HOUR)} h`;
  const hours = Math.floor(left / HOUR);
  const minutes = Math.floor((left % HOUR) / MINUTE);
  return hours > 0 ? `${hours} h ${minutes} m` : `${minutes} m`;
}

/**
 * A reset as DESIGN.md §6 says it (1.13): relative within a day, "resets in 1 h 59 m", and absolute beyond, "resets
 * Thu 2 Oct, 12:43", on the Lisbon clock; the other form is the tooltip. Home, Usage and the Usage popover all say it so.
 */
export function resetsCaption(resetsAt: number | null, now: number): { text: string; title: string } {
  if (resetsAt === null) return { text: "resets not reported", title: "" };
  const relative = `resets in ${until(resetsAt, now)}`;
  const absolute = `resets ${lisbonDayClock(resetsAt)}`;
  return resetsAt - now < DAY ? { text: relative, title: absolute } : { text: absolute, title: relative };
}

export function asOf(updatedAt: number | null, now: number): string {
  return updatedAt === null ? "never read" : `as of ${lisbonClock(updatedAt, now)}`;
}

/** A metric row's unit with "stale" said after it (DESIGN.md §1: a stale reading says so where it is) — alone when
 * the row had no unit, so nothing ever reads " · stale" with nothing before the separator. */
export function withStale(unit: string, stale: boolean): string {
  if (!stale) return unit;
  return unit === "" ? "stale" : `${unit} · stale`;
}

/**
 * A bar's tone by % used (DESIGN.md §2.2, replacing R38's % left): `ui/Bar.ts toneOf` is the law, and a reading's
 * state comes first — stale is stale whatever its number, and a dead or reset one shows no number to warn about.
 */
export function tone(used: number | null, state: ReadingState): Tone {
  if (state === "dead" || state === "reset") return "meter";
  return toneOf(used, state === "stale");
}

/**
 * "% used" the way ollama.com writes it: one decimal under 10 ("0.4", "2.5"), whole numbers from 10. Rounded up,
 * so usage is never understated — the mirror of flooring "left".
 */
export function usedPct(used: number): string {
  // Stored values come from fractions × 100 (0.003 × 100 = 0.30000000000000004); drop that noise first.
  const clean = Math.round(used * 1e6) / 1e6;
  return clean < 10 ? String(Math.ceil(clean * 10) / 10) : String(Math.ceil(clean));
}

export function gib(n: number): string {
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} GiB`;
}

const GB_PER_GIB = 1.073741824;

/** A disk size stored in GiB, shown in Finder's decimal GB and floored, so free space is never overstated. */
export function gb(gibValue: number): string {
  const n = gibValue * GB_PER_GIB;
  return n >= 100 ? `${Math.floor(n)} GB` : `${(Math.floor(n * 10) / 10).toFixed(1)} GB`;
}

export const PROVIDER_LABEL = { "claude-plan": "Claude", "ollama-cloud": "Ollama" } as const;
export const WINDOW_LABEL = { session: "session", week: "week", month_credits: "credits" } as const;
