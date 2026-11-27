import { expect, test } from "bun:test";
import { ANSWERS_PER_MINUTE, ANSWER_TTL_MS, COMPANION_FRESH_MS, isExpired, judgeSubmit, takeable, wordsOk, type AnswerRow } from "./answers.ts";

const NOW = 10_000_000;
const row = (over: Partial<AnswerRow> = {}): AnswerRow => ({ key: "t@t@1", requestId: "r-1", status: "pending", submittedAt: NOW - 1_000, ...over });
const base = { now: NOW, companionBeatAt: NOW - 5_000, kind: "approve" as const, text: "", requestId: "r-2", forKey: [] as AnswerRow[], recent: 0 };

test("a first answer to a listening companion is let through", () => {
  expect(judgeSubmit(base)).toEqual({ ok: true });
});

test("a companion silent for over a minute, or never heard, is unreachable and nothing is stored", () => {
  expect(judgeSubmit({ ...base, companionBeatAt: NOW - COMPANION_FRESH_MS - 1 })).toMatchObject({ refused: "unreachable" });
  expect(judgeSubmit({ ...base, companionBeatAt: NOW - COMPANION_FRESH_MS })).toEqual({ ok: true });
  expect(judgeSubmit({ ...base, companionBeatAt: null })).toMatchObject({ refused: "unreachable" });
});

test("a second answer for an item already pending, delivered or answered elsewhere is refused", () => {
  for (const status of ["pending", "delivered", "already"] as const) {
    expect(judgeSubmit({ ...base, forKey: [row({ status })] })).toMatchObject({ refused: "already" });
  }
});

test("an item whose answer expired or found its question closed can be answered again", () => {
  expect(judgeSubmit({ ...base, forKey: [row({ status: "expired" })] })).toEqual({ ok: true });
  expect(judgeSubmit({ ...base, forKey: [row({ status: "not_open" })] })).toEqual({ ok: true });
});

test("the same request id again is the same answer, however the item stands", () => {
  const sent = row({ requestId: "r-2", status: "delivered" });
  expect(judgeSubmit({ ...base, forKey: [sent] })).toEqual({ replay: sent });
  expect(judgeSubmit({ ...base, companionBeatAt: null, forKey: [sent] })).toEqual({ replay: sent });
});

test("an Answer needs words; Approve and Deny don't; nothing holds a NUL or goes over 8,192 bytes", () => {
  expect(wordsOk("answer", "  ")).toBe(false);
  expect(wordsOk("answer", "MIT")).toBe(true);
  expect(wordsOk("approve", "")).toBe(true);
  expect(wordsOk("deny", "")).toBe(true);
  expect(wordsOk("answer", "a\0b")).toBe(false);
  expect(wordsOk("answer", "x".repeat(8_192))).toBe(true);
  expect(wordsOk("answer", "x".repeat(8_193))).toBe(false);
  expect(wordsOk("answer", "é".repeat(4_097))).toBe(false);
  expect(judgeSubmit({ ...base, kind: "answer", text: "" })).toMatchObject({ refused: "words" });
});

test("a device that answers ten times in a minute is refused the eleventh", () => {
  expect(judgeSubmit({ ...base, recent: ANSWERS_PER_MINUTE - 1 })).toEqual({ ok: true });
  expect(judgeSubmit({ ...base, recent: ANSWERS_PER_MINUTE })).toMatchObject({ refused: "rate" });
});

test("a pending answer is takeable for 60 s and then never", () => {
  const r = row({ submittedAt: NOW - ANSWER_TTL_MS });
  expect(takeable(r, NOW)).toBe(true);
  expect(isExpired(r, NOW)).toBe(false);
  const late = row({ submittedAt: NOW - ANSWER_TTL_MS - 1 });
  expect(takeable(late, NOW)).toBe(false);
  expect(isExpired(late, NOW)).toBe(true);
  expect(isExpired(row({ status: "delivered", submittedAt: 0 }), NOW)).toBe(false);
});
