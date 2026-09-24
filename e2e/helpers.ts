import { browser } from "@wdio/globals";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The app's log. Every debug and release build of Kinas writes this one file, so a spec reads it for its own lines —
 * and a marker like `9c2e`, which only fixtures carry, must never appear in it from any run.
 */
export const APP_LOG = join(homedir(), "Library/Logs/ai.sintralabs.kinas/kinas.log");

/** The log's lines that contain `needle`; none when the log does not exist yet. */
export const logLines = (needle: string): string[] =>
  existsSync(APP_LOG) ? readFileSync(APP_LOG, "utf8").split("\n").filter((line) => line.includes(needle)) : [];

/** The built CLI, run with the spec's environment (its `KINAS_DATA_DIR`), from the projects root. */
export function kinasCli(...args: string[]): { code: number | null; stdout: string; stderr: string } {
  const cli = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
  const result = spawnSync(cli, args, { cwd: process.env.KINAS_ROOT ?? process.cwd(), env: process.env, encoding: "utf8", timeout: 20000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The fake Firstmate home a crew spec's setup made (`e2e/fake-firstmate/make.ts`): `<data dir>/firstmate`. */
export const fakeHome = (): string => join(process.env.KINAS_DATA_DIR!, "firstmate");

/** Calls a debug-only test hook from app/src/testHooks.ts (or one registered by a component). */
export async function hook<T = unknown>(name: string): Promise<T> {
  const result = (await browser.executeAsync((hookName: string, done: (v: unknown) => void) => {
    const hooks = (window as unknown as { __kinasTest?: Record<string, () => unknown> }).__kinasTest;
    const fn = hooks?.[hookName];
    if (!fn) return done({ __hookError: `no test hook ${hookName}` });
    Promise.resolve()
      .then(() => fn())
      .then(done, (e: unknown) => done({ __hookError: String(e) }));
  }, name)) as T;
  if (result && typeof result === "object" && "__hookError" in (result as object)) {
    throw new Error((result as unknown as { __hookError: string }).__hookError);
  }
  return result;
}

/** Calls a hook that takes one JSON-serialisable argument. */
export async function hookWith<T = unknown>(name: string, arg: unknown): Promise<T> {
  return (await browser.executeAsync(
    (hookName: string, value: unknown, done: (v: unknown) => void) => {
      const hooks = (window as unknown as { __kinasTest?: Record<string, (a: unknown) => unknown> }).__kinasTest;
      const fn = hooks?.[hookName];
      if (!fn) return done({ __hookError: `no test hook ${hookName}` });
      Promise.resolve()
        .then(() => fn(value))
        .then(done, (e: unknown) => done({ __hookError: String(e) }));
    },
    name,
    arg,
  )) as T;
}

/**
 * Opens the reader header's ▾ menu and waits for its items. Clicked in the page, like everything else here — and
 * the wait is a second script on purpose: React has not rendered the menu within the script that clicked ▾.
 */
export async function openReaderMenu(): Promise<void> {
  await browser.execute(() => {
    if (document.querySelector(".reader-menu") === null) document.querySelector<HTMLButtonElement>('.reader-head [aria-haspopup="menu"]')!.click();
  });
  await browser.waitUntil(() => browser.execute(() => document.querySelector('.reader-menu [role="menuitem"]') !== null), {
    timeout: 10000,
    interval: 250,
    timeoutMsg: "the reader's menu never opened",
  });
}

/** Runs one item of the reader's ▾ menu by its label. Throws when the item is missing or cannot be used. */
export async function runReaderMenuItem(label: string): Promise<void> {
  await openReaderMenu();
  const state = await browser.execute((wanted: string) => {
    const item = [...document.querySelectorAll<HTMLButtonElement>('.reader-menu [role="menuitem"]')].find((b) => b.textContent?.trim() === wanted);
    if (!item) return `missing; the menu holds: ${[...document.querySelectorAll('.reader-menu [role="menuitem"]')].map((b) => b.textContent?.trim()).join(", ")}`;
    if (item.getAttribute("aria-disabled") === "true") return `disabled: ${item.getAttribute("title") ?? ""}`;
    item.click();
    return "clicked";
  }, label);
  if (state !== "clicked") throw new Error(`reader menu item "${label}" is ${state}`);
}

export async function waitForHook(name: string, timeout = 30000): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        await hook(name);
        return true;
      } catch {
        return false;
      }
    },
    { timeout, timeoutMsg: `test hook ${name} never appeared` },
  );
}

export async function terminalText(): Promise<string> {
  return hook<string>("terminalText");
}

export async function waitForTerminal(pattern: RegExp, timeout = 20000): Promise<string> {
  let last = "";
  try {
    await browser.waitUntil(
      async () => {
        last = await terminalText();
        return pattern.test(last);
      },
      { timeout, interval: 200 },
    );
  } catch {
    throw new Error(`terminal never matched ${pattern}\n--- terminal text (last 800 chars) ---\n${last.slice(-800)}`);
  }
  return last;
}

/**
 * Types a line into the terminal through xterm's own input path. WebDriver's synthetic key events in the
 * embedded WKWebView driver double every printable character ("echo" arrives as "eecchhoo") and drop
 * spaces, so text goes through the `terminalInput` hook; specs still send the contract's keys (Tab,
 * Enter, ⌃C, ⌘K, ⌃Tab) with browser.keys.
 */
export async function typeLine(text: string): Promise<void> {
  await hook("focusTerminal");
  await browser.execute((line: string) => {
    const hooks = (window as unknown as { __kinasTest?: Record<string, (s: string) => unknown> }).__kinasTest;
    if (!hooks?.terminalInput) throw new Error("no terminalInput hook");
    hooks.terminalInput(`${line}\r`);
  }, text);
}

/** Types text without Enter. */
export async function typeText(text: string): Promise<void> {
  await browser.execute((t: string) => {
    const hooks = (window as unknown as { __kinasTest?: Record<string, (s: string) => unknown> }).__kinasTest;
    if (!hooks?.terminalInput) throw new Error("no terminalInput hook");
    hooks.terminalInput(t);
  }, text);
}

/** Waits until an interactive shell answers, using a marker only its output (not the echo) contains. */
export async function waitForShell(timeout = 45000): Promise<void> {
  await waitForHook("terminalText", timeout);
  const marker = `READY_${Date.now()}`;
  await browser.waitUntil(
    async () => {
      await typeLine(`echo ${marker.slice(0, 6)}''${marker.slice(6)}`);
      try {
        await waitForTerminal(new RegExp(`^${marker}\\s*$`, "m"), 3000);
        return true;
      } catch {
        return false;
      }
    },
    { timeout, interval: 500, timeoutMsg: "the shell never answered" },
  ).catch(async (e: unknown) => {
    const tail = await terminalText().catch(() => "(no terminal text hook)");
    throw new Error(`${String(e)}\n--- terminal text (last 800 chars) ---\n${tail.slice(-800)}`);
  });
}

/** Runs `herdr` for a named throwaway session, with any Herdr pane identity removed. */
export function herdr(session: string, ...args: string[]): string {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.toUpperCase().includes("HERDR")) env[k] = v;
  }
  return execFileSync("herdr", ["--session", session, ...args], { encoding: "utf8", env, timeout: 10000 });
}

export interface HerdrSnapshot {
  focused_pane_id: string;
  focused_workspace_id: string;
  panes: { pane_id: string; workspace_id: string; cwd: string | null }[];
  workspaces: { workspace_id: string; label: string; focused: boolean }[];
}

export function herdrSnapshot(session: string): HerdrSnapshot {
  return JSON.parse(herdr(session, "api", "snapshot")).result.snapshot;
}

/**
 * Starts a throwaway session's server headless, before the app attaches it (`herdr --session <name> server`, detached),
 * with its own config, and waits for it to answer. The crew specs need workspaces in it before Kinas starts.
 */
export function startHerdrServer(session: string, config: string): void {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.toUpperCase().includes("HERDR")) env[k] = v;
  }
  env.HERDR_CONFIG_PATH = config;
  const child = spawn(join(homedir(), ".local/bin/herdr"), ["--session", session, "server"], { env, detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 50; i++) {
    try {
      herdr(session, "api", "snapshot");
      return;
    } catch {
      execFileSync("/bin/sleep", ["0.2"]);
    }
  }
  throw new Error(`Herdr's server for ${session} never answered`);
}

export function stopHerdrSession(session: string): void {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.toUpperCase().includes("HERDR")) env[k] = v;
  }
  for (const step of ["stop", "delete"]) {
    try {
      execFileSync("herdr", ["session", step, session], { env, timeout: 10000, stdio: "ignore" });
    } catch {
      // Already stopped or deleted.
    }
  }
}

export function processCommand(pid: number): string {
  try {
    return execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export function processAlive(pid: number): boolean {
  return processCommand(pid) !== "";
}
