import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeWorld, type World } from "@kinas/context/testing";

// The launch screen on a real terminal: script(1) gives `kinas` a PTY and the exit code says what the Work pane does
// next (keymap.md): 0 goes on to Herdr, 10 stays in the shell.
//
// The keys are typed by a subshell piped into script: it waits for the hint in script's output, types the keys from a
// file, and keeps the pipe open a moment longer. (script rejects a socket as its stdin, which rules out Bun's own
// pipes and macOS named pipes.)

const MAIN = join(import.meta.dir, "main.ts");
const TYPIST = `( while ! grep -q -e 'stay in the shell' -e 'close' "$KINAS_TEST_OUT" 2>/dev/null; do sleep 0.1; done; cat "$KINAS_TEST_KEYS"; sleep 2 )`;
let world: World;
let runs = 0;

beforeAll(async () => {
  world = await makeWorld();
});
afterAll(() => world.cleanup());

async function launchOnTerminal(keys: string, env: Record<string, string> = {}): Promise<{ code: number | "running"; screen: string }> {
  const run = runs++;
  const keysFile = join(world.base, `keys-${run}`);
  const out = join(world.base, `screen-${run}`);
  writeFileSync(keysFile, keys);
  const proc = Bun.spawn(["/bin/sh", "-c", `${TYPIST} | /usr/bin/script -q /dev/null "$@" > "$KINAS_TEST_OUT" 2>&1`, "sh", process.execPath, MAIN], {
    env: { ...world.env, ...env, KINAS_TEST_KEYS: keysFile, KINAS_TEST_OUT: out },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await Promise.race([proc.exited, Bun.sleep(15_000).then(() => "running" as const)]);
  if (code === "running") {
    proc.kill();
    Bun.spawnSync(["pkill", "-f", `script -q /dev/null ${process.execPath} ${MAIN}`]);
  }
  return { code, screen: existsSync(out) ? readFileSync(out, "utf8") : "" };
}

const SLOW = 30_000;

describe("the launch screen on a terminal", () => {
  test(
    "in the Work pane, Enter goes on to Herdr",
    async () => {
      const { code, screen } = await launchOnTerminal("\r", { KINAS_ENTER: "herdr" });
      expect(screen).toContain("open Herdr");
      expect(code).toBe(0);
    },
    SLOW,
  );

  test(
    "in the Work pane, q and Ctrl+C stay in the shell",
    async () => {
      expect((await launchOnTerminal("q", { KINAS_ENTER: "herdr" })).code).toBe(10);
      expect((await launchOnTerminal("\x03", { KINAS_ENTER: "herdr" })).code).toBe(10);
    },
    SLOW,
  );

  test(
    "Tab and arrows do nothing: Tab then Enter still opens Herdr, an arrow then Ctrl+C still stays",
    async () => {
      expect((await launchOnTerminal("\t\r", { KINAS_ENTER: "herdr" })).code).toBe(0);
      expect((await launchOnTerminal("\t\x1b[Aq", { KINAS_ENTER: "herdr" })).code).toBe(10);
    },
    SLOW,
  );

  test(
    "run by hand, q simply closes it",
    async () => {
      const { code, screen } = await launchOnTerminal("q");
      expect(screen).toContain("close");
      expect(code).toBe(0);
    },
    SLOW,
  );
});
