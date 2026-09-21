// The Kinas look, shared by every command (CLI v0 brief): one set of tones, one set of glyphs, one banner. Colour only
// on a TTY, never with NO_COLOR.
//
// A terminal's ground is dark or light and a program cannot always know which: Herdr's session outlives the app, so
// nothing the Kinas pane sets reaches a shell inside it. So only what reads on BOTH grounds is painted exactly, in
// 24-bit: royal blue, crimson, and the logo, which brings its own disc. Text rides the terminal's own colours —
// primary text is the foreground, secondary text is ANSI bright black, gold is ANSI yellow. In the Kinas pane those
// slots are --white, --muted and --gold on either ground (app/src/styles/tokens.css, held there by tokens.test.ts), so
// the pane draws the brief's colours; anywhere else the text takes that terminal's colours and can always be read.

import { LOGO_GRID } from "./logo-grid.ts";

/** What is painted exactly, whatever the terminal. */
export const palette = {
  /** Structure and headings. */
  blue: "#00549E",
  /** The logo's dots. Primary text is not painted: it is the terminal's foreground. */
  white: "#F4F2EC",
  /** Something needs a decision or is failing — nothing else. */
  crimson: "#C4262E",
} as const;

/** `white` is primary text, `muted` secondary; `gold` is the crew and warnings, and nothing else. */
export type Tone = "blue" | "white" | "muted" | "crimson" | "gold";

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

/** The SGR colour of each tone: 24-bit for the two brand colours, an ANSI slot for the rest, nothing for primary text. */
const SGR: Record<Tone, string> = {
  blue: `38;2;${rgb(palette.blue)}`,
  crimson: `38;2;${rgb(palette.crimson)}`,
  muted: "90",
  gold: "33",
  white: "",
};

/** Gold is never bold: a terminal draws bold ANSI yellow in the bright slot, which is another colour. */
export function paint(tone: Tone, text: string, color: boolean, bold = false): string {
  if (!color || text === "") return text;
  const codes = [bold && tone !== "gold" ? "1" : "", SGR[tone]].filter((code) => code !== "").join(";");
  return codes === "" ? text : `\x1b[${codes}m${text}\x1b[0m`;
}

/** The banner's face in blue, its shadow in the muted tone. */
export function bannerLines(color: boolean): string[] {
  if (!color) return [...BANNER];
  return BANNER.map((line) => line.replace(/█+|[^█]+/g, (run) => (run.startsWith("█") ? paint("blue", run, true) : paint("muted", run, true))));
}

/** The ground a terminal draws on. Only the logo needs to know: everything else reads on both (the header says how). */
export type Polarity = "dark" | "light";

/** The ground, from `COLORFGBG` ("fg;bg", which rxvt, Konsole and iTerm set, and the Kinas pane writes on the launch
 *  screen's command line). Read by vim's rule: the last field is the background, and 7 or 9–15 is a light one. Dark
 *  when it is missing or says anything else, because a wrong "dark" still draws a logo that can be read. */
export function polarityFromEnv(env: Record<string, string | undefined> = process.env): Polarity {
  const background = env.COLORFGBG?.split(";").at(-1) ?? "";
  if (!/^\d+$/.test(background)) return "dark";
  const slot = Number(background);
  return slot === 7 || (slot >= 9 && slot <= 15) ? "light" : "dark";
}

/** The logo: warm-white dots on its disc, navy on a dark ground and royal blue on a light one. Every line is
 *  LOGO_WIDTH wide, and without colour it is the same logo on either ground. */
export function logoLines(color: boolean, polarity: Polarity = "dark"): string[] {
  const size = LOGO_GRID.length;
  const disc = polarity === "light" ? palette.blue : LOGO_NAVY;
  const lines: string[] = [];
  for (let cy = 0; cy < size; cy += 4) {
    let line = "";
    let run = "";
    // The same characters with the disc's unlit dots raised instead of the lit ones.
    let inverse = "";
    let runOnDisc = false;
    const flush = () => {
      if (run === "") return;
      if (!color) line += run;
      else if (runOnDisc) line += `\x1b[38;2;${rgb(palette.white)};48;2;${rgb(disc)}m${run}\x1b[0m`;
      // The rim has no background to stand on. On a dark ground its warm-white dots show as they are. On a light one
      // they would vanish, so the rim draws the disc itself in blue and the ground shows through as the dots.
      else if (polarity === "light") line += `\x1b[38;2;${rgb(disc)}m${inverse}\x1b[0m`;
      else line += `\x1b[38;2;${rgb(palette.white)}m${run}\x1b[0m`;
      run = "";
      inverse = "";
    };
    for (let cx = 0; cx < size; cx += 2) {
      let lit = 0;
      let unlit = 0;
      let covered = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cell = LOGO_GRID[cy + dy]?.[cx + dx] ?? " ";
          if (cell === "#") lit |= BRAILLE_BIT[dy]![dx]!;
          if (cell === ".") unlit |= BRAILLE_BIT[dy]![dx]!;
          if (cell !== " ") covered++;
        }
      }
      // A character mostly on the disc takes the disc's background; the rim's stay on the terminal's own ground.
      const onDisc = covered >= 6;
      if (onDisc !== runOnDisc) {
        flush();
        runOnDisc = onDisc;
      }
      run += String.fromCharCode(0x2800 + lit);
      inverse += String.fromCharCode(0x2800 + unlit);
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
