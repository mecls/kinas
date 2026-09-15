// ⌫ over a selection at the prompt (keymap.md, "The one key the app takes without ⌘"). Kinas cannot see the
// shell's edit buffer, so it removes the selection the way a person would: arrow keys to the end of the selection,
// then one ⌫ per character. It only does this where the result is predictable, and it never guesses where the
// prompt ends: a ⌫ past the start of zsh's buffer does nothing.

export interface Cell {
  /** The cell's text; "" for a cell nothing was written to or that was erased, and for a wide character's second cell. */
  chars: string;
  /** 1, or 2 for a wide character's first cell and 0 for its second. */
  width: number;
}

export interface SelectionSnapshot {
  bufferType: "normal" | "alternate";
  /** From KittyKeyboardTracker; 0 when the program has not enabled the kitty keyboard protocol. */
  kittyFlags: number;
  /** The program switched arrows to application mode (ESC O x rather than ESC [ x). */
  appCursor: boolean;
  cursorX: number;
  /** The cursor's absolute buffer row (baseY + cursorY). */
  cursorRow: number;
  /**
   * xterm's getSelectionPosition(). Despite the doc comment in xterm.d.ts, columns are 0-based with the end
   * exclusive, and rows are absolute buffer rows (CoreBrowserTerminal.getSelectionPosition, SelectionModel).
   */
  selection: { start: { x: number; y: number }; end: { x: number; y: number } } | undefined;
  /** The cells of the cursor's row. */
  row: Cell[];
}

const BACKSPACE = "\x7f";

/** How many characters begin in columns [from, to): one ← or ⌫ moves over or deletes a whole wide character. */
function characters(row: Cell[], from: number, to: number): number {
  let count = 0;
  for (let x = from; x < to; x++) if ((row[x]?.width ?? 1) > 0) count++;
  return count;
}

/** The bytes that remove the selection from the line being typed, or null when ⌫ should reach the PTY as usual. */
export function selectionDeleteBytes(s: SelectionSnapshot): string | null {
  const selection = s.selection;
  // Full-screen programs (Herdr, vim, lazygit, less) run on the alternate screen, where ← and ⌫ are not line
  // editing; a program that enabled the kitty protocol expects its own key encodings.
  if (!selection || s.bufferType !== "normal" || s.kittyFlags !== 0) return null;
  if (selection.start.y !== selection.end.y || selection.start.y !== s.cursorRow) return null;

  // zsh erases the line after the typed text, so those cells are empty. A drag into that blank space must not
  // count as characters, or the extra ⌫ would delete real text to the left.
  const blank = (cell: Cell | undefined) => cell !== undefined && cell.chars === "" && cell.width !== 0;
  let written = s.row.length;
  while (written > 0 && blank(s.row[written - 1])) written--;
  const start = selection.start.x;
  const end = Math.min(selection.end.x, written);
  const removed = characters(s.row, start, end);
  if (removed === 0) return null;

  const [right, left] = s.appCursor ? ["\x1bOC", "\x1bOD"] : ["\x1b[C", "\x1b[D"];
  const moves = end >= s.cursorX ? right.repeat(characters(s.row, s.cursorX, end)) : left.repeat(characters(s.row, end, s.cursorX));
  return moves + BACKSPACE.repeat(removed);
}
