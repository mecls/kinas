import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_TYPED_BYTES, answerLine, answerText, type AnswerKind } from "./answer-line.ts";

const cases = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "fixtures", "answer-lines.json"), "utf8")) as { task: string; key: string; kind: AnswerKind; typed: string; line: string | null }[];

test("every case in the fixture the Mac's Rust also reads", () => {
  expect(cases.length).toBeGreaterThanOrEqual(10);
  for (const c of cases) expect(answerLine(c.task, c.key, c.kind, c.typed), JSON.stringify(c)).toBe(c.line);
});

test("the cap is the Mac's: 4,096 bytes of typed words, counted in UTF-8", () => {
  expect(MAX_TYPED_BYTES).toBe(4_096);
  expect(answerText("answer", "x".repeat(4_096))).toBe("x".repeat(4_096));
  expect(answerText("answer", "x".repeat(4_097))).toBeNull();
  expect(answerText("answer", "é".repeat(2_049))).toBeNull();
  expect(answerText("answer", "é".repeat(2_048))).not.toBeNull();
  expect(answerText("deny", "x".repeat(4_097))).toBeNull();
});
