// The factory's events, derived from what the companion already reads (build spec §7, §11.2; PRD rules 18 and 21). Pure:
// the companion feeds it the previous and the new view, the ledger lines read since last time and the answers it delivered,
// and appends what comes out. Nothing here estimates: an event is something a reading, the ledger or a delivery said.
//
// - `dispatched`, `pr_ready`, `merged`, `cleaned_up`: copied from the fleet ledger, at the ledger's own time.
// - `held`: a hold new in the snapshot, at the time it began (so telling it twice makes the same event).
// - `hold_closed`: a hold that left the snapshot, at the reading that saw it gone.
// - `answered`: an answer the companion delivered, at its time.
// - `red`: a task whose word turned blocked, failed or CI red since the previous reading.
// The first reading has no previous one: it tells the holds in view, and no red and no close.
// `tokens` are not derived here: no source counts a task's tokens yet (build spec §17).

import type { EventName, FactoryEvent } from "./week.ts";

export interface View {
  asOf: number;
  board: { task: string; project: string; word: string }[];
  waiting: { key: string; task: string; project: string; since: number }[];
}

/** A fleet-ledger line as far as the factory reads it; `ts` is in seconds. */
export interface LedgerEvent {
  event: string;
  task: string;
  ts: number;
  project?: string;
}

export interface AnswerEvent {
  task: string;
  project: string;
  /** Milliseconds. */
  at: number;
}

const LEDGER: Record<string, EventName> = {
  "task.dispatched": "dispatched",
  "task.pr_ready": "pr_ready",
  "task.merged": "merged",
  "task.cleaned_up": "cleaned_up",
};

const TROUBLE = new Set(["blocked", "failed", "CI red"]);

/** A ledger's text, one JSON object a line: a line that is not one, or not version 1, or without its fields, is left out. */
export function ledgerEventsOf(text: string): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let j: unknown;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof j !== "object" || j === null) continue;
    const o = j as Record<string, unknown>;
    if (o.v !== 1 || typeof o.event !== "string" || typeof o.task !== "string" || typeof o.ts !== "number" || !Number.isFinite(o.ts)) continue;
    out.push({ event: o.event, task: o.task, ts: o.ts, ...(typeof o.project === "string" && o.project !== "" ? { project: o.project } : {}) });
  }
  return out;
}

export function eventsFrom(prev: View | null, next: View, ledger: LedgerEvent[], answers: AnswerEvent[]): FactoryEvent[] {
  const out: FactoryEvent[] = [];

  // The ledger: a task's project is from its own dispatch line, else the board now, else the board before.
  const own = new Map<string, string>();
  for (const l of ledger) if (l.event === "task.dispatched" && l.project) own.set(l.task, l.project);
  const board = new Map<string, string>();
  for (const r of prev?.board ?? []) board.set(r.task, r.project);
  for (const r of next.board) board.set(r.task, r.project);
  const told = new Set<string>();
  for (const l of ledger) {
    const event = LEDGER[l.event];
    if (!event) continue;
    const id = `${l.event}\u0000${l.task}\u0000${l.ts}`;
    if (told.has(id)) continue;
    told.add(id);
    out.push({ task: l.task, project: own.get(l.task) ?? board.get(l.task) ?? "unknown", event, at: l.ts * 1000 });
  }

  // Holds: new in the snapshot, and (with a previous reading) gone from it.
  const before = new Set((prev?.waiting ?? []).map((w) => w.key));
  for (const w of next.waiting) if (!before.has(w.key)) out.push({ task: w.task, project: w.project, event: "held", at: w.since });
  if (prev) {
    const now = new Set(next.waiting.map((w) => w.key));
    for (const w of prev.waiting) if (!now.has(w.key)) out.push({ task: w.task, project: w.project, event: "hold_closed", at: next.asOf });
  }

  // Red: a word that turned to trouble since the previous reading.
  if (prev) {
    const was = new Map(prev.board.map((r) => [r.task, r.word]));
    for (const r of next.board) if (TROUBLE.has(r.word) && !TROUBLE.has(was.get(r.task) ?? "")) out.push({ task: r.task, project: r.project, event: "red", at: next.asOf });
  }

  for (const a of answers) out.push({ task: a.task, project: a.project, event: "answered", at: a.at });
  return out;
}
