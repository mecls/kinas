// `kinas crew setup` (build spec §4 The CLI, §9, §10; AC-1): installs the crew on this Mac — Firstmate at its pin in
// Kinas's data directory, its backend, and the tools at their pinned versions — asking y/N before each thing it
// changes. It is the CLI's one exception to "read, never written" (main.ts's header), and it writes only the clone
// under the data directory, the clone's config/backend, `~/.local/bin` and npm's global prefix. Amended 2026-11-16
// (Firstmate, current; ADR 0020): and the fast-forward of a clean clone on `main` that is behind the pin, by `git merge
// --ff-only`, after a y/N and only while no first mate runs in Herdr — refused, with one line, in every other case.
//
// Every step runs with the login shell's PATH and no HERDR*. It never pipes a download into a shell, never installs a
// release whose SHA-256 is not the pinned one, never runs a tool's `setup hooks` (they write under ~/.claude), and
// never runs quota-axi — an npm tool's version is read from the package.json its command links to.

import { spawn } from "node:child_process";
import { chmodSync, closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { atLeast, FIRSTMATE_PIN, FIRSTMATE_REPO, PREREQS, SETUP_HOOKS, TOOLS, versionOf, WORKSPACE_LABEL, type Tool } from "@kinas/commands/crew-tools";
import { herdrSnapshot } from "@kinas/context";
import { confirm, type Io } from "./confirm.ts";
import { forTerminal } from "./open.ts";

export type StepId = "prereqs" | "gh" | "clone" | "backend" | "tools" | "hooks" | "summary";

export interface Step {
  id: StepId;
  /** What the step does, as `--dry-run` prints it after `would:`. */
  describe(ctx: Ctx): string;
  /** Checks, asks where it would change something, and acts. */
  perform(ctx: Ctx): Promise<void>;
}

export interface SetupOptions {
  dryRun: boolean;
  yes: boolean;
  /** Firstmate's home: `<data dir>/firstmate`. */
  home: string;
  io: Io;
  /** The environment every step runs with: the login shell's PATH, HOME, no HERDR*. */
  env: Record<string, string>;
  /** Where temporary downloads go (the system's temporary folder by default). */
  tmp?: string;
  /** Herdr's default session socket, asked whether a first mate runs before the home is moved; none means no Herdr. */
  herdrSocket?: string;
}

interface ToolResult {
  version: string | null;
  ok: boolean;
}

export interface Ctx extends SetupOptions {
  localBin: string;
  prereqsMissing: string[];
  ghSignedIn: boolean;
  /** Why Firstmate is not installed at the pin, when setup could not or would not put it there. */
  homeProblem: string | null;
  tools: Map<string, ToolResult>;
}

const SHORT_PIN = FIRSTMATE_PIN.slice(0, 7);
const PROBE_MS = 5_000;
const GIT_MS = 180_000;
const INSTALL_MS = 600_000;

export function steps(): Step[] {
  return [
    {
      id: "prereqs",
      describe: () => `check the prerequisites: ${PREREQS.join(", ")}`,
      async perform(ctx) {
        ctx.prereqsMissing = PREREQS.filter((name) => which(name, ctx) === null);
        say(ctx, ctx.prereqsMissing.length === 0 ? "all found" : `missing: ${ctx.prereqsMissing.join(", ")} — install them, then run kinas crew setup again`);
      },
    },
    {
      id: "gh",
      describe: () => "check that gh is signed in (gh auth status)",
      async perform(ctx) {
        const gh = which("gh", ctx);
        ctx.ghSignedIn = gh !== null && (await group([gh, "auth", "status"], ctx, PROBE_MS)).code === 0;
        // gh's own output names the account; it is not repeated here.
        say(ctx, ctx.ghSignedIn ? "signed in" : "not signed in — run gh auth login yourself, then run kinas crew setup again");
      },
    },
    {
      id: "clone",
      describe: (ctx) => `clone Firstmate at ${SHORT_PIN} from ${FIRSTMATE_REPO} into ${ctx.home}`,
      async perform(ctx) {
        if (existsSync(ctx.home)) {
          ctx.homeProblem = await settleHome(ctx);
          return;
        }
        if (!(await ask(ctx, `Clone Firstmate at ${SHORT_PIN} into ${ctx.home}?`))) {
          ctx.homeProblem = "not cloned";
          return;
        }
        mkdirSync(dirname(ctx.home), { recursive: true });
        const cloned = await group(["git", "clone", "--quiet", FIRSTMATE_REPO, ctx.home], ctx, GIT_MS);
        if (cloned.code !== 0) {
          ctx.homeProblem = `the clone failed${lastLine(cloned)}`;
        } else {
          // Each step names itself when it fails: git's last line belongs to the step that printed it.
          const checked = await group(["git", "-C", ctx.home, "checkout", "--quiet", "-B", "main", FIRSTMATE_PIN], ctx, GIT_MS);
          ctx.homeProblem = checked.code === 0 && (await head(ctx)) === FIRSTMATE_PIN ? null : `the checkout of ${SHORT_PIN} failed${lastLine(checked)}`;
        }
        say(ctx, ctx.homeProblem ?? `cloned, at ${SHORT_PIN} on main`);
      },
    },
    {
      id: "backend",
      describe: () => "set Firstmate's backend to herdr (config/backend)",
      async perform(ctx) {
        if (!existsSync(join(ctx.home, ".git"))) return say(ctx, "skipped: Firstmate is not cloned");
        // config/backend is written once, before any first mate exists (ADR 0018): a home the clone step left alone —
        // local changes, another branch, no commit, a clone that never reached the pin — is not written into either.
        if (ctx.homeProblem !== null) return say(ctx, "skipped: setup leaves Firstmate's home alone");
        const file = join(ctx.home, "config", "backend");
        const found = backendFile(file);
        if (found === null) return say(ctx, "skipped: config/backend is not a plain file of Firstmate's home — setup leaves it");
        const current = found.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
        if (current === "herdr") return say(ctx, "already herdr");
        const question = current ? `config/backend says ${current}; set it to herdr?` : "Set Firstmate's backend to herdr?";
        if (!(await ask(ctx, question))) return say(ctx, current ? `left as ${current}` : "left unset");
        mkdirSync(dirname(file), { recursive: true });
        // Never through a link, even one made since it was looked at: O_NOFOLLOW refuses it rather than write past it.
        const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
        try {
          writeFileSync(fd, "herdr\n");
        } finally {
          closeSync(fd);
        }
        say(ctx, "herdr");
      },
    },
    {
      id: "tools",
      describe: () => `install the tools at their pinned versions: ${TOOLS.map((t) => `${t.name} ${t.version}`).join(", ")}`,
      async perform(ctx) {
        for (const tool of TOOLS) {
          let result = await probe(tool, ctx);
          if (result.ok) {
            say(ctx, `${tool.name}: already ${result.version}`);
          } else {
            const how = tool.source === "npm" ? `npm install -g ${tool.name}@${tool.version}` : `the ${tool.source.asset} release, into ${ctx.localBin}`;
            const optional = tool.required ? "" : " (optional)";
            if (await ask(ctx, `Install ${tool.name} ${tool.version}${optional} with ${how}?`)) {
              const problem = tool.source === "npm" ? await installNpm(tool, ctx) : await installRelease(tool, tool.source, ctx);
              result = await probe(tool, ctx);
              say(ctx, problem ?? (result.ok ? `${tool.name}: installed ${result.version}` : `${tool.name}: installed, but not found on the login PATH`));
            } else {
              say(ctx, `${tool.name}: skipped`);
            }
          }
          ctx.tools.set(tool.name, result);
        }
      },
    },
    {
      id: "hooks",
      describe: () => `print the setup hooks lines of ${SETUP_HOOKS.join(", ")} for you to run — never run here`,
      async perform(ctx) {
        const installed = SETUP_HOOKS.filter((name) => ctx.tools.get(name)?.ok);
        if (installed.length === 0) return say(ctx, "none to print");
        say(ctx, "These write Claude Code hooks under ~/.claude; Kinas never runs them. Run them yourself if you want them:");
        for (const name of installed) say(ctx, `  ${name} setup hooks`);
      },
    },
    {
      id: "summary",
      describe: () => "print the table: every tool with its version, gh, and Firstmate's home",
      async perform(ctx) {
        const width = Math.max(...TOOLS.map((t) => t.name.length), ...PREREQS.map((p) => p.length)) + 2;
        const row = (name: string, text: string) => say(ctx, `${name.padEnd(width)}${text}`);
        row("Firstmate", ctx.homeProblem ?? `${SHORT_PIN} at ${ctx.home}`);
        for (const name of PREREQS) row(name, ctx.prereqsMissing.includes(name) ? "missing" : "found");
        row("gh auth", ctx.ghSignedIn ? "signed in" : "not signed in");
        for (const tool of TOOLS) {
          const r = ctx.tools.get(tool.name) ?? { version: null, ok: false };
          const optional = tool.required ? "" : " (optional)";
          row(tool.name, (r.ok ? `ok ${r.version}` : r.version ? `below floor ${r.version}` : "missing") + optional);
        }
      },
    },
  ];
}

/** Runs setup. 0 when Firstmate is at the pin (or moved on by itself), every required tool is installed at or above its
 * floor and gh is signed in; 1 otherwise. `--dry-run` prints each step and touches nothing, not even a check. */
export async function setup(opts: SetupOptions): Promise<number> {
  const home = opts.env.HOME ?? "";
  // Setup prints what others wrote — config/backend's first line, git's and npm's own last line: its control characters
  // are shown, never obeyed by the terminal (`forTerminal`; `ESC ] 52` sets its clipboard).
  const io: Io = { write: (text) => opts.io.write(forTerminal(text)), readLine: () => opts.io.readLine() };
  const ctx: Ctx = { ...opts, io, localBin: join(home, ".local", "bin"), prereqsMissing: [], ghSignedIn: false, homeProblem: null, tools: new Map() };
  io.write(`Firstmate's home: ${opts.home}\n`);
  for (const step of steps()) {
    if (opts.dryRun) {
      io.write(`would: ${step.describe(ctx)}\n`);
      if (step.id === "clone") {
        const move = await wouldMove(ctx);
        if (move) io.write(`would: ${move}\n`);
      }
      continue;
    }
    io.write(`\n${step.describe(ctx)}\n`);
    await step.perform(ctx);
  }
  if (opts.dryRun) return 0;
  const toolsOk = TOOLS.filter((t) => t.required).every((t) => ctx.tools.get(t.name)?.ok);
  return ctx.homeProblem === null && toolsOk && ctx.ghSignedIn ? 0 : 1;
}

function say(ctx: Ctx, line: string): void {
  ctx.io.write(`  ${line}\n`);
}

async function ask(ctx: Ctx, question: string): Promise<boolean> {
  if (ctx.yes) return true;
  return confirm(`  ${question}`, ctx.io);
}

/** Where an existing home stands against the pin (Firstmate, current; build spec §11.3 Setup). */
export type HomeState =
  | { kind: "absent" }
  | { kind: "at-pin" }
  | { kind: "behind"; head: string }
  | { kind: "ahead"; head: string }
  /** `line` is what setup says and why it is not installed at the pin; `said`, when the line it prints is shorter. */
  | { kind: "problem"; line: string; said?: string };

/**
 * Where the home stands, looked at and never changed but for the pin's fetch into its object store. Judged as the app
 * judges it (`crew/home.rs`, `classify`) for a tangle; then, for a clean clone on `main` (or detached) that is not at
 * the pin, git says whether its commit is behind the pin, past it, or neither. Every git call keeps
 * `GIT_OPTIONAL_LOCKS=0`, and no argument holds text from a file.
 */
export async function homeState(ctx: Ctx): Promise<HomeState> {
  if (!existsSync(ctx.home)) return { kind: "absent" };
  if (!existsSync(join(ctx.home, ".git"))) return { kind: "problem", line: `${ctx.home} exists and is not a git clone — move it away, then run kinas crew setup again` };
  const status = await group(["git", "-C", ctx.home, "status", "--porcelain"], ctx, PROBE_MS);
  if (status.code !== 0 || status.stdout.trim() !== "") return { kind: "problem", line: "Firstmate's home has local changes — setup leaves it alone; ask the first mate" };
  const at = await head(ctx);
  if (at === null) return { kind: "problem", line: "Firstmate's home has no commit checked out", said: "no commit checked out" };
  const branch = await currentBranch(ctx);
  if (branch !== null && branch !== "main") return { kind: "problem", line: `Firstmate's home is on branch ${branch}, not main — setup leaves it; ask the first mate` };
  if (at === FIRSTMATE_PIN) return { kind: "at-pin" };
  const fetched = await group(["git", "-C", ctx.home, "fetch", "--quiet", "origin", FIRSTMATE_PIN], ctx, GIT_MS);
  if (fetched.code !== 0) return { kind: "problem", line: "could not fetch the pin — check the network, then run kinas crew setup again" };
  if ((await group(["git", "-C", ctx.home, "merge-base", "--is-ancestor", "HEAD", FIRSTMATE_PIN], ctx, PROBE_MS)).code === 0) return { kind: "behind", head: at };
  if ((await group(["git", "-C", ctx.home, "merge-base", "--is-ancestor", FIRSTMATE_PIN, "HEAD"], ctx, PROBE_MS)).code === 0) return { kind: "ahead", head: at };
  return { kind: "problem", line: `Firstmate's home at ${at.slice(0, 7)} has diverged from the pin ${SHORT_PIN} — setup leaves it; ask the first mate` };
}

/**
 * The clone step for a home that exists: said, and moved only when it is behind the pin, no first mate runs in Herdr,
 * and the captain says yes. Returns why it is not at the pin, or null.
 */
async function settleHome(ctx: Ctx): Promise<string | null> {
  const state = await homeState(ctx);
  switch (state.kind) {
    case "absent":
      return null;
    case "problem":
      say(ctx, state.said ?? state.line);
      return state.line;
    case "at-pin":
      say(ctx, `already at ${SHORT_PIN}`);
      return null;
    case "ahead":
      // Firstmate updates itself (/updatefirstmate): a clean clone past the pin is Firstmate's doing, and Settings says so.
      say(ctx, `at ${state.head.slice(0, 7)}, past the pin ${SHORT_PIN} — setup leaves it; Settings → Crew shows it`);
      return null;
    case "behind": {
      const from = state.head.slice(0, 7);
      if (await firstMateRunning(ctx.herdrSocket)) {
        const line = `Firstmate's home is behind the pin (${from}) and the first mate is running — close it, then run setup again`;
        say(ctx, line);
        return line;
      }
      if (!(await ask(ctx, `Move Firstmate from ${from} to ${SHORT_PIN}?`))) {
        const line = `left at ${from}, behind the pin ${SHORT_PIN}`;
        say(ctx, line);
        return line;
      }
      const moved = await fastForward(ctx);
      say(ctx, moved ? `at ${SHORT_PIN}` : `the move from ${from} to ${SHORT_PIN} failed — setup leaves it; ask the first mate`);
      return moved ? null : `Firstmate's home could not be moved from ${from} to ${SHORT_PIN}`;
    }
  }
}

/** `git merge --ff-only` to the pin — never a reset, a checkout or a forced move — then HEAD is the pin. */
async function fastForward(ctx: Ctx): Promise<boolean> {
  const merged = await group(["git", "-C", ctx.home, "merge", "--ff-only", "--quiet", FIRSTMATE_PIN], ctx, GIT_MS);
  return merged.code === 0 && (await head(ctx)) === FIRSTMATE_PIN;
}

/**
 * Whether a first mate runs in Herdr's default session: an agent in a workspace labelled `firstmate`. A socket that does
 * not answer is no Herdr server, so no first mate in Herdr. An answer that cannot be read counts as running: the home is
 * not moved under a first mate setup could not rule out.
 */
export async function firstMateRunning(socket: string | undefined): Promise<boolean> {
  if (!socket) return false;
  let answer: unknown;
  try {
    answer = await herdrSnapshot(socket);
  } catch {
    return false;
  }
  const snapshot = (answer as { result?: { snapshot?: { workspaces?: unknown; agents?: unknown } } } | null)?.result?.snapshot;
  if (!snapshot || !Array.isArray(snapshot.workspaces) || !Array.isArray(snapshot.agents)) return true;
  const ids = new Set((snapshot.workspaces as { workspace_id?: unknown; label?: unknown }[]).filter((w) => w.label === WORKSPACE_LABEL).map((w) => w.workspace_id));
  return (snapshot.agents as { workspace_id?: unknown }[]).some((a) => ids.has(a.workspace_id));
}

/**
 * `--dry-run`'s word on an existing home: HEAD read (and nothing else), and, when it is not the pin, the move setup would
 * offer. Nothing is fetched, changed or asked.
 */
async function wouldMove(ctx: Ctx): Promise<string | null> {
  if (!existsSync(join(ctx.home, ".git"))) return null;
  const at = await head(ctx);
  if (at === null || at === FIRSTMATE_PIN) return null;
  return `fast-forward ${ctx.home} from ${at.slice(0, 7)} to ${SHORT_PIN}, if it is clean, on main and behind the pin`;
}

async function head(ctx: Ctx): Promise<string | null> {
  const r = await group(["git", "-C", ctx.home, "rev-parse", "HEAD"], ctx, PROBE_MS);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** The branch HEAD is on; null when detached (`symbolic-ref` is quiet and exits 1 then). */
async function currentBranch(ctx: Ctx): Promise<string | null> {
  const r = await group(["git", "-C", ctx.home, "symbolic-ref", "--short", "-q", "HEAD"], ctx, PROBE_MS);
  const line = r.stdout.trim();
  return r.code === 0 && line !== "" ? line : null;
}

/** The most of config/backend setup reads: its first line is one word. */
const BACKEND_BYTES = 64 * 1024;

/** What is at `path`, its link never followed: a missing one is "absent". */
function entry(path: string): "absent" | "dir" | "file" | "other" {
  try {
    const st = lstatSync(path);
    return st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "other";
  }
}

/**
 * config/backend's text (its first 64 KB), "" when there is none yet, or null when it is not a plain file of the home's
 * own `config` folder. The home is Firstmate's, and a first mate can leave anything there: a link — the file or its
 * folder — would take setup's `herdr` over whatever file it names, outside the home too, and a FIFO would block setup
 * for good. Neither is followed, opened or written; setup says so and leaves it.
 */
function backendFile(file: string): string | null {
  const folder = entry(dirname(file));
  const kind = folder === "dir" ? entry(file) : folder;
  if (kind === "absent") return "";
  if (kind !== "file") return null;
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(BACKEND_BYTES);
    return buffer.subarray(0, readSync(fd, buffer, 0, BACKEND_BYTES, 0)).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** A tool's version and whether it meets its floor. A release tool is asked `--version`; an npm tool is never run. */
async function probe(tool: Tool, ctx: Ctx): Promise<ToolResult> {
  const path = which(tool.name, ctx);
  if (path === null) return { version: null, ok: false };
  const version = tool.source === "npm" ? packageVersion(path, tool.name) : versionOf(await output([path, "--version"], ctx));
  if (version === null) return { version: null, ok: false };
  if (tool.floor === "lease") return { version, ok: (await output([path, "get", "--help"], ctx)).includes("--lease") };
  return { version, ok: atLeast(version, tool.floor) };
}

/** An npm tool's version from the `package.json` its command links to, walking up from the linked file. */
export function packageVersion(command: string, name: string): string | null {
  let dir: string;
  try {
    dir = dirname(realpathSync(command));
  } catch {
    return null;
  }
  for (let i = 0; i < 6; i++) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      try {
        const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
        if (pkg.name === name) return pkg.version ?? null;
      } catch {
        return null;
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

async function installNpm(tool: Tool, ctx: Ctx): Promise<string | null> {
  const r = await group(["npm", "install", "-g", `${tool.name}@${tool.version}`], ctx, INSTALL_MS);
  return r.code === 0 ? null : `${tool.name}: npm install failed${lastLine(r)}`;
}

/** Download, check the pinned SHA-256, extract, and put the one binary named like the tool in ~/.local/bin. */
async function installRelease(tool: Tool, source: { repo: string; asset: string; sha256: string }, ctx: Ctx): Promise<string | null> {
  const work = mkdtempSync(join(ctx.tmp ?? tmpdir(), "kinas-crew-"));
  try {
    const file = join(work, source.asset);
    const url = `https://github.com/${source.repo}/releases/download/v${tool.version}/${source.asset}`;
    const got = await group(["curl", "-fsSL", "--max-time", "300", "-o", file, url], ctx, INSTALL_MS);
    if (got.code !== 0 || !existsSync(file)) return `${tool.name}: the download failed${lastLine(got)}`;
    const sum = (await group(["shasum", "-a", "256", file], ctx, PROBE_MS * 6)).stdout.trim().split(/\s+/)[0] ?? "";
    if (sum !== source.sha256) return `${tool.name}: the download's SHA-256 is not the pinned one — not installed`;
    const unpacked = join(work, "unpacked");
    mkdirSync(unpacked);
    const tar = await group(["tar", "-xzf", file, "-C", unpacked], ctx, PROBE_MS * 12);
    if (tar.code !== 0) return `${tool.name}: the archive would not open${lastLine(tar)}`;
    const binary = findFile(unpacked, tool.name);
    if (binary === null) return `${tool.name}: the archive holds no ${tool.name}`;
    mkdirSync(ctx.localBin, { recursive: true });
    const target = join(ctx.localBin, tool.name);
    copyFileSync(binary, `${target}.kinas-new`);
    chmodSync(`${target}.kinas-new`, 0o755);
    renameSync(`${target}.kinas-new`, target);
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function findFile(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry === name && stat.isFile()) {
      return path;
    }
  }
  return null;
}

/** A command on the setup PATH, found without running anything. */
function which(name: string, ctx: Ctx): string | null {
  return Bun.which(name, { PATH: ctx.env.PATH ?? "" });
}

async function output(cmd: string[], ctx: Ctx): Promise<string> {
  const r = await group(cmd, ctx, PROBE_MS);
  return `${r.stdout}\n${r.stderr}`;
}

function lastLine(r: Ran): string {
  const line = `${r.stderr}\n${r.stdout}`.split("\n").map((l) => l.trim()).filter((l) => l !== "").at(-1);
  return line ? `: ${line}` : "";
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * A command in its own process group, killed whole at the limit (`npm install -g` starts children of its own), with
 * the setup environment and no stdin. `packages/context/src/exec.ts::run` kills only the direct child. Git runs with
 * optional locks off, so looking at an existing home (`git status`) never refreshes its index: Kinas writes nothing
 * under the home but `config/backend` (ADR 0018). Ctrl+C, a hangup or a TERM is passed on to the group: a terminal
 * signals only its foreground group, and a `git clone` or `npm install -g` the captain stopped would otherwise finish
 * behind them — a clone left at origin's head, never the pin. The group gets the signal itself, so git removes a clone
 * it had not finished; then setup dies of it, as it would have.
 */
function group(cmd: string[], ctx: Ctx, limitMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    // Found on the setup PATH, not the CLI's own: the login shell's is what the captain's tools are on.
    const program = cmd[0]!.includes("/") ? cmd[0]! : (Bun.which(cmd[0]!, { PATH: ctx.env.PATH ?? "" }) ?? cmd[0]!);
    try {
      child = spawn(program, cmd.slice(1), { env: { ...ctx.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: (e as Error).message });
      return;
    }
    const passOn = STOP_SIGNALS.map((signal) => {
      const handler = () => {
        try {
          if (child.pid) process.kill(-child.pid, signal);
        } catch {
          // Already gone.
        }
        stopPassing();
        process.kill(process.pid, signal);
      };
      process.on(signal, handler);
      return [signal, handler] as const;
    });
    const stopPassing = () => {
      for (const [signal, handler] of passOn) process.off(signal, handler);
    };
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, limitMs);
    events(child).on("error", (e: Error) => {
      clearTimeout(timer);
      stopPassing();
      resolve({ code: null, stdout, stderr: `${stderr}${e.message}` });
    });
    events(child).on("close", (code: number | null) => {
      clearTimeout(timer);
      stopPassing();
      resolve({ code, stdout, stderr });
    });
  });
}

/** What stops setup from outside while a step runs: Ctrl+C, the terminal closing, a kill. */
const STOP_SIGNALS = ["SIGINT", "SIGHUP", "SIGTERM"] as const;

/** The login shell's PATH, asked once, with the rule the app uses (login_path.rs): one line, absolute folders only. */
export async function loginPath(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const shell = env.SHELL || "/bin/zsh";
  const probe = await new Promise<Ran>((resolve) => {
    const child = spawn(shell, ["-l", "-c", 'printf %s "$PATH"'], { env: withoutHerdr(env), stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    const timer = setTimeout(() => child.pid && process.kill(-child.pid, "SIGKILL"), PROBE_MS);
    events(child).on("error", () => resolve({ code: null, stdout: "", stderr: "" }));
    events(child).on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr: "" });
    });
  });
  const text = probe.stdout.trim();
  if (probe.code !== 0 || text.includes("\n")) return null;
  const folders = text.split(":").filter((d) => d.startsWith("/"));
  return folders.length > 0 ? folders.join(":") : null;
}

/** A child's events, typed as node's (background.ts's precedent: bun's types leave `on` off ChildProcess). */
const events = (child: unknown) => child as NodeJS.EventEmitter;

/** The environment without HERDR*: a Kinas pane is a Herdr pane, and its variables would point tools at it. */
export function withoutHerdr(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !k.toUpperCase().includes("HERDR")) out[k] = v;
  return out;
}
