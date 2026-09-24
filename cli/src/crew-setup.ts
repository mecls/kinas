// `kinas crew setup` (build spec §4 The CLI, §9, §10; AC-1): installs the crew on this Mac — Firstmate at its pin in
// Kinas's data directory, its backend, and the tools at their pinned versions — asking y/N before each thing it
// changes. It is the CLI's one exception to "read, never written" (main.ts's header), and it writes only the clone
// under the data directory, the clone's config/backend, `~/.local/bin` and npm's global prefix.
//
// Every step runs with the login shell's PATH and no HERDR*. It never pipes a download into a shell, never installs a
// release whose SHA-256 is not the pinned one, never runs a tool's `setup hooks` (they write under ~/.claude), and
// never runs quota-axi — an npm tool's version is read from the package.json its command links to.

import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { atLeast, FIRSTMATE_PIN, FIRSTMATE_REPO, PREREQS, SETUP_HOOKS, TOOLS, versionOf, type Tool } from "@kinas/commands/crew-tools";
import { confirm, type Io } from "./confirm.ts";

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
          ctx.homeProblem = await checkHome(ctx);
          return;
        }
        if (!(await ask(ctx, `Clone Firstmate at ${SHORT_PIN} into ${ctx.home}?`))) {
          ctx.homeProblem = "not cloned";
          return;
        }
        mkdirSync(dirname(ctx.home), { recursive: true });
        const cloned = await group(["git", "clone", "--quiet", FIRSTMATE_REPO, ctx.home], ctx, GIT_MS);
        const pinned = cloned.code === 0 && (await group(["git", "-C", ctx.home, "checkout", "--quiet", "-B", "main", FIRSTMATE_PIN], ctx, GIT_MS)).code === 0;
        ctx.homeProblem = pinned && (await head(ctx)) === FIRSTMATE_PIN ? null : `the clone failed${lastLine(cloned)}`;
        say(ctx, ctx.homeProblem ?? `cloned, at ${SHORT_PIN} on main`);
      },
    },
    {
      id: "backend",
      describe: () => "set Firstmate's backend to herdr (config/backend)",
      async perform(ctx) {
        if (!existsSync(join(ctx.home, ".git"))) return say(ctx, "skipped: Firstmate is not cloned");
        const file = join(ctx.home, "config", "backend");
        const current = existsSync(file) ? (readFileSync(file, "utf8").split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "") : "";
        if (current === "herdr") return say(ctx, "already herdr");
        const question = current ? `config/backend says ${current}; set it to herdr?` : "Set Firstmate's backend to herdr?";
        if (!(await ask(ctx, question))) return say(ctx, current ? `left as ${current}` : "left unset");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, "herdr\n");
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
  const ctx: Ctx = { ...opts, localBin: join(home, ".local", "bin"), prereqsMissing: [], ghSignedIn: false, homeProblem: null, tools: new Map() };
  opts.io.write(`Firstmate's home: ${opts.home}\n`);
  for (const step of steps()) {
    if (opts.dryRun) {
      opts.io.write(`would: ${step.describe(ctx)}\n`);
      continue;
    }
    opts.io.write(`\n${step.describe(ctx)}\n`);
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

/** An existing home is looked at, never changed: a clone with local changes, a stranger folder or a moved pin stays. */
async function checkHome(ctx: Ctx): Promise<string | null> {
  if (!existsSync(join(ctx.home, ".git"))) {
    const problem = `${ctx.home} exists and is not a git clone — move it away, then run kinas crew setup again`;
    say(ctx, problem);
    return problem;
  }
  const status = await group(["git", "-C", ctx.home, "status", "--porcelain"], ctx, PROBE_MS);
  if (status.code !== 0 || status.stdout.trim() !== "") {
    const problem = "Firstmate's home has local changes — setup leaves it alone; ask the first mate";
    say(ctx, problem);
    return problem;
  }
  const at = await head(ctx);
  if (at === FIRSTMATE_PIN) {
    say(ctx, `already at ${SHORT_PIN}`);
    return null;
  }
  // Firstmate updates itself (/updatefirstmate): a clean clone that moved is Firstmate's doing, and Settings says so.
  say(ctx, at ? `at ${at.slice(0, 7)}, moved from the pin ${SHORT_PIN} — setup leaves it; Settings → Crew shows it` : "no commit checked out");
  return at ? null : "Firstmate's home has no commit checked out";
}

async function head(ctx: Ctx): Promise<string | null> {
  const r = await group(["git", "-C", ctx.home, "rev-parse", "HEAD"], ctx, PROBE_MS);
  return r.code === 0 ? r.stdout.trim() : null;
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
 * the setup environment and no stdin. `packages/context/src/exec.ts::run` kills only the direct child.
 */
function group(cmd: string[], ctx: Ctx, limitMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    // Found on the setup PATH, not the CLI's own: the login shell's is what the captain's tools are on.
    const program = cmd[0]!.includes("/") ? cmd[0]! : (Bun.which(cmd[0]!, { PATH: ctx.env.PATH ?? "" }) ?? cmd[0]!);
    try {
      child = spawn(program, cmd.slice(1), { env: ctx.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: (e as Error).message });
      return;
    }
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
      resolve({ code: null, stdout, stderr: `${stderr}${e.message}` });
    });
    events(child).on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

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
