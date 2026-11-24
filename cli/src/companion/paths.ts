// Where `kinas companion` keeps its state and finds Firstmate's home and Herdr on the VPS (docs/external/vps.md):
// ~/.local/state/kinas, ~/.local/share/kinas/firstmate and ~/.local/bin/herdr, or <KINAS_COMPANION_ROOT>/state,
// <KINAS_COMPANION_ROOT>/firstmate and <KINAS_COMPANION_ROOT>/bin/herdr when that is set (tests, the e2e's fake VPS).

import { homedir } from "node:os";
import { join } from "node:path";

export interface Paths {
  /** The companion's own folder: the latest reading, its event log and its cursors. */
  state: string;
  /** Firstmate's home (`FM_HOME`). */
  home: string;
  /** The latest reading, replaced whole by the run loop and read by `rpc bundle`. */
  reading: string;
  /** Herdr where setup puts it and the captain's own install already is: run by this path, never looked up on a PATH. */
  herdr: string;
}

export function companionPaths(env: Record<string, string | undefined> = process.env, home = homedir()): Paths {
  const root = env.KINAS_COMPANION_ROOT;
  const state = root ? join(root, "state") : join(home, ".local", "state", "kinas");
  const fm = root ? join(root, "firstmate") : join(home, ".local", "share", "kinas", "firstmate");
  const herdr = root ? join(root, "bin", "herdr") : join(home, ".local", "bin", "herdr");
  return { state, home: fm, reading: join(state, "reading.json"), herdr };
}

/**
 * Where Node may be, in order (build spec §17, 2026-11-24 #1): fnm's `default` alias, then Volta. Constants, never read
 * from a shell's startup files, which neither the door's non-interactive ssh nor a systemd unit runs.
 */
export const NODE_DIRS: readonly string[] = [".local/share/fnm/aliases/default/bin", ".volta/bin"];
/** The system's own folders, last. */
export const SYSTEM_PATH: readonly string[] = ["/usr/local/bin", "/usr/bin", "/bin"];

/** The first of NODE_DIRS under `home` that holds a `node` it can run, or null. */
export function nodeDir(home: string, executable: (path: string) => boolean): string | null {
  for (const dir of NODE_DIRS) if (executable(join(home, dir, "node"))) return join(home, dir);
  return null;
}

/**
 * The PATH every child of the companion runs with — Firstmate's scripts, Herdr, gh, claude: `~/.local/bin` (Kinas, Herdr,
 * claude), then Node's folder when there is one, then the system's. Never the caller's own PATH.
 */
export function companionPath(home: string, executable: (path: string) => boolean): string {
  const node = nodeDir(home, executable);
  return [join(home, ".local", "bin"), ...(node ? [node] : []), ...SYSTEM_PATH].join(":");
}
