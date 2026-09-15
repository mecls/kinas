// The launch screen holds on a terminal until Enter, q or Ctrl+C (CLI v0 brief: it exits on q and Ctrl+C; keymap.md).
// This is the only place the CLI reads keys. Tab, arrows and every other key are ignored, never acted on.

export type LaunchKey = "enter" | "quit";

/** Where the escape sequence starting at `i` ends: CSI (ESC [ … final byte), SS3 (ESC O x), or an Alt chord (ESC x). */
function afterEscape(input: string, i: number): number {
  const next = input[i + 1];
  if (next === "[") {
    let j = i + 2;
    while (j < input.length) {
      const code = input.charCodeAt(j);
      if (code >= 0x40 && code <= 0x7e) break;
      j++;
    }
    return j + 1;
  }
  if (next === "O") return i + 3;
  return i + 2;
}

/**
 * What a chunk of raw terminal input means to the launch screen, if anything. Keys can arrive together (an arrow and
 * Ctrl+C in one read), so escape sequences are skipped one by one rather than ending the chunk: an arrow that ends in
 * "Q" or an Alt+q is not a command, and the Ctrl+C after it still is.
 */
export function launchKey(input: string): LaunchKey | null {
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "\x1b") {
      i = afterEscape(input, i);
      continue;
    }
    if (ch === "\r" || ch === "\n") return "enter";
    if (ch === "q" || ch === "Q" || ch === "\x03") return "quit";
    i++;
  }
  return null;
}

/** Waits in raw mode for Enter, q or Ctrl+C, then puts the terminal back as it was. */
export function waitForLaunchKey(stdin: NodeJS.ReadStream = process.stdin): Promise<LaunchKey> {
  return new Promise((resolve) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk: Buffer) => {
      const key = launchKey(chunk.toString("utf8"));
      if (!key) return;
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      resolve(key);
    };
    stdin.on("data", onData);
  });
}
