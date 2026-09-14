// PRD R12. The same comparison runs in Rust (app/src-tauri/src/staleness.rs); both are held to
// fixtures/staleness-cases.json. The limits come from the reader's row, never from constants here,
// so a cadence changed in Rust cannot make the CLI call fresh readings stale.

export type ReadingState = "fresh" | "stale" | "dead" | "reset";

export interface StalenessInput {
  /** When the reading was true, in ms since the epoch; null if the reader never succeeded. */
  updatedAt: number | null;
  staleAfterMs: number;
  deadAfterMs: number;
  /** Quota rows only: when the window ends. */
  resetsAt?: number | null;
  now: number;
}

export function readingState(input: StalenessInput): ReadingState {
  if (input.updatedAt === null) return "dead";
  // Reset outranks dead and stale: the stored number belongs to a window that has ended.
  if (input.resetsAt != null && input.now >= input.resetsAt) return "reset";
  const age = input.now - input.updatedAt;
  if (age > input.deadAfterMs) return "dead";
  if (age > input.staleAfterMs) return "stale";
  return "fresh";
}
