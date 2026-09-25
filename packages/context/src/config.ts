// Where the operation lives. Everything has a default; `~/.config/kinas/config.json` (or `KINAS_CONFIG`) overrides:
//
//   { "org": "SintraLabs", "instance": "operations", "root": "~/Documents/Projects/SintraLabs",
//     "hub": ".", "firstmate_home": "~/Library/Application Support/ai.sintralabs.kinas/firstmate",
//     "harness": "claude", "model": "opus" }
//
// Environment variables win over the file: KINAS_ROOT, FM_HOME, HERDR_SOCKET_PATH, CODEX_HOME, PI_CODING_AGENT_DIR.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { dataDir, readSetting } from "@kinas/store/sqlite-readonly";

export interface KinasConfig {
  org: string;
  instance: string;
  /** The folder holding every project. */
  root: string;
  /** Where the org-level conventions live: AGENTS.md and con-*.md. Defaults to the root. */
  hub: string;
  firstmateHome: string;
  herdrSocket: string;
  codexHome: string;
  piAgentDir: string;
  claudeDir: string;
  /** Configured harness and model for interactive sessions; null means detect. */
  harness: string | null;
  model: string | null;
  /** The app's data folder: its store, and the CLI's cache beside it. */
  dataDir: string;
  /** The config file that was read; null when only defaults apply. */
  file: string | null;
  /** A config file that exists but could not be used, in one line. */
  problem: string | null;
}

type Env = Record<string, string | undefined>;

export function configPath(env: Env = process.env): string {
  return env.KINAS_CONFIG || join(homedir(), ".config/kinas/config.json");
}

function expand(path: string, base: string = homedir()): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return isAbsolute(path) ? path : resolve(base, path);
}

export function loadConfig(env: Env = process.env): KinasConfig {
  const path = configPath(env);
  let raw: Record<string, unknown> = {};
  let file: string | null = null;
  let problem: string | null = null;
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
        file = path;
      } else {
        problem = `${path} is not a JSON object; using defaults`;
      }
    } catch (e) {
      problem = `${path} could not be read (${(e as Error).message}); using defaults`;
    }
  }
  const text = (key: string): string | undefined => {
    const v = raw[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };

  // The projects folder: KINAS_ROOT, then what the app's Settings page saved (read from the store, read-only, so it
// works with Kinas quit), then this file's `root`, then the default (reader R1, amended 2026-09-16).
  const saved = readSetting(dataDir(env), "projects_root");
  const savedRoot = typeof saved === "string" && saved.trim() !== "" ? saved.trim() : undefined;
  const root = expand(env.KINAS_ROOT || savedRoot || text("root") || "~/Documents/Projects/SintraLabs");
  return {
    org: text("org") ?? "SintraLabs",
    instance: text("instance") ?? "operations",
    root,
    hub: expand(text("hub") ?? ".", root),
    // Kinas's own clone of Firstmate (the first mate, 2026-09-25): `kinas crew setup` puts it in the data folder.
    firstmateHome: expand(env.FM_HOME || text("firstmate_home") || join(dataDir(env), "firstmate")),
    herdrSocket: expand(env.HERDR_SOCKET_PATH || text("herdr_socket") || "~/.config/herdr/herdr.sock"),
    codexHome: expand(env.CODEX_HOME || text("codex_home") || "~/.codex"),
    piAgentDir: expand(env.PI_CODING_AGENT_DIR || text("pi_agent_dir") || "~/.pi/agent"),
    claudeDir: expand(env.CLAUDE_CONFIG_DIR || text("claude_dir") || "~/.claude"),
    harness: text("harness") ?? null,
    model: text("model") ?? null,
    dataDir: dataDir(env),
    file,
    problem,
  };
}

/** True when `path` is the root or inside it. */
export function insideRoot(config: KinasConfig, path: string): boolean {
  const p = resolve(path);
  return p === config.root || p.startsWith(`${config.root}/`);
}
