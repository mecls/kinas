// Runs a read-only helper (git plumbing, Firstmate's snapshot) with a hard deadline. On timeout it returns at once,
// even if a grandchild still holds the pipes open.

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Why the command did not run or finish; null when it exited on its own. */
  error: string | null;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  stdin?: string;
}

export async function run(cmd: string[], opts: RunOptions): Promise<RunResult> {
  let proc: Bun.Subprocess<Blob | "ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e) {
    return { ok: false, code: null, stdout: "", stderr: "", timedOut: false, error: (e as Error).message };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), opts.timeoutMs);
  });
  const finished = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const outcome = await Promise.race([finished, late]);
  clearTimeout(timer);

  if (outcome === "late") {
    proc.kill("SIGKILL");
    return { ok: false, code: null, stdout: "", stderr: "", timedOut: true, error: `timed out after ${opts.timeoutMs} ms` };
  }
  const [stdout, stderr, code] = outcome;
  return { ok: code === 0, code, stdout, stderr, timedOut: false, error: null };
}

/** NUL-separated output, without the trailing empty entry. */
export function splitZ(text: string): string[] {
  return text.split("\0").filter((s) => s !== "");
}
