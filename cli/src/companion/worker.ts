// Firstmate's workers in Claude Code's sandbox (ADR 0027; build spec §12 slices 4.9–4.10; answer-path-design.md).
//
// - `workerPolicy`: what every worker's settings hold, the captain's list of denied paths and hosts in full.
// - `workerLaunch` (`kinas companion worker-launch <id> <cwd> <claude's argv…>`): run by Kinas's wrapper before a worker
//   starts. It checks the task id and Firstmate's arguments and the machine's sandbox pieces, creates the task's status
//   file, and writes the worker's settings file: Firstmate's own settings, only the keys Kinas lets through, with the
//   policy over them. It prints the file's SHA-256 and its path; any refusal stops the worker.
// - `wrapperText`: the wrapper itself, a POSIX sh script Kinas writes at ~/.local/share/kinas/bin/claude.
// - `workerCheck`: the captain's condition 1, read from /proc. Every worker must run under the policy, proven: the
//   wrapper's marker, the exact flags, its settings file unchanged and equal to today's policy, and every tool command
//   it ran outside the host's PID namespace under the seccomp filter. Every other process of the user in the host's
//   namespace that carries FM_TASK_ID must be one of a proven worker's own, or a launch step. The machine's sandbox
//   pieces must be there and no user or managed setting may reach into the sandbox. One failure and no answer is
//   written (firstmate.ts's gate on `note`); the Settings row says which and why.

import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Paths } from "./paths.ts";
import { childrenOf, descendants, ownPidNs, readProcs, type Proc } from "./proc.ts";
import { archOf, claudeExe, cloned, HERDR_UNIT, readText, UNIT_HEADER, type Check, type SetupDeps } from "./setup.ts";
import { isKinasCopy, writeWhole } from "./written.ts";

/** The hosts a worker may reach (the captain's condition 3): GitHub and the npm, crates and PyPI registries. */
export const WORKER_HOSTS = [
  "github.com",
  "api.github.com",
  "registry.npmjs.org",
  "index.crates.io",
  "static.crates.io",
  "crates.io",
  "pypi.org",
  "files.pythonhosted.org",
] as const;

/**
 * Paths no worker may read, the captain's (conditions 2, and the late-night answers): always listed in full, there or
 * not — measured, a path that is not there neither stops the start nor stays readable once made.
 */
export const RESERVED_READS = [
  "~/vault/**",
  "~/.config/last30days/**",
  "~/.config/brain/**",
  "~/.config/search.env",
  "~/.config/parallel.env",
  "~/.config/agentwikis.env",
  "~/.local/share/com.vercel.cli/**",
  "~/.now/**",
  "~/.local/share/now/**",
  "~/.config/obsidian-headless/**",
  "~/.local/state/kinas/**",
] as const;

/** Claude Code's own records no worker may read. */
const CLAUDE_READS = [
  "~/.claude/projects/**",
  "~/.claude/history.jsonl",
  "~/.claude/paste-cache/**",
  "~/.claude/file-history/**",
  "~/.claude/sessions/**",
  "~/.claude/session-env/**",
  "~/.claude/shell-snapshots/**",
  "~/.claude/.credentials.json",
  "~/.claude.json",
  "~/.config/herdr/**",
] as const;

/** Keys the wrapper takes out of a worker's environment before it starts: keys workers have no use for. */
export const REMOVED_ENV = [
  "VERCEL_TOKEN",
  "OBSIDIAN_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "PARALLEL_API_KEY",
  "TWITTERAPI_IO_KEY",
  "YOUTUBE_API_KEY",
  "AGENTWIKIS_API_KEY",
] as const;

/** Firstmate's own settings keys a worker keeps; any other key in its `--settings` refuses the launch. */
export const FIRSTMATE_KEYS = ["feedbackDrafts", "attribution", "model", "effortLevel"] as const;

/** Flags that would load more than the captain's user settings and Kinas's: Firstmate never passes them to a worker. */
const FORBIDDEN_FLAGS = ["--setting-sources", "--mcp-config", "--strict-mcp-config", "--plugin-dir"] as const;

/** The wrapper's marker: the SHA-256 of the worker's settings file. A hash, not a secret. */
export const MARKER = "KINAS_WORKER_POLICY";
/** What every tool command's shell sources (measured, Claude Code 2.1.332): how a tool command is told from a helper. */
export const SNAPSHOT_MARK = "/.claude/shell-snapshots/snapshot-";
/** The seccomp helper's package, installed globally beside Node when it is not there. */
export const SANDBOX_RUNTIME = { name: "@anthropic-ai/sandbox-runtime", version: "0.0.83" } as const;
/** The wrapper's exit when a worker cannot start sandboxed (EX_CONFIG). */
export const REFUSED_EXIT = 78;

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHELLS = new Set(["sh", "dash", "bash"]);

export const validTaskId = (id: string) => TASK_ID.test(id);

/** Claude Code's name for a folder's temporary folder: every character but a letter or a digit as `-`. */
export const tempName = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

export function settingsFile(paths: Pick<Paths, "workers">, id: string): string {
  return join(paths.workers, `${id}.settings.json`);
}

export interface PolicyOf {
  /** Firstmate's home, absolute. */
  home: string;
  id: string;
  uid: number;
  /** `/tmp` on a machine. */
  tmp: string;
}

/** The policy, as answer-path-design.md "The policy each worker gets" with the captain's conditions. */
export function workerPolicy(o: PolicyOf): Record<string, unknown> {
  const userTmp = `${o.tmp}/claude-${o.uid}`;
  const mate = `${userTmp}/${tempName(o.home)}`;
  const caches = `${userTmp}/kinas-${o.id}`;
  return {
    permissions: {
      blockWritesOutsideWorkingDirectories: true,
      deny: [
        ...CLAUDE_READS.map((p) => `Read(${p})`),
        `Read(/${mate}/**)`,
        `Edit(/${mate}/**)`,
        ...RESERVED_READS.map((p) => `Read(${p})`),
        `Edit(/${o.home}/.agents/**)`,
        `Edit(/${o.home}/state/operational-inbox/**)`,
        "Edit(**/.mcp.json)",
        "Edit(**/.claude/**)",
      ],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: { allowWrite: [`${o.home}/state/${o.id}.status`] },
      network: { allowedDomains: [...WORKER_HOSTS], strictAllowlist: true },
    },
    // Each package manager's cache in the worker's own folder: the shared ones are read-only in the sandbox, and a
    // package planted there would later be installed by the captain's own sessions, outside it.
    env: {
      npm_config_cache: `${caches}/npm`,
      BUN_INSTALL_CACHE_DIR: `${caches}/bun`,
      PIP_CACHE_DIR: `${caches}/pip`,
      UV_CACHE_DIR: `${caches}/uv`,
      CARGO_HOME: `${caches}/cargo`,
    },
  };
}

/** Firstmate's inline `--settings` value with the policy over it; any key Kinas does not let through refuses. */
export function mergeSettings(firstmate: string, policy: Record<string, unknown>): { settings: Record<string, unknown> } | { refused: string } {
  let given: unknown;
  try {
    given = JSON.parse(firstmate);
  } catch {
    return { refused: "Firstmate's --settings is not inline JSON" };
  }
  if (typeof given !== "object" || given === null || Array.isArray(given)) return { refused: "Firstmate's --settings is not a JSON object" };
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(given)) {
    if (!(FIRSTMATE_KEYS as readonly string[]).includes(k)) return { refused: `Firstmate's --settings carries ${k}, which Kinas does not pass to a sandboxed worker` };
    kept[k] = v;
  }
  return { settings: { ...kept, ...policy } };
}

export const settingsText = (settings: Record<string, unknown>) => `${JSON.stringify(settings, null, 2)}\n`;
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Firstmate's `--settings` value from a worker's argv: exactly one, spelled apart from its value, and no flag that loads more. */
export function settingsArg(argv: readonly string[]): { value: string } | { refused: string } {
  for (const a of argv) {
    if (a.startsWith("--settings=")) return { refused: "--settings is joined to its value" };
    if (FORBIDDEN_FLAGS.some((f) => a === f || a.startsWith(`${f}=`))) return { refused: `Firstmate passed ${a.split("=")[0]}` };
  }
  const at = argv.flatMap((a, i) => (a === "--settings" ? [i] : []));
  if (at.length !== 1) return { refused: `Firstmate passed --settings ${at.length} times, not once` };
  const value = argv[at[0]! + 1];
  return value === undefined ? { refused: "--settings has no value" } : { value };
}

export type WorkerDeps = Pick<SetupDeps, "paths" | "uid" | "home" | "node" | "arch" | "which">;

/** The seccomp helper Claude Code uses on Linux, beside Node's global packages; null without Node or a known arch. */
export function seccompHelper(d: Pick<SetupDeps, "node" | "arch">): string | null {
  const arch = archOf(d.arch);
  if (d.node === null || arch === null) return null;
  return join(d.node, "..", "lib", "node_modules", "@anthropic-ai", "sandbox-runtime", "vendor", "seccomp", arch, "apply-seccomp");
}

function isFile(path: string | null): boolean {
  if (path === null) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** What the machine lacks for the sandbox: `bwrap`, `socat`, the seccomp helper. */
export function missingPieces(d: WorkerDeps): string[] {
  const out: string[] = [];
  if (d.which("bwrap") === null) out.push("bwrap");
  if (d.which("socat") === null) out.push("socat");
  if (!isFile(seccompHelper(d))) out.push("the seccomp helper");
  return out;
}

export type Launch = { file: string; sha256: string } | { refused: string };

/** `kinas companion worker-launch`: everything a worker needs before it starts, or why it must not. */
export function workerLaunch(d: WorkerDeps, env: Record<string, string | undefined>, id: string, cwd: string, argv: readonly string[]): Launch {
  if (!validTaskId(id)) return { refused: "FM_TASK_ID is not a task id" };
  if (!cwd.startsWith("/") || !existsSync(cwd) || !statSync(cwd).isDirectory()) return { refused: "the worker's folder is not there" };
  const home = d.paths.home;
  if (env.FM_HOME !== undefined && env.FM_HOME !== "" && realOr(env.FM_HOME) !== realOr(home)) return { refused: "FM_HOME is not Kinas's Firstmate home" };
  const arg = settingsArg(argv);
  if ("refused" in arg) return arg;
  const missing = missingPieces(d);
  if (missing.length > 0) return { refused: `${missing.join(", ")} missing: the sandbox would not hold` };
  const merged = mergeSettings(arg.value, workerPolicy({ home, id, uid: d.uid, tmp: d.paths.tmp }));
  if ("refused" in merged) return merged;
  // On Linux a sandbox can only allow writing a file that exists: the task's status file is made before the start.
  const state = join(home, "state");
  if (!existsSync(state) || !statSync(state).isDirectory()) return { refused: "Firstmate's home has no state folder" };
  try {
    closeSync(openSync(join(state, `${id}.status`), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o644));
  } catch {
    return { refused: "the task's status file can't be made" };
  }
  const text = settingsText(merged.settings);
  try {
    mkdirSync(d.paths.workers, { recursive: true, mode: 0o700 });
    writeWhole(settingsFile(d.paths, id), text, 0o600);
  } catch {
    return { refused: "the worker's settings file can't be written" };
  }
  return { file: settingsFile(d.paths, id), sha256: sha256(text) };
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Kinas's wrapper, with the real Claude Code and Kinas's own binary filled in. */
export function wrapperText(realClaude: string, kinas: string): string {
  return `#!/bin/sh
# Written by \`kinas companion install\` (Kinas, the factory in the cloud; ADR 0027). Kinas rewrites this file.
# Without FM_TASK_ID this is Claude Code itself. A Firstmate worker (FM_TASK_ID set, even empty) starts only in Claude
# Code's sandbox: \`kinas companion worker-launch\` writes its settings, and any failure stops it here.
REAL=${sq(realClaude)}
KINAS=${sq(kinas)}
if [ -z "\${FM_TASK_ID+x}" ]; then
  exec "$REAL" "$@"
fi
unset ${REMOVED_ENV.join(" ")}
out=$("$KINAS" companion worker-launch "$FM_TASK_ID" "$PWD" "$@") || {
  echo "kinas: this worker did not start: it would run outside Kinas's sandbox" >&2
  exit ${REFUSED_EXIT}
}
nl='
'
sum=\${out%%"$nl"*}
file=\${out#*"$nl"}
if [ -z "$sum" ] || [ -z "$file" ] || [ "$sum" = "$out" ]; then
  echo "kinas: this worker did not start: Kinas's answer was not read" >&2
  exit ${REFUSED_EXIT}
fi
n=$#
next=0
for a do
  if [ "$next" = 1 ]; then
    set -- "$@" "$file"
    next=0
  else
    set -- "$@" "$a"
    if [ "$a" = --settings ]; then next=1; fi
  fi
done
shift "$n"
${MARKER}=$sum
CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1
export ${MARKER} CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD
exec "$REAL" --setting-sources user --strict-mcp-config --add-dir "$PWD" "$@"
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The runtime check (the captain's condition 1).

export interface Verdict {
  /** Each a sentence for the row: the task first where there is one. Empty: every worker proven, answers may flow. */
  problems: string[];
  /** Workers proven. */
  workers: number;
  /** Herdr servers found, and whether each has the wrapper first on its PATH. */
  servers: { pid: number; wrapped: boolean }[];
}

/** Sandbox keys a user or managed setting may hold without reaching into a worker's sandbox. */
const HARMLESS_SANDBOX_KEYS = new Set(["enabled", "failIfUnavailable", "autoAllowBashIfSandboxed"]);

/** The keys of a settings file's `sandbox` that would loosen a worker's: a file that can't be read as JSON loosens. */
export function looseningKeys(text: string | null): string[] {
  if (text === null) return [];
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return ["(not JSON)"];
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return ["(not an object)"];
  const sandbox = (doc as Record<string, unknown>).sandbox;
  if (sandbox === undefined) return [];
  if (typeof sandbox !== "object" || sandbox === null || Array.isArray(sandbox)) return ["sandbox"];
  return Object.entries(sandbox)
    .filter(([k, v]) => !HARMLESS_SANDBOX_KEYS.has(k) || (k !== "autoAllowBashIfSandboxed" && v !== true))
    .map(([k]) => `sandbox.${k}`);
}

/** Firstmate's crew harness (`config/crew-harness`, as `fm-harness.sh crew` reads it): absent and `default` are its own. */
export function crewHarness(home: string): string {
  const text = readText(join(home, "config", "crew-harness"));
  const h = text === null ? "" : text.replace(/\s/g, "");
  return h === "" || h === "default" ? "claude" : h;
}

const mentionsClaude = (p: Proc) => (p.cmdline ?? []).slice(0, 2).some((a) => basename(a) === "claude" || a.includes("/claude/versions/"));

/** The flags the wrapper puts first, and Firstmate's one `--settings`, now Kinas's file. */
export function launchedByWrapper(cmdline: readonly string[], file: string): boolean {
  if (cmdline[1] !== "--setting-sources" || cmdline[2] !== "user" || cmdline[3] !== "--strict-mcp-config" || cmdline[4] !== "--add-dir" || cmdline[5] === undefined) return false;
  const rest = cmdline.slice(6);
  const arg = settingsArg(rest);
  return !("refused" in arg) && arg.value === file;
}

function judgeWorker(d: WorkerDeps, p: Proc, id: string): string | null {
  if (!validTaskId(id)) return `a worker's FM_TASK_ID is not a task id`;
  const marker = p.environ?.get(MARKER);
  if (marker === undefined) return `${id}: started outside Kinas's sandbox`;
  if (p.cmdline === null) return `${id}: its command line can't be read`;
  const file = settingsFile(d.paths, id);
  if (!launchedByWrapper(p.cmdline, file)) return `${id}: started outside Kinas's sandbox`;
  const text = readText(file);
  if (text === null) return `${id}: its settings file is gone`;
  if (sha256(text) !== marker) return `${id}: its settings file changed since it started`;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return `${id}: its settings file is not JSON`;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return `${id}: its settings file is not a JSON object`;
  const policy = workerPolicy({ home: d.paths.home, id, uid: d.uid, tmp: d.paths.tmp });
  for (const k of Object.keys(doc)) {
    if (!(k in policy) && !(FIRSTMATE_KEYS as readonly string[]).includes(k)) return `${id}: its settings carry ${k}`;
  }
  for (const [k, v] of Object.entries(policy)) {
    if (JSON.stringify((doc as Record<string, unknown>)[k]) !== JSON.stringify(v)) return `${id}: its settings aren't Kinas's policy today`;
  }
  return null;
}

/**
 * A tool command: the shell Claude Code starts to run one, `<shell> -c <script>` whose own script sources the shell
 * snapshot (`exec 3<&- || exit 126; source ~/.claude/shell-snapshots/snapshot-…`). The sandbox's own steps carry that
 * script without running it: the `/bin/sh -c { … }` launcher at its fifth argument and `bwrap` at its last, both in the
 * host's namespace; and inside, the network bridge (`{ socat … }`, no seccomp filter by design), nested in its own
 * `/proc/self/fd/3 /bin/bash -c '…'`. None of them is a tool command. Should the bridge ever exec the tool's script
 * itself, that process is one, and without the filter it is red. Measured on the home lab, 2026-11-25, in the
 * acceptance run.
 */
export function isToolCommand(cmdline: readonly string[] | null): boolean {
  if (cmdline === null || cmdline[1] !== "-c") return false;
  const script = cmdline[2] ?? "";
  const at = script.indexOf(SNAPSHOT_MARK);
  return at >= 0 && !/\s-c\s/.test(script.slice(0, at));
}

/** Every worker on the machine now, proven or not, and the machine's own pieces. Synchronous: it runs before a note. */
export function workerCheck(d: WorkerDeps): Verdict {
  const problems: string[] = [];
  const ns = ownPidNs(d.paths.proc);
  if (ns === null) return { problems: ["/proc can't be read: no worker can be proven sandboxed"], workers: 0, servers: [] };
  const procs = readProcs(d.paths.proc, d.uid);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = childrenOf(procs);
  const isClaude = claudeExe(d.paths.realClaude);
  const kinas = realOr(join(d.paths.bin, "kinas"));
  const wrapper = join(d.paths.wrapperDir, "claude");
  const herdr = realOr(d.paths.herdr);

  const proven = new Map<number, string>();
  const others: Proc[] = [];
  const servers: { pid: number; wrapped: boolean }[] = [];
  for (const p of procs) {
    if (p.pidNs !== ns) continue;
    if (p.exe !== null && realOr(p.exe) === herdr && (p.cmdline ?? []).includes("server")) {
      const path = p.environ?.get("PATH") ?? null;
      servers.push({ pid: p.pid, wrapped: path !== null && path.split(":")[0] === d.paths.wrapperDir });
    }
    if (p.environ === null || p.exe === null) {
      if (mentionsClaude(p)) problems.push(`a Claude Code process (pid ${p.pid}) can't be read`);
      continue;
    }
    const id = p.environ.get("FM_TASK_ID");
    if (id === undefined) continue;
    if (!isClaude(p.exe)) {
      others.push(p);
      continue;
    }
    const why = judgeWorker(d, p, id);
    if (why === null) proven.set(p.pid, id);
    else problems.push(why);
  }

  // A proven worker's own processes: its helpers and the captain's hooks stay in the host's namespace; a tool command
  // must not.
  const ownedBy = new Map<number, number>();
  for (const [pid, id] of proven) {
    const own = descendants(pid, kids);
    for (const c of own) ownedBy.set(c.pid, pid);
    const outside = own.some((c) => c.exe !== null && !isClaude(c.exe) && isToolCommand(c.cmdline) && (c.pidNs === null || c.pidNs === ns || c.seccomp !== 2 || c.noNewPrivs !== 1));
    if (outside) problems.push(`${id}: a tool command ran outside the sandbox`);
  }

  // Every other process with FM_TASK_ID in the host's namespace: a proven worker's own, or a launch step on its way to
  // becoming one. Anything else is a worker Kinas cannot see the sandbox of — another harness, another Claude Code.
  for (const p of others) {
    if (ownedBy.has(p.pid)) continue;
    const c = p.cmdline ?? [];
    const name = basename(p.exe ?? "");
    const wrapperStep = SHELLS.has(name) && c[1] === wrapper;
    const launchStep = p.exe !== null && realOr(p.exe) === kinas && c[1] === "companion" && c[2] === "worker-launch";
    const envStep = name === "env";
    if (wrapperStep || launchStep || envStep) continue;
    problems.push(`${p.environ?.get("FM_TASK_ID") ?? "a task"}: ${name || "a process"} runs outside Kinas's sandbox`);
  }

  const missing = missingPieces(d);
  if (missing.length > 0) problems.push(`${missing.join(", ")} missing: workers can't be sandboxed`);
  const user = looseningKeys(readText(join(d.paths.claudeHome, "settings.json")));
  if (user.length > 0) problems.push(`your ~/.claude/settings.json sets ${user.join(", ")}, which reaches every worker's sandbox`);
  const managed = looseningKeys(readText(d.paths.managedSettings));
  if (managed.length > 0) problems.push(`the machine's managed settings set ${managed.join(", ")}, which reaches every worker's sandbox`);
  if (cloned(d.paths.home)) {
    const harness = crewHarness(d.paths.home);
    if (harness !== "claude") problems.push(`Firstmate's crew harness is ${harness}: only Claude Code workers run in Kinas's sandbox`);
  }
  for (const s of servers) if (!s.wrapped) problems.push("Herdr's server started without Kinas's wrapper: a new worker would run outside the sandbox");
  return { problems: [...new Set(problems)], workers: proven.size, servers };
}

/** The gate before a note (firstmate.ts): every worker proven, now. */
export function answersMayFlow(d: WorkerDeps): { ok: true } | { refused: string } {
  const v = workerCheck(d);
  return v.problems.length === 0 ? { ok: true } : { refused: `${v.problems[0]} — no answers are sent until it ends` };
}

// ---------------------------------------------------------------------------------------------------------------------
// The setup row and its install.

/** The PATH Kinas's Herdr unit sets: the wrapper's folder first once Kinas's wrapper is there. */
export async function herdrUnitPath(d: Pick<SetupDeps, "paths" | "home">, base: string): Promise<string> {
  const wrapper = join(d.paths.wrapperDir, "claude");
  return (await isKinasCopy(d.paths, wrapper)) ? `${d.paths.wrapperDir}:${base}` : base;
}

/** The PATH in Kinas's Herdr unit file, or null when the unit is not there or not Kinas's. */
export function unitPathOf(d: Pick<SetupDeps, "paths">): string | null {
  const text = readText(join(d.paths.units, HERDR_UNIT));
  if (text === null || !text.startsWith(UNIT_HEADER)) return null;
  return /^Environment=PATH=(.*)$/m.exec(text)?.[1] ?? null;
}

export type WrapperState = "kinas" | "foreign" | "old" | "none";

export async function wrapperState(d: Pick<SetupDeps, "paths">): Promise<WrapperState> {
  const file = join(d.paths.wrapperDir, "claude");
  const text = readText(file);
  if (text === null) return existsSync(file) ? "foreign" : "none";
  if (!(await isKinasCopy(d.paths, file))) return "foreign";
  return text === wrapperText(d.paths.realClaude, join(d.paths.bin, "kinas")) ? "kinas" : "old";
}

const row = (state: Check["state"], detail: string, extra: Partial<Check> = {}): Check => ({ id: "worker-sandbox", state, detail, ...extra });

export async function workerSandboxRow(d: SetupDeps): Promise<Check> {
  if (!cloned(d.paths.home)) return row("later", "after Firstmate");
  const v = workerCheck(d);
  const wrapper = await wrapperState(d);
  const unit = unitPathOf(d);
  const tools = [d.which("bwrap") === null ? "bubblewrap" : null, d.which("socat") === null ? "socat" : null].filter((t): t is string => t !== null);
  // The action: the first setup piece missing, in the order they are put in place.
  let action: Partial<Check> = {};
  if (tools.length > 0) action = { run: `sudo apt install ${tools.join(" ")}` };
  else if (unit === null) action = {};
  else if (wrapper === "none" || wrapper === "old" || !isFile(seccompHelper(d)) || unit.split(":")[0] !== d.paths.wrapperDir) action = { install: "worker-sandbox" };
  else if (v.servers.some((s) => !s.wrapped)) action = { install: "worker-sandbox", restart: true };

  if (wrapper === "foreign") return row("bad", "a file Kinas didn't write is at ~/.local/share/kinas/bin/claude: Kinas leaves it as it is");
  if (unit === null) return row("bad", "Herdr's server isn't under Kinas's unit: run it under systemd first");
  if (v.problems.length > 0) {
    const more = v.problems.length > 1 ? ` · and ${v.problems.length - 1} more` : "";
    return row("bad", `${v.problems[0]}${more}`, action);
  }
  if (wrapper !== "kinas" || unit.split(":")[0] !== d.paths.wrapperDir) {
    return row("bad", wrapper === "kinas" ? "Herdr's unit doesn't put Kinas's wrapper first yet" : "not installed: workers would start outside the sandbox", action);
  }
  if (v.servers.length === 0) return row("ok", "Herdr isn't running: new workers start in Kinas's sandbox");
  return row("ok", v.workers === 0 ? "no workers now: new workers start in Kinas's sandbox" : `${v.workers} ${v.workers === 1 ? "worker" : "workers"}, each in Kinas's sandbox`);
}

