import { ageText } from "../crew/inbox.ts";
import { clock } from "../crew/detail.ts";

// Settings → Where agents run, the phones' words (build spec §12 slice 8.1; DESIGN.md 1.14): the code as it is typed, its
// life, and each phone's line.

/** `AB3K9XZQ` as `AB3K-9XZQ`: eight characters read and typed in two halves. The copy is the same text. */
export const groupCode = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** The code's life: the minutes left and the time it ends, then `Expired`. */
export function expiryWords(expiresAt: number, now: number): string {
  const left = expiresAt - now;
  if (left <= 0) return "Expired";
  const min = Math.ceil(left / 60_000);
  return `Expires in ${left < 60_000 ? "under a minute" : `${min} min`}, at ${clock(expiresAt)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today's time as `today 09:05`; another day of this year as `26 Nov`; an earlier year with the year. */
export function dayWords(ms: number, now: number): string {
  const d = new Date(ms);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return `today ${clock(ms)}`;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === n.getFullYear() ? date : `${date} ${d.getFullYear()}`;
}

/** An age: `just now`, `5 min ago`, `3 h ago`, `2 d ago`. */
export const lastSeenWords = (ms: number, now: number): string => ageText(Math.min(ms, now), now);

export const notificationsWords = (on: boolean): string => (on ? "on" : "off");

/** What Remove does, beside the button's second click. */
export const REMOVE_WARNING = "This phone stops working. Pair it again to use it.";
