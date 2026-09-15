// The Kinas look, shared by every command (CLI v0 brief): one palette, one set of glyphs, one banner, so the CLI looks
// the same in the app's terminal pane, in any emulator and over SSH. Colour is 24-bit ANSI, only on a TTY, never
// with NO_COLOR.

import { LOGO_GRID } from "./logo-grid.ts";

export const palette = {
  /** Structure and headings. */
  blue: "#00549E",
  /** Primary text. */
  white: "#F4F2EC",
  /** Secondary text. */
  muted: "#8593A6",
  /** Something needs a decision or is failing — nothing else. */
  crimson: "#C4262E",
  /** The crew, and warnings — nothing else. */
  gold: "#DFAE3C",
} as const;

export type Tone = keyof typeof palette;

export const glyph = {
  sep: "·",
  working: "●",
  blocked: "▲",
  idle: "○",
  done: "✓",
  failing: "✕",
  ahead: "↑",
  behind: "↓",
  arrow: "→",
  rule: "━",
} as const;

// KINAS in block letters: a face of full blocks and a shadow of box-drawing lines, painted in two layers.
const LETTERS: readonly (readonly string[])[] = [
  ["██╗  ██╗", "██║ ██╔╝", "█████╔╝ ", "██╔═██╗ ", "██║  ██╗", "╚═╝  ╚═╝"],
  ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
  ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
  [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
];

export const BANNER: readonly string[] = LETTERS[0]!.map((_, row) => LETTERS.map((letter) => letter[row]).join(""));
export const BANNER_WIDTH = BANNER[0]!.length;

/** The logo's navy disc: the logo's own colour, used for nothing else. */
export const LOGO_NAVY = "#0A1420";
/** The logo in braille, 44x44 dots: 22 columns by 11 rows, which is square in a terminal. */
export const LOGO_WIDTH = Math.ceil(LOGO_GRID.length / 2);
export const LOGO_HEIGHT = Math.ceil(LOGO_GRID.length / 4);

// A braille character is 2 dots wide and 4 tall: the bit for the dot at [row][column].
const BRAILLE_BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

/** Colour on a TTY unless NO_COLOR; FORCE_COLOR forces it (tests, pipes into a pager). */
export function colorEnabled(stream: { isTTY?: boolean } = process.stdout, env: Record<string, string | undefined> = process.env): boolean {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY);
}

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}

export function paint(tone: Tone, text: string, color: boolean, bold = false): string {
  if (!color || text === "") return text;
  return `\x1b[${bold ? "1;" : ""}38;2;${rgb(palette[tone])}m${text}\x1b[0m`;
}

/** The banner's face in blue, its shadow in the muted tone. */
export function bannerLines(color: boolean): string[] {
  if (!color) return [...BANNER];
  return BANNER.map((line) => line.replace(/█+|[^█]+/g, (run) => (run.startsWith("█") ? paint("blue", run, true) : paint("muted", run, true))));
}

/** The logo: warm-white dots, on its navy disc when colour is on. Every line is LOGO_WIDTH wide. */
export function logoLines(color: boolean): string[] {
  const size = LOGO_GRID.length;
  const lines: string[] = [];
  for (let cy = 0; cy < size; cy += 4) {
    let line = "";
    let run = "";
    let runOnDisc = false;
    const flush = () => {
      if (run === "") return;
      if (!color) line += run;
      else if (runOnDisc) line += `\x1b[38;2;${rgb(palette.white)};48;2;${rgb(LOGO_NAVY)}m${run}\x1b[0m`;
      else line += paint("white", run, true);
      run = "";
    };
    for (let cx = 0; cx < size; cx += 2) {
      let code = 0;
      let disc = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cell = LOGO_GRID[cy + dy]?.[cx + dx] ?? " ";
          if (cell === "#") code |= BRAILLE_BIT[dy]![dx]!;
          if (cell !== " ") disc++;
        }
      }
      // A character mostly on the disc takes the navy background; the edge ones stay on the terminal's own.
      const onDisc = disc >= 6;
      if (onDisc !== runOnDisc) {
        flush();
        runOnDisc = onDisc;
      }
      run += String.fromCharCode(0x2800 + code);
    }
    flush();
    lines.push(line);
  }
  return lines;
}

/** The single crimson accent line beneath the banner. */
export function accentLine(width: number, color: boolean): string {
  return paint("crimson", glyph.rule.repeat(width), color);
}

/** Printed width of a string: ANSI stripped, wide characters counted twice. */
export function visibleWidth(text: string): number {
  return Bun.stringWidth(text);
}
