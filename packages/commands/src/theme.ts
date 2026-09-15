// The Kinas look, shared by every command (CLI v0 brief): one palette, one set of glyphs, one banner, so the CLI looks
// the same in the app's terminal pane, in any emulator and over SSH. Colour is 24-bit ANSI, only on a TTY, never
// with NO_COLOR.

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

/** The single crimson accent line beneath the banner. */
export function accentLine(width: number, color: boolean): string {
  return paint("crimson", glyph.rule.repeat(width), color);
}

/** Printed width of a string: ANSI stripped, wide characters counted twice. */
export function visibleWidth(text: string): number {
  return Bun.stringWidth(text);
}
