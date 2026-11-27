// The Herdr actions the Mac asks of the VPS (build spec §11.2, slice 3; ADR 0024), each on the captain's `default`
// session through herdr.ts's fixed list:
// - `view`, Herdr's snapshot of the session and its focused pane's process info, read now and verbatim, as the reading
//   carries them: the Mac's Work chrome and an order's pane, as fresh as on the Mac (build spec §17, slice 3).
// - `launch-first-mate`, the Mac's launcher (app/src-tauri/src/crew/launch.rs) rule for rule: the workspace labelled
//   `firstmate` is focused, and the first mate's program is typed into its pane only when that pane's foreground is a
//   shell and nothing else and the launcher has not typed into it in the last 30 s; with no such workspace one is made
//   in Firstmate's home and the program typed there. The command is exactly the program and, since ADR 0026, its one
//   flag `--append-system-prompt-file <Kinas's relay instruction>` — never a sentence, never a shell string from the
//   request. Without Kinas's own copy of the instruction there is no launch (`no-instruction`).
// - `focus`, a workspace the Mac read from the bundle (a worker's pane, the palette's list).
// - `open-workspace`, Open in the terminal: a Mac folder's twin under the VPS's projects folder, found again by its
//   label or made there; a folder that is not there is said, never made.
// An outcome Herdr or the machine decides (not installed, not running, not there) is an answer, not a failure: the
// reply says it in one code and the Mac puts it in words.

import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, writeSync } from "node:fs";
import { join, sep } from "node:path";
import { installed } from "./firstmate.ts";
import { foregroundOf, HERDR, paneOf, parseView, rootPane, workspaceWithLabel, type Herdr, type View } from "./herdr.ts";
import type { Paths } from "./paths.ts";
import { isKinasCopy } from "./written.ts";

/** Firstmate's own label for the first mate's workspace (the Mac's `crew::pin::WORKSPACE_LABEL`). */
export const WORKSPACE_LABEL = "firstmate";
/** As the Mac's launcher: a pane it typed into is left alone this long, while its program may still be starting. */
export const STARTING_MS = 30_000;
/** The shells a command may be typed into (a login shell's `argv0` carries a leading `-`). */
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh"]);
const TYPED_FILE = "launcher-typed.json";

export type Cannot = "not-installed" | "no-instruction" | "herdr-not-running" | "no-workspace" | "not-there" | "herdr-failed";
export type Outcome<T extends string> = { done: T } | { cannot: Cannot };

export interface ActionDeps {
  paths: Paths;
  herdr: Herdr;
  now: () => number;
}

const isShell = (argv0: string) => SHELLS.has((argv0.split("/").pop() ?? argv0).replace(/^-+/, ""));

/** What the launcher does with an existing workspace's pane (`launch::existing`). */
export function existing(foreground: string[] | null, typedRecently: boolean): "running" | "leave" | "type" {
  if (foreground === null) return "leave";
  if (foreground.some((a) => a === "claude" || a.endsWith("/claude"))) return "running";
  return !typedRecently && foreground.length > 0 && foreground.every(isShell) ? "type" : "leave";
}

/** The pane's whole command (`launch::pane_command` with no sentence): the program, quoted unless it is plain. */
export function paneCommand(program: string): string {
  return /^[A-Za-z0-9/._-]+$/.test(program) ? program : `'${program.replace(/'/g, `'\\''`)}'`;
}

/** The first mate's whole command (ADR 0026): the program and the instruction file, each quoted unless it is plain. */
export function firstMateCommand(program: string, instruction: string): string {
  return [paneCommand(program), "--append-system-prompt-file", paneCommand(instruction)].join(" ");
}

/** The pane the launcher last typed into, and when — kept in the companion's state folder across one-shot calls. */
function typedRecently(paths: Paths, pane: string, now: number): boolean {
  try {
    const t = JSON.parse(readFileSync(join(paths.state, TYPED_FILE), "utf8")) as { pane?: unknown; at?: unknown };
    return t.pane === pane && typeof t.at === "number" && now - t.at >= 0 && now - t.at < STARTING_MS;
  } catch {
    return false;
  }
}

function rememberTyped(paths: Paths, pane: string, now: number): void {
  try {
    mkdirSync(paths.state, { recursive: true, mode: 0o700 });
    const file = join(paths.state, TYPED_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify({ pane, at: now }));
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } catch {
    // Not remembered: the next launch within 30 s finds the program running, or a pane that is not a shell, and leaves it.
  }
}

async function view(herdr: Herdr): Promise<View | null> {
  const r = await herdr(HERDR.snapshot());
  return r.ok ? parseView(r.stdout) : null;
}

/** Herdr's view now, as `readOnce` reads it: both verbatim, null where Herdr did not answer. */
export async function viewNow(d: ActionDeps): Promise<{ herdr_view: string | null; herdr_foreground: string | null }> {
  const snap = await d.herdr(HERDR.snapshot());
  if (!snap.ok) return { herdr_view: null, herdr_foreground: null };
  const focused = parseView(snap.stdout)?.focusedPane ?? null;
  const info = focused === null ? null : await d.herdr(HERDR.processInfo(focused));
  return { herdr_view: snap.stdout, herdr_foreground: info?.ok ? info.stdout : null };
}

export async function launchFirstMate(d: ActionDeps): Promise<Outcome<"focused" | "run" | "created">> {
  if (!installed(d.paths.home)) return { cannot: "not-installed" };
  if (!(await isKinasCopy(d.paths, d.paths.relayInstruction))) return { cannot: "no-instruction" };
  const v = await view(d.herdr);
  if (v === null) return { cannot: "herdr-not-running" };
  const command = firstMateCommand(d.paths.claude, d.paths.relayInstruction);
  const ws = workspaceWithLabel(v, WORKSPACE_LABEL);
  if (ws !== null) {
    const pane = paneOf(v, ws);
    if (pane === null) return { cannot: "herdr-failed" };
    const info = await d.herdr(HERDR.processInfo(pane));
    const decision = existing(info.ok ? foregroundOf(info.stdout) : null, typedRecently(d.paths, pane, d.now()));
    if (!(await d.herdr(HERDR.focus(ws))).ok) return { cannot: "herdr-failed" };
    if (decision !== "type") return { done: "focused" };
    if (!(await d.herdr(HERDR.run(pane, command))).ok) return { cannot: "herdr-failed" };
    rememberTyped(d.paths, pane, d.now());
    return { done: "run" };
  }
  const made = await d.herdr(HERDR.create(d.paths.home, WORKSPACE_LABEL));
  const pane = made.ok ? rootPane(made.stdout) : null;
  if (pane === null) return { cannot: "herdr-failed" };
  if (!(await d.herdr(HERDR.run(pane, command))).ok) return { cannot: "herdr-failed" };
  rememberTyped(d.paths, pane, d.now());
  return { done: "created" };
}

export async function focusWorkspace(d: ActionDeps, workspace: string): Promise<Outcome<"focused">> {
  const v = await view(d.herdr);
  if (v === null) return { cannot: "herdr-not-running" };
  if (!v.workspaces.some((w) => w.id === workspace)) return { cannot: "no-workspace" };
  return (await d.herdr(HERDR.focus(workspace))).ok ? { done: "focused" } : { cannot: "herdr-failed" };
}

/**
 * `folder` (validated: relative, no `.` or `..` part) under the projects folder, when it is a folder there and its real
 * path stays inside — a symlink out of the projects folder is not its twin. Null otherwise.
 */
export function twinOf(projects: string, folder: string): string | null {
  try {
    const root = realpathSync(projects);
    const real = realpathSync(folder === "" ? projects : join(projects, folder));
    if (real !== root && !real.startsWith(root + sep)) return null;
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

export async function openWorkspace(d: ActionDeps, folder: string, label: string): Promise<Outcome<"focused" | "created">> {
  // The first projects folder that has it (slice 5.3: the Linux machine's `roots`).
  const dir = d.paths.projectRoots.map((r) => twinOf(r, folder)).find((x) => x !== null) ?? null;
  if (dir === null) return { cannot: "not-there" };
  const v = await view(d.herdr);
  if (v === null) return { cannot: "herdr-not-running" };
  const ws = workspaceWithLabel(v, label);
  if (ws !== null) return (await d.herdr(HERDR.focus(ws))).ok ? { done: "focused" } : { cannot: "herdr-failed" };
  return (await d.herdr(HERDR.create(dir, label))).ok ? { done: "created" } : { cannot: "herdr-failed" };
}
