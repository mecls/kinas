// What a notification says (build spec §6, §11.3 C; slice 9): a title, a body of one line, and an address on the page.
// Nothing else is in it: no answer, no path, no branch, no transcript. A push passes through the phone vendor's service
// (Apple's, for a home-screen web app), so what it carries is the least that tells the captain what waits.

import { CAPS } from "./summary.ts";

export const BODY_MAX = 120;
/** The companion silent for this long is "unreachable" (§6): one push, and one more when it is back. */
export const UNREACHABLE_AFTER_MS = 10 * 60_000;

export interface Payload {
  title: string;
  body: string;
  /** An address on the phone page: `/#item=<key>` opens the item, `/` opens Home. */
  url: string;
}

const chars = (s: string): string[] => [...s];
/** At most `max` characters, ending in an ellipsis when cut. */
const cut = (s: string, max: number): string => (chars(s).length <= max ? s : `${chars(s).slice(0, max - 1).join("")}…`);
const firstLine = (s: string): string => s.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
/** A control character in a notification is a way to hide or break a line; none goes in. */
const plain = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

const two = (n: number) => String(n).padStart(2, "0");
/** `12:51`, in the zone the deployment is told (the captain's), never the server's by accident. */
export function clockIn(ms: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("hour")}:${get("minute")}`;
  } catch {
    const d = new Date(ms);
    return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
  }
}

export function itemPayload(item: { key: string; project: string; title: string; question: string }): Payload {
  const head = [plain(item.project), plain(item.title)].filter((x) => x !== "").join(" · ");
  return { title: cut(head === "" ? "Kinas" : head, CAPS.title), body: cut(plain(firstLine(item.question)), BODY_MAX), url: `/#item=${encodeURIComponent(item.key)}` };
}

export function unreachablePayload(label: string, sinceMs: number, timeZone: string): Payload {
  return { title: cut(plain(label) || "Linux machine", CAPS.label), body: `Kinas can't reach the Linux machine since ${clockIn(sinceMs, timeZone)}`, url: "/" };
}

export function backPayload(label: string): Payload {
  return { title: cut(plain(label) || "Linux machine", CAPS.label), body: "Kinas reads the Linux machine again", url: "/" };
}

export const testPayload = (): Payload => ({ title: "Kinas", body: "A test notification from Settings", url: "/" });

/** Why a payload isn't one: any field but the three, a body over its line, a title over its cap, an address off the page. */
export function payloadViolation(p: unknown): string | null {
  if (!p || typeof p !== "object") return "not an object";
  const o = p as Record<string, unknown>;
  const extra = Object.keys(o).find((k) => !["title", "body", "url"].includes(k));
  if (extra) return `has a field a notification doesn't carry: ${extra}`;
  if (typeof o.title !== "string" || typeof o.body !== "string" || typeof o.url !== "string") return "title, body and url are strings";
  if (chars(o.body).length > BODY_MAX) return `body is over ${BODY_MAX} characters`;
  if (chars(o.title).length > CAPS.title) return "title is too long";
  if (/[\u0000-\u001f\u007f]/.test(o.title + o.body)) return "has a control character";
  if (!/^\/(#item=[A-Za-z0-9%._-]{1,400})?$/.test(o.url)) return "url is not an address on the page";
  return null;
}

// ---- the heartbeat watch ----

export type Alert = "unreachable" | "back";
export interface AlertFacts { beatAt: number | null; now: number; last: { kind: Alert; at: number } | null }

/**
 * One alert per change, never a repeat. Silent over ten minutes and not yet said: unreachable. A beat after an
 * unreachable that is newer than it: back. A companion never heard from says nothing (nothing is wrong yet).
 */
export function alertVerdict(a: AlertFacts): Alert | null {
  if (a.beatAt === null) return null;
  const silent = a.now - a.beatAt > UNREACHABLE_AFTER_MS;
  if (silent) return a.last?.kind === "unreachable" ? null : "unreachable";
  if (a.last?.kind === "unreachable" && a.beatAt > a.last.at) return "back";
  return null;
}
