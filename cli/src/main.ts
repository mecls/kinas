#!/usr/bin/env bun
// kinas — the CLI door to the command registry (PRD R35–R37, CLI v0). It reads the app's store read-only and writes
// only its own cache beside it (kinas-cli.sqlite). Firstmate, Herdr and git are read, never written.
//
//   kinas                    the launch screen: where the operation is right now
//   kinas context            the counts, what is waiting on you, and what changed recently
//   kinas context --agent    the whole context packet as markdown, for the start of an agent session
//   kinas status [--json]    the Usage page as text or JSON
//   kinas open [<path>]      any text file, image or folder in the Kinas reader; no path reopens the last one (open.ts)
//   kinas crew setup         install the crew: Firstmate at its pin and the tools, asking y/N before each (crew-setup.ts)
//   kinas crew status [--json]  the crew as the app last mirrored it: counts and words, never a task's name (crew.ts)
//
// Amended 2026-09-24 (the first mate): `kinas crew setup` is the one exception to "read, never written". With the
// captain's yes for each step it clones Firstmate at its pin into the data directory, writes the clone's
// config/backend, and installs the crew's tools into ~/.local/bin and npm's global prefix — nothing else, and nothing
// under the app's store. It is also the one command besides the launch screen that reads the keyboard: a line per
// y/N question (confirm.ts), and only on a terminal.
//
// Only the launch screen reads keys, and only on a terminal: it holds until Enter, q or Ctrl+C and ignores every
// other key, Tab included (hold.ts, keymap.md). Every other command prints and exits.
//
// Exit codes: 0 (even when readings are stale — staleness is data; `open`: opened, asked, or the app is not running
// and the path was printed), 1 (other errors), 2 (`status`: the store does not exist yet), 3 (`status`: the store is
// newer than this CLI: the ~/.local/bin link is stale), 10 (the launch screen in the Work pane: q or Ctrl+C, stay in
// the shell), 64 (unknown usage), 65 (`open`: not a text file Kinas can open — binary content, or not a regular
// file), 66 (`open`: no such file, or nothing to reopen), 77 (`open`: outside the projects root).

import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { cliCommand, statusFromStore, statusJson, statusLines } from "@kinas/commands";
import { colorEnabled, paint, polarityFromEnv } from "@kinas/commands/theme";
import { computePacket, ContextCache, currentOrg, insideRoot, loadConfig, renderAgentPacket, renderOperator, type KinasConfig } from "@kinas/context";
import { dataDir, openReadOnly } from "@kinas/store/sqlite-readonly";
import { spawnRefresh } from "./background.ts";
import { crew, CREW_USAGE } from "./crew.ts";
import { ask, LAUNCH_TIMEOUT_MS, launchAndAsk, OPEN_EXIT, type OpenRequest, outcome, resolveTarget } from "./open.ts";

// 0, 1, 65, 66 and 77 come from open.ts, which owns `kinas open`'s codes.
const EXIT = { ...OPEN_EXIT, missing: 2, newer: 3, stay: 10, usage: 64 } as const;

/** The launch screen draws the cached packet and refreshes it in the background once it is older than this. */
const LAUNCH_REFRESH_AFTER_MS = 15_000;
/** `kinas context` reuses a packet this recent instead of reading every source again. */
const CONTEXT_REUSE_MS = 30_000;
/** A refresh that has not finished after this long is presumed dead and another may start. */
const REFRESH_LEASE_MS = 60_000;

function usage(): string {
  return [
    "usage: kinas [command]",
    "",
    "  (no command)        where the operation is right now: projects, crew, sessions, decisions, quotas, recent",
    "  context             the counts, what is waiting on you, and what changed recently",
    "  context --agent     the whole context packet as markdown, for the start of an agent session",
    "    --cwd <dir>       print nothing unless <dir> is inside the projects root (for session hooks)",
    "    --refresh         recompute the cached packet and print nothing",
    "  status [--json]     how much of each plan is left, today's model usage, and this Mac",
    "  open [<path>]       open a file or folder in the Kinas reader; no path reopens the last one",
    "    --anywhere        ask Kinas to open a path outside the projects root",
    "    --launch          start Kinas first when it is not running",
    ...CREW_USAGE,
  ].join("\n");
}

/** Plain text on stderr: Bun's console.error colours its output even when stderr is a file or a pipe. */
function printError(message: string) {
  process.stderr.write(`${message}\n`);
}

function usageError(message: string): number {
  printError(`${message}\n\n${usage()}`);
  return EXIT.usage;
}

interface Parsed {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
  problem: string | null;
}

function parseArgs(args: string[], flags: string[], valued: string[]): Parsed {
  const parsed: Parsed = { flags: new Set(), values: new Map(), positional: [], problem: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flags.includes(a)) parsed.flags.add(a);
    else if (valued.includes(a)) {
      const v = args[++i];
      if (v === undefined) parsed.problem ??= `${a} needs a value`;
      else parsed.values.set(a, v);
    } else if (a.startsWith("-")) parsed.problem ??= `unknown option ${a}`;
    else parsed.positional.push(a);
  }
  return parsed;
}

function openCache(config: KinasConfig): ContextCache | null {
  try {
    return ContextCache.open(config.dataDir);
  } catch {
    // An unwritable or newer cache: every command still works, it just computes the packet each time.
    return null;
  }
}

async function launch(): Promise<number> {
  const now = Date.now();
  const config = loadConfig();
  const cache = openCache(config);
  const color = colorEnabled();
  try {
    const org = currentOrg(config);
    const cached = cache?.readPacket(org) ?? null;
    const packet = cached?.packet ?? (await computePacket(config, cache, { now, skipCrew: true }));
    const old = !cached || now - cached.computedAt > LAUNCH_REFRESH_AFTER_MS || packet.crew.state === "pending";
    if (old && cache?.claimRefresh(org, now, REFRESH_LEASE_MS)) spawnRefresh();

    const { MAX_COLUMNS, renderLaunch } = await import("./launch.tsx");
    process.stdout.write(renderLaunch(packet, { columns: process.stdout.columns ?? MAX_COLUMNS, color, polarity: polarityFromEnv(), now }));
    if (config.problem) printError(`kinas: ${config.problem}`);
  } finally {
    cache?.close();
  }

  // Piped or redirected, the screen is printed and that is all.
  if (!process.stdin.isTTY || !process.stdout.isTTY) return EXIT.ok;

  // Listen before the hint appears: a key pressed the moment it shows is read in raw mode, not echoed and held in a
  // half-typed line.
  const { waitForLaunchKey } = await import("./hold.ts");
  const pressed = waitForLaunchKey();

  // The Work pane starts `KINAS_ENTER=herdr kinas`: Enter goes on to Herdr, q stays in the shell.
  const next = process.env.KINAS_ENTER === "herdr" ? "Herdr" : null;
  const key = (label: string) => paint("white", label, color, true);
  const hint = next
    ? `  ${key("Enter")}  ${paint("muted", `open ${next}`, color)}    ${key("q")}  ${paint("muted", "stay in the shell", color)}`
    : `  ${key("Enter")} or ${key("q")}  ${paint("muted", "close", color)}`;
  process.stdout.write(`${hint}\n`);

  const answer = await pressed;
  return next && answer === "quit" ? EXIT.stay : EXIT.ok;
}

async function context(args: string[]): Promise<number> {
  const parsed = parseArgs(args, ["--agent", "--refresh"], ["--cwd"]);
  if (parsed.problem) return usageError(`kinas context: ${parsed.problem}`);
  if (parsed.positional.length > 0) return usageError(`kinas context: unexpected argument ${parsed.positional[0]}`);

  const config = loadConfig();
  const cwd = parsed.values.get("--cwd");
  if (cwd !== undefined && !insideRoot(config, cwd)) return EXIT.ok;

  const cache = openCache(config);
  try {
    const org = currentOrg(config);
    if (parsed.flags.has("--refresh")) {
      if (!cache) return EXIT.ok;
      const held = process.env.KINAS_REFRESH_LEASE === "held";
      if (!held && !cache.claimRefresh(org, Date.now(), REFRESH_LEASE_MS)) return EXIT.ok;
      try {
        await computePacket(config, cache);
      } finally {
        cache.releaseRefresh(org);
      }
      return EXIT.ok;
    }

    const now = Date.now();
    const cached = cache?.readPacket(org);
    const reuse = cached && now - cached.computedAt < CONTEXT_REUSE_MS && cached.packet.crew.state !== "pending";
    const packet = reuse ? cached.packet : await computePacket(config, cache, { now });
    const agent = parsed.flags.has("--agent");
    const { text } = await cliCommand("context")!.run({
      now,
      getContext: async () => (agent ? renderAgentPacket(packet) : renderOperator(packet, colorEnabled())),
    });
    process.stdout.write(text ?? "");
    return EXIT.ok;
  } finally {
    cache?.close();
  }
}

async function status(args: string[]): Promise<number> {
  const parsed = parseArgs(args, ["--json"], []);
  if (parsed.problem) return usageError(`kinas status: ${parsed.problem}`);
  if (parsed.positional.length > 0) return usageError(`kinas status: unexpected argument ${parsed.positional[0]}`);

  const opened = openReadOnly(dataDir());
  if (!opened.ok) {
    if (opened.reason === "missing") {
      printError("Kinas hasn't run yet — open the app once");
      return EXIT.missing;
    }
    if (opened.reason === "newer") {
      printError("This kinas CLI is older than the app's store — the ~/.local/bin link is stale");
      return EXIT.newer;
    }
    printError(`kinas: could not read the store: ${opened.message}`);
    return EXIT.error;
  }

  try {
    const now = Date.now();
    const { result } = await cliCommand("status")!.run({ now, getStatus: async () => statusFromStore(opened.store, now) });
    if (!result) return EXIT.ok;
    if (parsed.flags.has("--json")) {
      console.log(JSON.stringify(statusJson(result), null, 2));
      return EXIT.ok;
    }
    const tty = Boolean(process.stdout.isTTY);
    const color = tty && colorEnabled();
    const lines = statusLines(result, color);
    if (tty) {
      intro(paint("blue", "kinas status", color, true));
      log.message(lines.join("\n"));
      outro(paint("muted", "Readings are shown with their age; stale lines are marked.", color));
    } else {
      console.log(lines.join("\n"));
    }
    return EXIT.ok;
  } finally {
    opened.store.close();
  }
}

async function open(args: string[]): Promise<number> {
  const parsed = parseArgs(args, ["--anywhere", "--launch"], []);
  if (parsed.problem) return usageError(`kinas open: ${parsed.problem}`);
  if (parsed.positional.length > 1) return usageError("kinas open: name one file or folder");

  const anywhere = parsed.flags.has("--anywhere");
  let path: string | null = null;
  let request: OpenRequest = { v: 1, op: "reopen" };
  if (parsed.positional.length === 1) {
    const target = resolveTarget(parsed.positional[0]!, { cwd: process.cwd(), root: loadConfig().root, anywhere });
    if (!target.ok) {
      printError(target.message);
      return target.exit;
    }
    if ("pick" in target) {
      // Several files carry that name: the reader lists them and opens nothing until Miguel chooses (R1b).
      request = { v: 1, op: "pick", paths: target.pick };
    } else {
      path = target.path;
      request = { v: 1, op: "open", path, anywhere };
    }
  }

  let exit: number = EXIT.ok;
  const { lines } = await cliCommand("open")!.run({
    now: Date.now(),
    openFile: async () => {
      const socket = join(dataDir(), "kinas.sock");
      let answer = await ask(socket, request);
      if (answer.kind === "down" && parsed.flags.has("--launch")) {
        const launched = await launchAndAsk(socket, request);
        if (!launched) {
          exit = EXIT.error;
          printError(`kinas open: Kinas did not start within ${LAUNCH_TIMEOUT_MS / 1000} s`);
          return path ? [path] : [];
        }
        answer = launched;
      }
      const result = outcome(answer, { path, tty: Boolean(process.stderr.isTTY) });
      exit = result.exit;
      if (result.stderr !== null) printError(result.stderr);
      return result.stdout === null ? [] : [result.stdout];
    },
  });
  // stdout carries exactly the resolved path, or nothing (R11).
  if (lines && lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
  return exit;
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined) return launch();
  if (name === "--help" || name === "-h" || name === "help") {
    process.stdout.write(`${usage()}\n`);
    return EXIT.ok;
  }
  if (!cliCommand(name)) return usageError(`kinas: unknown command "${name}"`);
  if (name === "context") return context(rest);
  if (name === "open") return open(rest);
  if (name === "crew") return (await cliCommand("crew")!.run({ now: Date.now(), crew: () => crew(rest) })).exit ?? EXIT.error;
  return status(rest);
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (e) {
  printError(`kinas: ${(e as Error).message}`);
  process.exit(EXIT.error);
}
