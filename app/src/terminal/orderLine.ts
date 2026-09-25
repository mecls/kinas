// The order log's line (build spec §6.10, §11.5 decision 1): what the captain types at a worker, rebuilt beside the
// terminal's input from the same bytes it sends — never instead of them. Printable text appends; ⌫ removes; a
// bracketed paste is kept whole, its newlines included; ⌃C and ⌃U clear; Enter submits the line. Arrows, function keys
// and every other escape are dropped, so a line edited with the arrows is an approximation — the price of never reading
// what the worker received (Firstmate's contract and PRD rule 8 forbid that). The terminal's own replies travel the same
// way — a colour report (OSC 10/11/4) or a status string (DCS) answering the program's query — and are skipped whole:
// crew-orders.e2e.ts found Herdr's colour queries filling the line to its cap before a word was typed.

export interface Line {
  text: string;
  /** Inside a bracketed paste (ESC [200~ … ESC [201~): Enter is text, not a submit. */
  pasting: boolean;
}

export const EMPTY: Line = { text: "", pasting: false };

/** The most a recorded order keeps, in characters. */
export const ORDER_CAP = 2_000;

const append = (line: Line, s: string): Line => ({ ...line, text: [...line.text, ...s].slice(0, ORDER_CAP).join("") });
const backspace = (line: Line): Line => ({ ...line, text: [...line.text].slice(0, -1).join("") });

/**
 * One chunk of what the terminal sent. `submitted` is the line an Enter finished (trimmed; null when nothing was typed),
 * and the returned line starts afresh after it.
 */
export function feed(line: Line, data: string): { line: Line; submitted: string | null } {
  let now = line;
  let submitted: string | null = null;
  let i = 0;
  while (i < data.length) {
    const c = data[i]!;
    if (c === "\x1b") {
      const rest = data.slice(i);
      if (rest.startsWith("\x1b[200~")) {
        now = { ...now, pasting: true };
        i += 6;
        continue;
      }
      if (rest.startsWith("\x1b[201~")) {
        now = { ...now, pasting: false };
        i += 6;
        continue;
      }
      // A string — OSC (ESC ]), DCS (ESC P), SOS (ESC X), PM (ESC ^), APC (ESC _) — runs to BEL or ST (ESC and a
      // backslash); one left open drops the rest of the chunk.
      if (/^\x1b[\]PX^_]/.test(rest)) {
        const end = /\x07|\x1b\\/.exec(rest.slice(2));
        i += end ? 2 + end.index + end[0].length : rest.length;
        continue;
      }
      // CSI: ESC [ params final. A kitty-protocol key (CSI code ; mods u) is read for Enter, ⌫ and ⌃C/⌃U; any other
      // CSI — arrows, function keys, focus reports — is dropped.
      const csi = /^\x1b\[([0-9;:?]*)([\x40-\x7e])/.exec(rest);
      if (csi) {
        if (csi[2] === "u") {
          const [code, mods] = csi[1]!.split(";").map((p) => Number(p.split(":")[0]));
          const ctrl = mods !== undefined && ((mods - 1) & 4) !== 0;
          if (code === 13 && !now.pasting) ({ line: now, submitted } = submit(now, submitted));
          else if (code === 127 || code === 8) now = backspace(now);
          else if (ctrl && (code === 99 || code === 117)) now = { ...now, text: "" };
          else if (code !== undefined && code >= 0x20 && !ctrl) now = append(now, String.fromCodePoint(code));
        }
        i += csi[0].length;
        continue;
      }
      // SS3 (ESC O x) and an Alt-chord (ESC x): dropped.
      i += rest.startsWith("\x1bO") ? 3 : 2;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (now.pasting) now = append(now, "\n");
      else ({ line: now, submitted } = submit(now, submitted));
    } else if (c === "\x7f" || c === "\b") {
      now = backspace(now);
    } else if (c === "\x03" || c === "\x15") {
      now = { ...now, text: "" };
    } else if (c >= " ") {
      now = append(now, c);
    }
    i += 1;
  }
  return { line: now, submitted };
}

/** Enter: the line so far, trimmed, if anything was typed; the last Enter in a chunk wins. */
function submit(line: Line, before: string | null): { line: Line; submitted: string | null } {
  const text = line.text.trim();
  return { line: EMPTY, submitted: text === "" ? before : text };
}
