import { expect, test } from "bun:test";
import { KittyKeyboardTracker } from "./kittyKeyboard.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

test("starts with no flags", () => {
  expect(new KittyKeyboardTracker().flags).toBe(0);
});

test("push and pop, as Herdr does with CSI > 7 u", () => {
  const t = new KittyKeyboardTracker();
  t.feed(bytes("hello\x1b[>7uworld"));
  expect(t.flags).toBe(7);
  t.feed(bytes("\x1b[<u"));
  expect(t.flags).toBe(0);
});

test("pop n removes n entries", () => {
  const t = new KittyKeyboardTracker();
  t.feed(bytes("\x1b[>1u\x1b[>3u\x1b[>7u"));
  t.feed(bytes("\x1b[<2u"));
  expect(t.flags).toBe(1);
});

test("set replaces, or sets and clears bits", () => {
  const t = new KittyKeyboardTracker();
  t.feed(bytes("\x1b[>1u\x1b[=4;2u"));
  expect(t.flags).toBe(5);
  t.feed(bytes("\x1b[=1;3u"));
  expect(t.flags).toBe(4);
  t.feed(bytes("\x1b[=2u"));
  expect(t.flags).toBe(2);
});

test("a sequence split across chunks is still recognised", () => {
  const t = new KittyKeyboardTracker();
  t.feed(bytes("abc\x1b"));
  t.feed(bytes("[>"));
  t.feed(bytes("7"));
  expect(t.flags).toBe(0);
  t.feed(bytes("u rest"));
  expect(t.flags).toBe(7);
});

test("query is answered with the current flags", () => {
  const t = new KittyKeyboardTracker();
  expect(t.feed(bytes("\x1b[?u"))).toEqual(["\x1b[?0u"]);
  t.feed(bytes("\x1b[>7u"));
  expect(t.feed(bytes("\x1b[?u"))).toEqual(["\x1b[?7u"]);
});

test("the alternate screen keeps its own stack", () => {
  const t = new KittyKeyboardTracker();
  t.feed(bytes("\x1b[?1049h\x1b[>7u"));
  expect(t.flags).toBe(7);
  t.feed(bytes("\x1b[?1049l"));
  expect(t.flags).toBe(0);
  t.feed(bytes("\x1b[?1049h"));
  expect(t.flags).toBe(7);
});

test("full reset and reset() clear every stack", () => {
  const t = new KittyKeyboardTracker();
  t.feed(bytes("\x1b[>7u\x1b[?1049h\x1b[>1u\x1bc"));
  expect(t.flags).toBe(0);
  t.feed(bytes("\x1b[>7u"));
  t.reset();
  expect(t.flags).toBe(0);
});

test("other CSI sequences, like colours and cursor moves, change nothing", () => {
  const t = new KittyKeyboardTracker();
  t.feed(bytes("\x1b[38;2;0;84;158mRGB\x1b[0m\x1b[2J\x1b[H\x1b[?2004h"));
  expect(t.flags).toBe(0);
});
