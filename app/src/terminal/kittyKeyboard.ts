// Tracks the kitty keyboard protocol flags the program in the terminal has asked for, because
// xterm.js 6.0.0 does not implement the protocol (task 1.5, PRD §7 Q3).
//
//   CSI > flags u      push flags
//   CSI < n u          pop n entries (default 1)
//   CSI = flags ; m u  set the current entry: m=1 replace (default), 2 set bits, 3 clear bits
//   CSI ? u            query; answered with CSI ? flags u
//
// The main and alternate screens keep separate stacks (CSI ? 1049/1047/47 h|l switch between them),
// and a full reset (ESC c) clears both. Sequences may be split across output chunks.

const ESC = 0x1b;
const MAX_STACK = 64;
/** Longest partial sequence carried to the next chunk; anything longer cannot be one we track. */
const MAX_PENDING = 32;

export class KittyKeyboardTracker {
  private stacks: [number[], number[]] = [[], []];
  private alternate = 0;
  private pending: number[] = [];

  /** Current flags for the active screen; 0 means the program has not enabled the protocol. */
  get flags(): number {
    const stack = this.stacks[this.alternate]!;
    return stack.length ? stack[stack.length - 1]! : 0;
  }

  /** Forget everything, e.g. when the child process exits and a new one starts. */
  reset(): void {
    this.stacks = [[], []];
    this.alternate = 0;
    this.pending = [];
  }

  /** Scans one chunk of PTY output. Returns replies that must be written back to the PTY. */
  feed(chunk: Uint8Array): string[] {
    const replies: string[] = [];
    const bytes = this.pending.length ? [...this.pending, ...chunk] : chunk;
    this.pending = [];
    const n = bytes.length;
    let i = 0;
    while (i < n) {
      if (bytes[i] !== ESC) {
        i++;
        continue;
      }
      if (i + 1 >= n) {
        this.pending = [ESC];
        break;
      }
      const next = bytes[i + 1];
      if (next === 0x63 /* c: full reset */) {
        this.stacks = [[], []];
        this.alternate = 0;
        i += 2;
        continue;
      }
      if (next !== 0x5b /* [ */) {
        i++;
        continue;
      }
      // CSI: optional private marker, parameters, one final byte in 0x40..0x7e.
      let j = i + 2;
      while (j < n && bytes[j]! >= 0x20 && bytes[j]! <= 0x3f) j++;
      if (j >= n) {
        const partial = Array.from(bytes.slice(i, n) as ArrayLike<number>);
        if (partial.length <= MAX_PENDING) this.pending = partial;
        break;
      }
      const final = bytes[j]!;
      const body = String.fromCharCode(...(bytes.slice(i + 2, j) as ArrayLike<number> as number[]));
      const reply = this.apply(body, final);
      if (reply) replies.push(reply);
      i = j + 1;
    }
    return replies;
  }

  private apply(body: string, final: number): string | undefined {
    if (final === 0x75 /* u */) {
      const marker = body[0];
      const params = body.slice(1).split(";");
      const stack = this.stacks[this.alternate]!;
      if (marker === ">") {
        const flags = toInt(params[0], 0);
        if (stack.length >= MAX_STACK) stack.shift();
        stack.push(flags);
      } else if (marker === "<") {
        const count = Math.max(1, toInt(params[0], 1));
        stack.splice(Math.max(0, stack.length - count), count);
      } else if (marker === "=") {
        const flags = toInt(params[0], 0);
        const mode = toInt(params[1], 1);
        const current = stack.length ? stack[stack.length - 1]! : 0;
        const value = mode === 2 ? current | flags : mode === 3 ? current & ~flags : flags;
        if (stack.length) stack[stack.length - 1] = value;
        else stack.push(value);
      } else if (marker === "?" && body.length === 1) {
        return `\x1b[?${this.flags}u`;
      }
      return undefined;
    }
    if ((final === 0x68 /* h */ || final === 0x6c /* l */) && body[0] === "?") {
      const modes = body.slice(1).split(";");
      if (modes.some((m) => m === "1049" || m === "1047" || m === "47")) {
        this.alternate = final === 0x68 ? 1 : 0;
      }
    }
    return undefined;
  }
}

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
