import { expect, test } from "bun:test";
import cases from "../../../fixtures/staleness-cases.json";
import { readingState, type ReadingState } from "./staleness.ts";

interface Case {
  name: string;
  updated_at: number | null;
  now: number;
  stale_after_ms: number;
  dead_after_ms: number;
  resets_at: number | null;
  expected: ReadingState;
}

for (const c of cases as Case[]) {
  test(c.name, () => {
    expect(
      readingState({
        updatedAt: c.updated_at,
        now: c.now,
        staleAfterMs: c.stale_after_ms,
        deadAfterMs: c.dead_after_ms,
        resetsAt: c.resets_at,
      }),
    ).toBe(c.expected);
  });
}
