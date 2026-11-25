// Where the operation lives. Everything has a default; `~/.config/kinas/config.json` (or `KINAS_CONFIG`) overrides:
//
//   { "org": "SintraLabs", "instance": "operations", "root": "~/Documents/Projects/SintraLabs",
//     "hub": ".", "firstmate_home": "~/Library/Application Support/ai.sintralabs.kinas/firstmate",
//     "harness": "claude", "model": "opus" }
//
// Environment variables win over the file: KINAS_ROOT, FM_HOME, HERDR_SOCKET_PATH, CODEX_HOME, PI_CODING_AGENT_DIR,
// CLAUDE_CONFIG_DIR.

import { existsSync, readFileSync, realpathSync } from "node:fs";
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

/**
 * On the Linux machine (slice 5.3) the defaults are the companion's: the client folders it clones into `~/projects`, and
 * Firstmate's home under `~/.local/share/kinas` (`cli/src/companion/paths.ts`; a test there holds the two equal).
 */
export function loadConfig(env: Env = process.env, platform: string = process.platform): KinasConfig {
  const linux = platform === "linux";
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
  const saved = readSetting(dataDir(env, platform), "projects_root");
  const savedRoot = typeof saved === "string" && saved.trim() !== "" ? saved.trim() : undefined;
  // Trimmed, and blank is unset, as the app reads it (paths.rs `projects_root_with`): the two judge the same root.
  const root = expand(env.KINAS_ROOT?.trim() || savedRoot || text("root") || (linux ? "~/projects" : "~/Documents/Projects/SintraLabs"));
  return {
    org: text("org") ?? "SintraLabs",
    instance: text("instance") ?? "operations",
    root,
    hub: expand(text("hub") ?? ".", root),
    // Kinas's own clone of Firstmate (the first mate, 2026-09-25): `kinas crew setup` puts it in the data folder.
    firstmateHome: expand(env.FM_HOME || text("firstmate_home") || (linux ? "~/.local/share/kinas/firstmate" : join(dataDir(env, platform), "firstmate"))),
    herdrSocket: expand(env.HERDR_SOCKET_PATH || text("herdr_socket") || "~/.config/herdr/herdr.sock"),
    codexHome: expand(env.CODEX_HOME || text("codex_home") || "~/.codex"),
    piAgentDir: expand(env.PI_CODING_AGENT_DIR || text("pi_agent_dir") || "~/.pi/agent"),
    claudeDir: expand(env.CLAUDE_CONFIG_DIR || text("claude_dir") || "~/.claude"),
    harness: text("harness") ?? null,
    model: text("model") ?? null,
    dataDir: dataDir(env, platform),
    file,
    problem,
  };
}

/** `path` resolved on disk after symlinks, or merely normalised when it does not exist. */
function real(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

const under = (p: string, root: string): boolean => p === root || p.startsWith(`${root}/`);

/**
 * True when `path` is the root or inside it. Both are judged as written and as they are on disk (`resolve` drops a
 * trailing slash and `..`; `realpath` follows a symlinked root or a symlinked folder), so a hook started in a real
 * path under a root written through a link still gets its packet. Either side is enough here: a session's folder is
 * judged as the shell handed it over. `kinas open` is stricter with a file — its real path alone, against the real
 * root (open.ts `at`) — because that path is handed to the app.
 */
export function insideRoot(config: KinasConfig, path: string): boolean {
  const root = resolve(config.root);
  return under(resolve(path), root) || under(real(path), real(root));
}
