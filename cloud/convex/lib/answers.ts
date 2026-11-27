// A phone's answer (build spec §6.5, §7, §11.3 D): one per item, delivered once, only to a companion that is listening,
// never after 60 seconds. The judgement of a submission and of an expiry are pure.

import { CAPS } from "./summary.ts";

export const ANSWER_TTL_MS = 60_000;
/** The companion beats every 30 s; silent for longer than this, the phone is told it can't be reached. */
export const COMPANION_FRESH_MS = 60_000;
/** A phone's answers per minute: a finger, never a loop. */
export const ANSWERS_PER_MINUTE = 10;

export type Kind = "approve" | "deny" | "answer";
export type Status = "pending" | "delivered" | "already" | "not_open" | "expired";

export interface AnswerRow {
  key: string;
  requestId: string;
  status: Status;
  submittedAt: number;
}

export type Refusal = "unreachable" | "already" | "rate" | "words";
export type Judgement = { ok: true } | { replay: AnswerRow } | { refused: Refusal; why: string };

export const REFUSAL_WORDS: Record<Refusal, string> = {
  unreachable: "Not delivered: can't reach the Linux machine",
  already: "Already answered",
  rate: "Too many answers at once. Wait a minute.",
  words: "That answer is empty or too long.",
};

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** What an item's answer is, in the words the companion hands the first mate: Approve and Deny carry none of their own. */
export function wordsOk(kind: Kind, text: string): boolean {
  if (text.includes("\0") || bytes(text) > CAPS.words) return false;
  return kind === "answer" ? text.trim() !== "" : true;
}

/**
 * `forKey` is every answer already submitted for this item. A same request id again is the same answer (a resend after
 * a lost reply); any other while one is pending or delivered is refused as already answered; one that expired or was
 * found not open leaves the item answerable. `recent` is this device's submissions in the last minute.
 */
export function judgeSubmit(a: {
  now: number;
  companionBeatAt: number | null;
  kind: Kind;
  text: string;
  requestId: string;
  forKey: AnswerRow[];
  recent: number;
}): Judgement {
  const same = a.forKey.find((r) => r.requestId === a.requestId);
  if (same) return { replay: same };
  if (!wordsOk(a.kind, a.text)) return { refused: "words", why: REFUSAL_WORDS.words };
  if (a.recent >= ANSWERS_PER_MINUTE) return { refused: "rate", why: REFUSAL_WORDS.rate };
  if (a.companionBeatAt === null || a.now - a.companionBeatAt > COMPANION_FRESH_MS) return { refused: "unreachable", why: REFUSAL_WORDS.unreachable };
  if (a.forKey.some((r) => r.status === "pending" || r.status === "delivered" || r.status === "already")) return { refused: "already", why: REFUSAL_WORDS.already };
  return { ok: true };
}

/** A pending answer the companion didn't take in time. It is never delivered afterwards (§6.5). */
export const isExpired = (r: { status: Status; submittedAt: number }, now: number): boolean => r.status === "pending" && now - r.submittedAt > ANSWER_TTL_MS;

/** Whether the companion's take is still within the 60 s: the same rule, from the other side. */
export const takeable = (r: { status: Status; submittedAt: number }, now: number): boolean => r.status === "pending" && !isExpired(r, now);
