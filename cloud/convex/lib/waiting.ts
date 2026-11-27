// The items waiting on the captain, as the store keeps and shows them (build spec §7, §11.3 C). Pure: the functions that
// write and read the tables call these and do nothing cleverer than the call.

import type { Status } from "./answers.ts";
import type { SummaryItem } from "./summary.ts";

/** Waiting items and their answers are dropped this long after the item closed (§10: summaries, not records). */
export const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

export interface WaitingRow {
  key: string;
  closedAt?: number;
}

export interface WaitingDiff {
  /** Items the store hasn't seen: new rows, and each is one push. */
  open: SummaryItem[];
  /** Keys the reading no longer lists: they closed. */
  close: string[];
  /** Keys the store had closed that the reading lists again: opened again, not new, so no second push. */
  reopen: string[];
}

export function diffWaiting(existing: WaitingRow[], incoming: SummaryItem[]): WaitingDiff {
  const had = new Map(existing.map((r) => [r.key, r]));
  const now = new Set<string>();
  const open: SummaryItem[] = [];
  const reopen: string[] = [];
  for (const item of incoming) {
    if (now.has(item.key)) continue;
    now.add(item.key);
    const row = had.get(item.key);
    if (!row) open.push(item);
    else if (row.closedAt !== undefined) reopen.push(item.key);
  }
  const close = existing.filter((r) => r.closedAt === undefined && !now.has(r.key)).map((r) => r.key);
  return { open, close, reopen };
}

/** `<task>@<key>@<opened_at>`: the companion's item, and what its answer line needs. Anything else is no item. */
export function splitKey(key: string): { task: string; decision: string; openedAt: number } | null {
  const m = /^([A-Za-z0-9._-]{1,128})@([A-Za-z0-9._-]{1,128})@(\d{1,16})$/.exec(key);
  return m ? { task: m[1]!, decision: m[2]!, openedAt: Number(m[3]) } : null;
}

export interface AnswerFacts {
  requestId: string;
  kind: "approve" | "deny" | "answer";
  status: Status;
  submittedAt: number;
  settledAt?: number;
  readAt?: number;
  reply?: string;
}

export interface InboxItem extends SummaryItem {
  /** This item's latest answer from a phone, as the sheet's outcome lines read it; none while it is unanswered. */
  answer: { requestId: string; kind: AnswerFacts["kind"]; status: Status; at: number; readAt: number | null; reply: string | null } | null;
}

/**
 * The open items, oldest first, each with its latest answer. An answer that expired or found its question closed
 * doesn't lock the item, but it is still shown, so the phone can say what became of it.
 */
export function inboxOf(rows: (SummaryItem & { closedAt?: number })[], answers: (AnswerFacts & { key: string })[]): InboxItem[] {
  const latest = new Map<string, AnswerFacts>();
  for (const a of [...answers].sort((x, y) => x.submittedAt - y.submittedAt)) latest.set(a.key, a);
  return rows
    .filter((r) => r.closedAt === undefined)
    .sort((a, b) => a.since - b.since || a.key.localeCompare(b.key))
    .map(({ closedAt: _closed, ...item }) => {
      const a = latest.get(item.key);
      return { ...item, answer: a ? { requestId: a.requestId, kind: a.kind, status: a.status, at: a.settledAt ?? a.submittedAt, readAt: a.readAt ?? null, reply: a.reply ?? null } : null };
    });
}

export const retentionCutoff = (now: number): number => now - RETAIN_MS;
