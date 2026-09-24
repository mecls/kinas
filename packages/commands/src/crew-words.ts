// A crew task's one word (build spec §7), the CLI's copy of app/src-tauri/src/readers/crew/word.rs: first match wins,
// derived from the mirror's columns and never stored. fixtures/crew-words.json holds both sides to the same cases.

import type { CrewTaskRow } from "@kinas/store/types";

export type CrewWord = "queued" | "working" | "needs decision" | "blocked" | "CI red" | "PR open" | "ready" | "done" | "failed" | "paused" | "unknown" | "gone";

export interface PrWordInput {
  state: string | null;
  draft: boolean;
  mergeable: string | null;
  checks_total: number | null;
  checks_failed: number | null;
}

export interface WordInput {
  gone: boolean;
  done: boolean;
  state: string | null;
  backlog_state: string | null;
  pending_decision: boolean;
  captain_actionable: boolean;
  blocked_event: boolean;
  pr: PrWordInput | null;
}

export function wordOfInput(w: WordInput): CrewWord {
  const state = w.state ?? "";
  if (w.gone) return "gone";
  if (w.done) return "done";
  if (state === "failed") return "failed";
  if (w.pending_decision || state === "parked" || w.captain_actionable) return "needs decision";
  if (w.blocked_event || state === "blocked") return "blocked";
  if (state === "paused") return "paused";
  if (w.pr) {
    const failed = w.pr.checks_failed ?? 0;
    if (w.pr.state === "OPEN" && !w.pr.draft && w.pr.mergeable === "MERGEABLE" && (w.pr.checks_total ?? 0) > 0 && failed === 0) return "ready";
    return failed > 0 ? "CI red" : "PR open";
  }
  if (state === "working") return "working";
  if (w.backlog_state === "queued") return "queued";
  return "unknown";
}

/** Home's overnight buckets: the word without the gone rule, then done · working · wait · fail. */
export function overnightBucket(wordWithoutGone: CrewWord): "done" | "working" | "wait" | "fail" {
  if (wordWithoutGone === "done") return "done";
  if (wordWithoutGone === "needs decision" || wordWithoutGone === "ready") return "wait";
  if (wordWithoutGone === "failed" || wordWithoutGone === "blocked" || wordWithoutGone === "CI red") return "fail";
  return "working";
}

/** In flight: any word but queued, done and gone. */
export const inFlight = (word: CrewWord): boolean => word !== "queued" && word !== "done" && word !== "gone";

export function inputOfRow(row: CrewTaskRow): WordInput {
  return {
    gone: row.gone_at !== null,
    done: row.done_at !== null,
    state: row.state,
    backlog_state: row.backlog_state,
    pending_decision: row.pending_decision === 1,
    captain_actionable: row.captain_actionable === 1,
    blocked_event: row.blocked_event === 1,
    pr: row.pr_url
      ? { state: row.pr_state, draft: row.pr_draft === 1, mergeable: row.pr_mergeable, checks_total: row.pr_checks_total, checks_failed: row.pr_checks_failed }
      : null,
  };
}

export const wordOf = (row: CrewTaskRow): CrewWord => wordOfInput(inputOfRow(row));
