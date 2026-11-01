import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../packages/context/src/config.ts";
import { specEnv } from "./env.ts";

// What a captain's shell holds when he runs `bun e2e/run.ts` from a Herdr pane on his own Mac: every variable that
// tells the CLI or the app where his config, Firstmate, Codex, Pi and Claude Code live (packages/context/src/config.ts,
// app/src-tauri/src/paths.rs, readers/runtime.rs), and the harness's own screenshot switches.
const CAPTAIN: Record<string, string> = {
  HOME: "/Users/captain",
  PATH: "/usr/bin:/bin",
  LANG: "en_US.UTF-8",
  KINAS_CONFIG: "/Users/captain/.config/kinas/config.json",
  KINAS_ROOT: "/Users/captain/Projects",
  KINAS_DATA_DIR: "/Users/captain/Library/Application Support/ai.sintralabs.kinas",
  KINAS_CLAUDE_PROJECTS_DIR: "/Users/captain/.claude/projects",
  KINAS_HERDR_SESSION: "default",
  KINAS_E2E_CREW_COMMAND: "/Users/captain/.local/bin/claude",
  KINAS_E2E_OLLAMA_KEY: "ollama-captain-key",
  FM_HOME: "/Users/captain/firstmate",
  CODEX_HOME: "/Users/captain/.codex",
  PI_CODING_AGENT_DIR: "/Users/captain/.pi/agent",
  CLAUDE_CONFIG_DIR: "/Users/captain/.claude",
  HERDR_SOCKET_PATH: "/Users/captain/.config/herdr/herdr.sock",
  HERDR_PANE_ID: "p-1",
  KINAS_E2E_SHOT: "/tmp/board.png",
  KINAS_E2E_SHOTS: "/tmp/shots",
};

const DATA = "/tmp/kinas-e2e-abc";
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("each spec's environment", () => {
  test("names none of the captain's places: every variable that would point a reader at them is gone or the harness's own", () => {
    const { env } = specEnv(CAPTAIN, DATA);
    // HOME stays (the app's log and Herdr live under it); nothing else may name a place inside it.
    const captains = Object.entries(env).filter(([k, v]) => k !== "HOME" && v.includes("/Users/captain/"));
    expect(captains.map(([k]) => k)).toEqual([]);
    for (const key of Object.keys(env)) expect(key.toUpperCase()).not.toContain("HERDR");
    for (const key of ["FM_HOME", "CODEX_HOME", "PI_CODING_AGENT_DIR", "CLAUDE_CONFIG_DIR", "KINAS_E2E_OLLAMA_KEY", "KINAS_E2E_CREW_COMMAND", "KINAS_HERDR_SESSION"]) {
      expect(env[key]).toBeUndefined();
    }
  });

  test("the CLI's config resolves every place it reads inside the spec's data folder, none of them in HOME", () => {
    // Read through the CLI's own loadConfig, on disk as run.ts leaves it: the config file, the Herdr socket, Codex, Pi
    // and Claude Code would otherwise default to ~/.config/kinas, ~/.config/herdr, ~/.codex, ~/.pi and ~/.claude.
    const data = mkdtempSync(join(tmpdir(), "kinas-e2e-env-"));
    scratch.push(data);
    const { env, folders, files } = specEnv(CAPTAIN, data);
    for (const folder of folders) mkdirSync(folder, { recursive: true });
    for (const [path, text] of Object.entries(files)) writeFileSync(path, text);
    const config = loadConfig(env);
    expect(config.file).toBe(join(data, "harness-config.json"));
    expect(config.problem).toBeNull();
    const places = { root: config.root, firstmate: config.firstmateHome, herdr: config.herdrSocket, codex: config.codexHome, pi: config.piAgentDir, claude: config.claudeDir, data: config.dataDir };
    for (const [what, path] of Object.entries(places)) expect([what, path.startsWith(`${data}/`) || path === data]).toEqual([what, true]);
    expect(config.firstmateHome).toBe(join(data, "firstmate"));
    // A setup that clears KINAS_ROOT (settings.setup.ts gives its own file too) still finds the empty root in this one.
    expect(loadConfig({ ...env, KINAS_ROOT: "" }).root).toBe(join(data, "root"));
  });

  test("keeps the rest of the run's environment, and the switches a captain passes to the specs on purpose", () => {
    const { env } = specEnv(CAPTAIN, DATA);
    expect(env.HOME).toBe("/Users/captain");
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.KINAS_E2E_SHOT).toBe("/tmp/board.png");
    expect(env.KINAS_E2E_SHOTS).toBe("/tmp/shots");
    expect(env.KINAS_DATA_DIR).toBe(DATA);
    expect(env.KINAS_ROOT).toBe(`${DATA}/root`);
    expect(env.KINAS_PANE_SHELL_ONLY).toBe("1");
  });
});
