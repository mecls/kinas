// Where `kinas companion` keeps its state and finds Firstmate's home on the VPS (docs/external/vps.md):
// ~/.local/state/kinas and ~/.local/share/kinas/firstmate, or <KINAS_COMPANION_ROOT>/state and
// <KINAS_COMPANION_ROOT>/firstmate when that is set (tests, and the e2e's fake VPS).

import { homedir } from "node:os";
import { join } from "node:path";

export interface Paths {
  /** The companion's own folder: the latest reading, its event log and its cursors. */
  state: string;
  /** Firstmate's home (`FM_HOME`). */
  home: string;
  /** The latest reading, replaced whole by the run loop and read by `rpc bundle`. */
  reading: string;
}

export function companionPaths(env: Record<string, string | undefined> = process.env, home = homedir()): Paths {
  const root = env.KINAS_COMPANION_ROOT;
  const state = root ? join(root, "state") : join(home, ".local", "state", "kinas");
  const fm = root ? join(root, "firstmate") : join(home, ".local", "share", "kinas", "firstmate");
  return { state, home: fm, reading: join(state, "reading.json") };
}
