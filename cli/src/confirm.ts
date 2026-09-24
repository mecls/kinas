// The CLI's one y/N (build spec §11.2, decision 8 of the architecture): `kinas crew setup` asks before each step and
// reads one line. y or yes, in any case, is yes; anything else — an empty line, n, end of input — is no. Besides hold.ts
// (the launch screen), this is the only CLI source that reads the keyboard, and only a line at a time on a terminal.

import { createInterface } from "node:readline";

export interface Io {
  write(text: string): void;
  /** One line of input without its newline, or null at the end of input. */
  readLine(): Promise<string | null>;
}

export async function confirm(question: string, io: Io): Promise<boolean> {
  io.write(`${question} [y/N] `);
  const line = await io.readLine();
  return line !== null && /^(y|yes)$/i.test(line.trim());
}

/** The terminal: stdout for questions, stdin for answers, one line per question. */
export function terminalIo(): Io & { close(): void } {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  let ended = false;
  return {
    write: (text) => void process.stdout.write(text),
    async readLine() {
      if (ended) return null;
      const next = await lines.next();
      if (next.done) {
        ended = true;
        return null;
      }
      return next.value;
    },
    close: () => rl.close(),
  };
}
