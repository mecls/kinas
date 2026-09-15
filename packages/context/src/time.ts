// Times in the packet: absolute stamps in Europe/Lisbon (like `kinas status`), relative ages for the screen.

/** A reading older than this is marked stale rather than shown as current (CLI v0 brief). */
export const STALE_AFTER_MS = 15 * 60_000;

const lisbonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** YYYY-MM-DD HH:MM in Lisbon. */
export function lisbonStamp(ms: number): string {
  const p = Object.fromEntries(lisbonParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** now, 12m, 3h, 2d, 5w — the age of `ms` at `now`. Future times read as now. */
export function age(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

/** "just now" or "12m ago". */
export function ago(ms: number, now: number): string {
  const a = age(ms, now);
  return a === "now" ? "just now" : `${a} ago`;
}

/** in 40m, in 3h, in 2d — how long until `ms`. */
export function until(ms: number, now: number): string {
  const a = age(now, ms);
  return a === "now" ? "now" : `in ${a}`;
}
