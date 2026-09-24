import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/crew-words.json";
import { inFlight, overnightBucket, wordOfInput, type CrewWord, type WordInput } from "./crew-words.ts";

describe("the crew's word rule (build spec §7), over the fixture the app reads too", () => {
  for (const c of fixture.cases) {
    test(c.name, () => {
      const input = c.input as WordInput;
      expect(wordOfInput(input)).toBe(c.word as CrewWord);
      expect(overnightBucket(wordOfInput({ ...input, gone: false }))).toBe(c.overnight as ReturnType<typeof overnightBucket>);
    });
  }

  test("in flight is every word but queued, done and gone", () => {
    expect((["working", "needs decision", "blocked", "CI red", "PR open", "ready", "failed", "paused", "unknown"] as CrewWord[]).every(inFlight)).toBe(true);
    expect((["queued", "done", "gone"] as CrewWord[]).some(inFlight)).toBe(false);
  });
});
