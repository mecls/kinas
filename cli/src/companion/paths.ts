// Where `kinas companion` keeps its state and finds Firstmate's home, Herdr, the client folders and the first mate's
// program on the VPS (docs/external/vps.md): ~/.local/state/kinas, ~/.local/share/kinas/firstmate, ~/.local/bin/herdr,
// ~/projects and `claude` (found by the pane's own login shell there), or under <KINAS_COMPANION_ROOT> when that is set
// (tests, the e2e's fake VPS): state/, firstmate/, bin/herdr, projects/ and bin/claude, a stand-in that records its
// arguments — so no test on this Mac ever types the real `claude` into a pane.

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
  /** The client folders' working copies (`KINAS_ROOT` there): Open in the terminal's folders live under it. */
  projects: string;
  /** The first mate's program, as the launcher types it into a pane: `claude`, or a test root's stand-in. */
  claude: string;
  // Setup (build spec §12 slice 4.2). Under a test root each of these is inside it, so no test writes a unit, a marker
  // or a binary anywhere else, and none runs the machine's own systemctl or gh.
  /** Where setup installs binaries: ~/.local/bin (Herdr, the crew's release tools, Kinas itself). */
  bin: string;
  /** systemd's folder for the captain's own units: ~/.config/systemd/user. */
  units: string;
  /** systemd's two programs, by path: /usr/bin/systemctl and /usr/bin/loginctl. */
  systemctl: string;
  loginctl: string;
  /** GitHub's CLI: `gh`, found on the companion's PATH; a test root's stand-in. */
  gh: string;
  /** Claude Code's folder, only ever looked at: whether its credentials file exists. Never written. */
  claudeHome: string;
  /** The machine's /etc/os-release, for the System row. */
  osRelease: string;
  /** Under a test root only (§17 2026-11-25 #8): release files and their pins, so no test downloads. Null on a machine. */
  releases: string | null;
  /** The test root itself, so a write that would leave it is refused; null on a machine. */
  root: string | null;
}

export function companionPaths(env: Record<string, string | undefined> = process.env, home = homedir()): Paths {
  const root = env.KINAS_COMPANION_ROOT;
  const state = root ? join(root, "state") : join(home, ".local", "state", "kinas");
  const fm = root ? join(root, "firstmate") : join(home, ".local", "share", "kinas", "firstmate");
  const herdr = root ? join(root, "bin", "herdr") : join(home, ".local", "bin", "herdr");
  const projects = root ? join(root, "projects") : join(home, "projects");
  const claude = root ? join(root, "bin", "claude") : "claude";
  const setup = root
    ? {
        bin: join(root, "bin"),
        units: join(root, "systemd", "user"),
        systemctl: join(root, "bin", "systemctl"),
        loginctl: join(root, "bin", "loginctl"),
        gh: join(root, "bin", "gh"),
        claudeHome: join(root, "claude-home"),
        osRelease: join(root, "os-release"),
        releases: join(root, "releases"),
        root,
      }
    : {
        bin: join(home, ".local", "bin"),
        units: join(home, ".config", "systemd", "user"),
        systemctl: "/usr/bin/systemctl",
        loginctl: "/usr/bin/loginctl",
        gh: "gh",
        claudeHome: join(home, ".claude"),
        osRelease: "/etc/os-release",
        releases: null,
        root: null,
      };
  return { state, home: fm, reading: join(state, "reading.json"), herdr, projects, claude, ...setup };
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

/**
 * The PATH both systemd units set (the captain, 2026-11-25; build spec §17): ~/.local/bin, then fnm's default alias,
 * then the system's — fixed, whether or not Node is there yet, so a pane under Herdr's unit finds claude, node and herdr.
 */
export function unitPath(home: string): string {
  return [join(home, ".local", "bin"), join(home, NODE_DIRS[0]!), ...SYSTEM_PATH].join(":");
}
