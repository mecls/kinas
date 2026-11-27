// What the phone says, as pure functions of what the store holds (build spec §4 "The phone", §11.2; DESIGN.md 3.3). No
// rendering and no network: the views read these, and a test holds the words.

import type { Summary, SummaryItem, SummaryTask } from "../../convex/lib/summary.ts";
import type { AnswerFacts, InboxItem } from "../../convex/lib/waiting.ts";
import { COMPANION_FRESH_MS } from "../../convex/lib/answers.ts";
import { normalizeCode } from "../../convex/lib/auth.ts";

export type { Summary, SummaryItem, SummaryTask, InboxItem };
export type Kind = AnswerFacts["kind"];

export const TABS = ["home", "inbox", "crew", "factory"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_WORDS: Record<Tab, string> = { home: "Home", inbox: "Inbox", crew: "Crew", factory: "Factory" };

const two = (n: number) => String(n).padStart(2, "0");
/** `14:05`: this phone's own clock, 24 hours. */
export const hhmm = (ms: number): string => `${two(new Date(ms).getHours())}:${two(new Date(ms).getMinutes())}`;
export const hhmmss = (ms: number): string => `${hhmm(ms)}:${two(new Date(ms).getSeconds())}`;

/** An age: `just now`, `3 min ago`, `2 h ago`, `4 d ago`. */
export function ago(ms: number, now: number): string {
  const min = Math.max(0, Math.floor((now - ms) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

// ---- the caption under the large title ----

export interface ReadingResult { summary: Summary | null; heartbeatAt: number | null }
export type Freshness =
  | { state: "loading" }
  | { state: "empty" }
  | { state: "fresh"; asOf: number }
  | { state: "stale"; since: number; lastReading: number | null };

/** Fresh while the companion has beat inside the last minute; else stale since its last beat. `undefined` is still loading. */
export function freshness(r: ReadingResult | undefined, now: number): Freshness {
  if (r === undefined) return { state: "loading" };
  if (r.summary === null) return r.heartbeatAt === null ? { state: "empty" } : { state: "loading" };
  if (r.heartbeatAt === null || now - r.heartbeatAt > COMPANION_FRESH_MS) return { state: "stale", since: r.heartbeatAt ?? r.summary.asOf, lastReading: r.summary.asOf };
  return { state: "fresh", asOf: r.summary.asOf };
}

/** `homelab · as of 14:04:50`, `reading…`, or `homelab · unreachable since 14:02 · last reading 14:01`. */
export function captionOf(f: Freshness, label: string): string {
  switch (f.state) {
    case "loading":
      return "reading…";
    case "empty":
      return `${label} · nothing read yet`;
    case "fresh":
      return `${label} · as of ${hhmmss(f.asOf)}`;
    case "stale":
      return `${label} · unreachable since ${hhmm(f.since)}${f.lastReading === null ? "" : ` · last reading ${hhmm(f.lastReading)}`}`;
  }
}

// ---- the item sheet's lines ----

const KIND_WORDS: Record<Kind, string> = { approve: "Approved", deny: "Denied", answer: "Answered" };

export interface AnswerLines {
  /** `Approved — answered from the phone at 14:05.`, or `Sending…`. */
  done: string | null;
  /** `Read by the first mate at 14:06.` */
  read: string | null;
  /** `The first mate: On it`. */
  reply: string | null;
  /** In danger words: what was not delivered, or refused. */
  error: string | null;
  /** Whether the three actions show: an item that is answered, or being answered, has none (DESIGN.md 1.14). */
  canAnswer: boolean;
}

export function answerLines(a: InboxItem["answer"]): AnswerLines {
  if (a === null) return { done: null, read: null, reply: null, error: null, canAnswer: true };
  switch (a.status) {
    case "pending":
      return { done: "Sending…", read: null, reply: null, error: null, canAnswer: false };
    case "delivered":
      return {
        done: `${KIND_WORDS[a.kind]} — answered from the phone at ${hhmm(a.at)}.`,
        read: a.readAt === null ? null : `Read by the first mate at ${hhmm(a.readAt)}.`,
        reply: a.reply === null ? null : `The first mate: ${a.reply}`,
        error: null,
        canAnswer: false,
      };
    case "already":
      return { done: null, read: null, reply: null, error: "Already answered", canAnswer: false };
    case "not_open":
      return { done: null, read: null, reply: null, error: "No longer waiting", canAnswer: false };
    case "expired":
      return { done: null, read: null, reply: null, error: "Not delivered in time. Send it again.", canAnswer: true };
  }
}

/** A refusal the store handed back as a value (`submitAnswer`), in its own words; nothing else is shown. */
export const refusalWords = (r: { refused: string; why: string }): string => r.why;

// ---- one request id per answer, so Send again is one answer ----

export interface RequestMemo { key: string; kind: Kind; text: string; id: string }

/** The same item, kind and words keep their request id (a resend is the same answer); any change makes a new one. */
export function requestFor(memo: RequestMemo | null, key: string, kind: Kind, text: string, mint: () => string): RequestMemo {
  return memo && memo.key === key && memo.kind === kind && memo.text === text ? memo : { key, kind, text, id: mint() };
}

/** `phone-` and 16 hex characters: inside the store's request id pattern. */
export function mintRequestId(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(8))): string {
  return `phone-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---- pairing ----

/** The code in `#pair=AB3K-9XZQ`, normalised; null when the address carries none. */
export function codeFromHash(hash: string): string | null {
  const m = /^#?pair=([A-Za-z0-9 -]{4,20})$/.exec(hash);
  if (!m) return null;
  const code = normalizeCode(m[1]!);
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code) ? code : null;
}

/** What the person typed, as the store reads it: capitals, no dashes or spaces; null until it is eight characters. */
export function codeTyped(text: string): string | null {
  const code = normalizeCode(text);
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code) ? code : null;
}

// ---- Home and Crew ----

export interface ProjectGroup { project: string; tasks: SummaryTask[] }

/** The board as one list per project, projects in name order, tasks as the companion sent them. */
export function groupByProject(board: SummaryTask[]): ProjectGroup[] {
  const groups = new Map<string, SummaryTask[]>();
  for (const t of board) groups.set(t.project || "—", [...(groups.get(t.project || "—") ?? []), t]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([project, tasks]) => ({ project, tasks }));
}

const minutes = (s: number): string => (s < 60 ? "under a minute" : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

/** `ship · claude · working 41 min · PR #91 4/4`: what the row says under its title. */
export function taskMeta(t: SummaryTask): string {
  const state = t.elapsedS === null ? null : `${t.word} ${minutes(t.elapsedS)}`;
  const pr = t.pr === null ? null : `PR #${t.pr}${t.checks === null ? "" : ` ${t.checks}`}`;
  return [t.kind, t.harness, state, pr].filter((x): x is string => x !== null && x !== "").join(" · ");
}

/** `2 working · 1 waiting on you`: a project's one line on Home. */
export function projectLine(g: ProjectGroup, waiting: SummaryItem[]): string {
  const n = (f: (t: SummaryTask) => boolean) => g.tasks.filter(f).length;
  const waits = waiting.filter((w) => w.project === (g.project === "—" ? "" : g.project)).length;
  const parts = [
    n((t) => t.word === "working") > 0 ? `${n((t) => t.word === "working")} working` : null,
    waits > 0 ? `${waits} waiting on you` : null,
    n((t) => t.word === "in review") > 0 ? `${n((t) => t.word === "in review")} in review` : null,
    n((t) => t.word === "blocked" || t.word === "CI red" || t.word === "failed") > 0 ? `${n((t) => t.word === "blocked" || t.word === "CI red" || t.word === "failed")} need a look` : null,
    n((t) => t.word === "queued") > 0 ? `${n((t) => t.word === "queued")} queued` : null,
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join(" · ") : "Nothing running";
}

/** The Inbox tab's count: the items still waiting. */
export const inboxCount = (items: InboxItem[]): number => items.filter((i) => i.answer === null || i.answer.status !== "delivered").length;

/** What this phone is called on the Mac's list: the device's kind, never its owner's name. */
export function deviceName(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android phone";
  return "Phone";
}
