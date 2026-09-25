import { expect, test } from "bun:test";
import { EMPTY, feed, ORDER_CAP, type Line } from "./orderLine.ts";

// The order log's line (build spec §11.4 orderLine.test.ts): typing, ⌫, bracketed paste kept, arrows dropped, ⌃C and
// ⌃U clear, Enter submits, the 2,000 cap.

/** Feeds each chunk in turn; returns every line submitted and the line left. */
function run(...chunks: string[]): { submitted: string[]; line: Line } {
  let line = EMPTY;
  const submitted: string[] = [];
  for (const c of chunks) {
    const r = feed(line, c);
    line = r.line;
    if (r.submitted !== null) submitted.push(r.submitted);
  }
  return { submitted, line };
}

test("typing, one key at a time, then Enter", () => {
  expect(run(..."deploy the thing 9c2e".split(""), "\r").submitted).toEqual(["deploy the thing 9c2e"]);
  expect(run("hello\r", "again\n").submitted).toEqual(["hello", "again"]);
});

test("⌫ removes the last character, as a DEL or a backspace", () => {
  expect(run("clme", "\x7f", "\x7f", "fes\r").submitted).toEqual(["clfes"]);
  expect(run("ab\bc\r").submitted).toEqual(["ac"]);
});

test("a bracketed paste is kept whole, its newlines included", () => {
  expect(run("say ", "\x1b[200~line one\rline two\x1b[201~", "\r").submitted).toEqual(["say line one\nline two"]);
});

test("arrows, function keys and other escapes are dropped", () => {
  expect(run("ab", "\x1b[D", "\x1b[A", "\x1bOP", "\x1b[15~", "\x1bb", "c\r").submitted).toEqual(["abc"]);
});

test("the terminal's replies are not typing: colour reports and status strings are skipped whole", () => {
  const replies = "\x1b]10;rgb:e7e7/eeee/f7f7\x1b\\\x1b]11;rgb:1010/1919/2b2b\x07\x1b]4;0;rgb:2b2b/3131/4040\x1b\\\x1bP1$r0m\x1b\\\x1b[?1;2c\x1b[I";
  expect(run(replies, "deploy the thing 9c2e\r").submitted).toEqual(["deploy the thing 9c2e"]);
  expect(run("ab", "\x1b]10;rgb:unterminated", "c\r").submitted).toEqual(["abc"], "an open string drops only its chunk");
});

test("⌃C and ⌃U clear the line", () => {
  expect(run("wrong", "\x03", "right\r").submitted).toEqual(["right"]);
  expect(run("wrong", "\x15", "right\r").submitted).toEqual(["right"]);
});

test("kitty-protocol keys: Enter, ⌫, ⌃C", () => {
  expect(run("abc", "\x1b[127u", "\x1b[13u").submitted).toEqual(["ab"]);
  expect(run("x", "\x1b[99;5u", "y", "\x1b[13;1u").submitted).toEqual(["y"]);
});

test("Enter on nothing submits nothing, and Tab is not text", () => {
  expect(run("\r", "   \r").submitted).toEqual([]);
  expect(run("a\tb\r").submitted).toEqual(["ab"]);
});

test("a line stops growing at 2,000 characters", () => {
  const long = run("x".repeat(ORDER_CAP + 50), "\r").submitted[0]!;
  expect(long.length).toBe(ORDER_CAP);
});
