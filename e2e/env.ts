// The environment every spec's app, CLI and WebdriverIO worker start with (run.ts), as a pure function so a Bun test can
// hold it: the run's own environment, minus anything that names a place the app or the CLI reads, plus the harness's own
// isolation. A spec's `setup` may then add or override variables of its own.

type Env = Record<string, string | undefined>;

export interface SpecEnv {
  env: Record<string, string>;
  /** Folders the harness points a reader at; run.ts creates each, empty, before the spec starts. */
  folders: string[];
  /** Files run.ts writes before the spec's setup runs: path → contents. */
  files: Record<string, string>;
}

/**
 * Where the CLI finds Firstmate, Codex, Pi and Claude Code when they are set (packages/context/src/config.ts). Herdr's own
 * variables, HERDR_SOCKET_PATH among them, go by the HERDR rule below.
 */
const PLACES = new Set(["FM_HOME", "CODEX_HOME", "PI_CODING_AGENT_DIR", "CLAUDE_CONFIG_DIR"]);

/** The harness's switches a captain sets for a run on purpose, which the specs read: where to keep their pictures. */
const PASSED = new Set(["KINAS_E2E_SHOT", "KINAS_E2E_SHOTS"]);

/**
 * True for a variable no spec inherits from the run. Every `KINAS_*` the app or the CLI reads names a place (KINAS_CONFIG,
 * KINAS_ROOT, the transcript roots), a key or a command a test hook acts on, so only the harness and the spec's setup
 * set them; anything with HERDR in its name is a Herdr pane's identity, which a test app launched inside one must not
 * take on.
 */
export function dropped(key: string): boolean {
  if (key.toUpperCase().includes("HERDR")) return true;
  if (PLACES.has(key)) return true;
  return key.startsWith("KINAS_") && !PASSED.has(key);
}

export function specEnv(parent: Env, dataDir: string): SpecEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined && !dropped(key)) env[key] = value;
  }
  const empty = (name: string) => `${dataDir}/empty/${name}`;
  env.KINAS_DATA_DIR = dataDir;
  // No spec attaches Herdr's `default` session (build spec invariant 20): a plain shell unless the
  // spec's setup asks for a throwaway session explicitly.
  env.KINAS_PANE_SHELL_ONLY = "1";
  // Readers see empty transcript roots, an unreachable Ollama and an in-memory Keychain unless the spec's
  // setup says otherwise: no e2e run reads Miguel's history, calls ollama.com or touches his Keychain.
  env.KINAS_CLAUDE_PROJECTS_DIR = empty("claude");
  env.KINAS_PI_SESSIONS_DIR = empty("pi");
  env.KINAS_OLLAMA_BASE_URL = "http://127.0.0.1:9";
  // Unreachable by default, so no spec but the one that sets up a stub can reach a real Convex deployment.
  env.KINAS_CONVEX_BASE_URL = "http://127.0.0.1:9";
  // Same for Hostinger, and it matters more here: that token can restart or recreate a real machine.
  env.KINAS_HOSTINGER_BASE_URL = "http://127.0.0.1:9";
  env.KINAS_E2E_MEMORY_KEYCHAIN = "1";
  // Test launches never register the real global hotkey or a login item.
  env.KINAS_E2E_NO_SYSTEM_HOOKS = "1";
  // The sidebar lists the repositories under the projects root (projects.rs) on every launch, so a spec that sets
  // no root of its own gets an empty one here rather than Miguel's real folder.
  env.KINAS_ROOT = `${dataDir}/root`;
  // The crew's tool health looks only in this (empty) folder and the system's own, never at the tools installed on this
  // Mac (login_path.rs); a crew spec's setup points it at its stub tools instead.
  env.KINAS_E2E_TOOL_DIR = empty("tools");
  // The CLI a spec runs (`kinas open`, `kinas crew status`, `kinas context`) reads this config file, not
  // ~/.config/kinas/config.json, and the app reads its root (paths.rs) when a setup clears KINAS_ROOT: the same empty
  // root, a Herdr socket nothing listens on in place of the captain's live session, and empty Codex, Pi and Claude Code
  // homes in place of their defaults under HOME. Kinas's own file, so no variable that Herdr, Codex, Pi or Claude Code
  // read is set for a program in a pane. Firstmate's default is already the spec's data folder (`<data>/firstmate`).
  env.KINAS_CONFIG = `${dataDir}/harness-config.json`;
  const config = { root: env.KINAS_ROOT, herdr_socket: empty("herdr.sock"), codex_home: empty("codex"), pi_agent_dir: empty("pi-agent"), claude_dir: empty("claude-config") };
  return {
    env,
    folders: [empty("claude"), empty("pi"), config.codex_home, config.pi_agent_dir, config.claude_dir, env.KINAS_ROOT, empty("tools")],
    files: { [env.KINAS_CONFIG]: `${JSON.stringify(config, null, 2)}\n` },
  };
}
