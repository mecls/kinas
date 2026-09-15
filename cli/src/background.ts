// The launch screen draws from the cache and hands the slow reading to a detached `kinas context --refresh`, so the
// banner never waits on a source. The child outlives the screen; the next launch shows what it found.

import { spawn } from "node:child_process";

/** How to run this CLI again: the compiled binary alone, or bun with the script when run from source. */
export function selfCommand(argv: readonly string[] = process.argv, execPath: string = process.execPath): string[] {
  const script = argv[1];
  const fromSource = script !== undefined && !script.startsWith("/$bunfs/") && /\.(ts|tsx|js|mjs)$/.test(script);
  return fromSource ? [execPath, script] : [execPath];
}

/** Starts a refresh that holds the lease the caller already claimed. */
export function spawnRefresh(): void {
  const [cmd, ...args] = [...selfCommand(), "context", "--refresh"];
  try {
    const child = spawn(cmd!, args, { detached: true, stdio: "ignore", env: { ...process.env, KINAS_REFRESH_LEASE: "held" } });
    // A spawn failure arrives as an 'error' event; unheard, it would crash the screen that is still printing.
    (child as unknown as NodeJS.EventEmitter).on("error", () => {});
    child.unref();
  } catch {
    // Best-effort: the next `kinas context` computes the packet itself.
  }
}
