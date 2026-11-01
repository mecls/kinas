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

/**
 * Where git looks for a repository, its index and its objects instead of finding them from its folder: git's own
 * `git rev-parse --local-env-vars`, less its config settings, which say how to read and not what. Git exports these to
 * every hook it runs (GIT_INDEX_FILE for a commit, GIT_DIR in a bare repository), and an agent session a hook starts
 * runs `kinas context` with them — so each project would be read as the hook's repository.
 */
const REPOSITORY_VARS = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_GRAFT_FILE",
  "GIT_SHALLOW_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
]);

/** The environment the packet's git plumbing runs with: the caller's, minus REPOSITORY_VARS, with optional locks off. */
export function gitEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (!REPOSITORY_VARS.has(k)) out[k] = v;
  return { ...out, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
}

/** NUL-separated output, without the trailing empty entry. */
export function splitZ(text: string): string[] {
  return text.split("\0").filter((s) => s !== "");
}
