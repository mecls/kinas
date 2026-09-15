import { describe, expect, test } from "bun:test";
import { type Cell, type SelectionSnapshot, selectionDeleteBytes } from "./selectionDelete.ts";

const COLS = 80;
// 43 cells, as in the screenshot that asked for this: `clmefes` starts at column 43.
const PROMPT = "miguelcarvalhal@Miguels-MacBook-Air apps % ";

/** A row as xterm holds it: `text` from column 0, a wide character as a 2-wide cell and a 0-wide one, the rest never written. */
function rowOf(text: string): Cell[] {
  const row: Cell[] = [];
  for (const ch of text) {
    const wide = /[　-鿿]/.test(ch);
    row.push({ chars: ch, width: wide ? 2 : 1 });
    if (wide) row.push({ chars: "", width: 0 });
  }
  while (row.length < COLS) row.push({ chars: "", width: 1 });
  return row;
}

/** `clmefes` typed at the prompt on row 7, the cursor after it, and `cl` selected; `over` changes any of it. */
function snapshot(over: Partial<SelectionSnapshot> & { select?: [number, number] } = {}): SelectionSnapshot {
  const { select = [43, 45], ...rest } = over;
  return {
    bufferType: "normal",
    kittyFlags: 0,
    appCursor: false,
    cursorX: 50,
    cursorRow: 7,
    selection: { start: { x: select[0], y: 7 }, end: { x: select[1], y: 7 } },
    row: rowOf(`${PROMPT}clmefes`),
    ...rest,
  };
}

const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const BS = "\x7f";

describe("⌫ removes the selection from the line being typed", () => {
  test("selecting `cl` in `clmefes`: five ← to its end, then two ⌫, leaving `mefes`", () => {
    expect(selectionDeleteBytes(snapshot())).toBe(LEFT.repeat(5) + BS.repeat(2));
  });
  test("arrows follow application cursor mode", () => {
    expect(selectionDeleteBytes(snapshot({ appCursor: true }))).toBe("\x1bOD".repeat(5) + BS.repeat(2));
  });
  test("the whole word with the cursor at its end needs no arrows", () => {
    expect(selectionDeleteBytes(snapshot({ select: [43, 50] }))).toBe(BS.repeat(7));
  });
  test("a drag past the typed text into blank cells counts only the typed characters", () => {
    expect(selectionDeleteBytes(snapshot({ select: [43, 55] }))).toBe(BS.repeat(7));
  });
  test("wide characters count once each", () => {
    const row = rowOf(`${PROMPT}日本`);
    expect(selectionDeleteBytes(snapshot({ row, cursorX: 47, select: [43, 47] }))).toBe(BS.repeat(2));
  });
  test("with the cursor left of the selection, the arrows go right", () => {
    expect(selectionDeleteBytes(snapshot({ cursorX: 43, select: [45, 50] }))).toBe(RIGHT.repeat(7) + BS.repeat(5));
  });
  test("a selection reaching into the prompt still counts every cell; zsh ignores a ⌫ before its buffer", () => {
    expect(selectionDeleteBytes(snapshot({ select: [41, 45] }))).toBe(LEFT.repeat(5) + BS.repeat(4));
  });
});

describe("⌫ reaches the PTY as usual", () => {
  test("no selection", () => {
    expect(selectionDeleteBytes(snapshot({ selection: undefined }))).toBeNull();
  });
  test("a selection only in blank cells", () => {
    expect(selectionDeleteBytes(snapshot({ select: [52, 60] }))).toBeNull();
  });
  test("the alternate screen: Herdr, vim, lazygit, less", () => {
    expect(selectionDeleteBytes(snapshot({ bufferType: "alternate" }))).toBeNull();
  });
  test("a program that enabled the kitty keyboard protocol", () => {
    expect(selectionDeleteBytes(snapshot({ kittyFlags: 1 }))).toBeNull();
  });
  test("a selection spanning two rows", () => {
    expect(selectionDeleteBytes(snapshot({ selection: { start: { x: 43, y: 7 }, end: { x: 5, y: 8 } } }))).toBeNull();
  });
  test("a selection on a row other than the cursor's", () => {
    expect(selectionDeleteBytes(snapshot({ cursorRow: 9 }))).toBeNull();
  });
});
