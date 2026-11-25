// The only file in the companion that names a Herdr verb, and its only runner (build spec §11.2; ADR 0024: every Herdr
// call but the Work page's attach runs on the VPS through `kinas companion`, with the Mac's fixed argv —
// app/src-tauri/src/herdr.rs). The list is a type: the session's snapshot, a pane's process info, focusing a
// workspace, making one in a folder with a label, and `pane run` — which types the launcher's one command at a pane's
// shell prompt (crew/launch.rs) and nothing else. Never `server`, `session`, `pane close`, `workspace close`, `update`
// or `machine`; herdr.test.ts holds the guard.
//
// Each runs as `<paths.herdr> --session <session> <args>`, by path, with the companion's PATH and HOME and no inherited
// HERDR_* (a companion started from a Herdr pane would be refused as nested), stdin closed, killed at 5 s.

import { run } from "@kinas/context";

export type HerdrCall =
  | { args: readonly ["api", "snapshot"] }
  | { args: readonly ["pane", "process-info", "--pane", string] }
  | { args: readonly ["workspace", "focus", string] }
  | { args: readonly ["workspace", "create", "--cwd", string, "--label", string, "--focus"] }
  | { args: readonly ["pane", "run", string, string] };

/** The calls, by what they are for: the only way the rest of the companion names one. */
export const HERDR = {
  snapshot: (): HerdrCall => ({ args: ["api", "snapshot"] }),
  processInfo: (pane: string): HerdrCall => ({ args: ["pane", "process-info", "--pane", pane] }),
  focus: (workspace: string): HerdrCall => ({ args: ["workspace", "focus", workspace] }),
  create: (cwd: string, label: string): HerdrCall => ({ args: ["workspace", "create", "--cwd", cwd, "--label", label, "--focus"] }),
  run: (pane: string, command: string): HerdrCall => ({ args: ["pane", "run", pane, command] }),
} as const;

export const HERDR_LIMIT_MS = 5_000;

export interface HerdrOut {
  ok: boolean;
  stdout: string;
}

export type Herdr = (call: HerdrCall) => Promise<HerdrOut>;

/** The environment Herdr runs with: the companion's own, less any Herdr pane identity, with PATH and HOME set. */
export function herdrEnv(parent: Record<string, string | undefined>, path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) if (v !== undefined && !k.toUpperCase().includes("HERDR")) env[k] = v;
  env.PATH = path;
  env.HOME = parent.HOME ?? "";
  return env;
}

export function herdrAt(program: string, session: string, path: string, parent: Record<string, string | undefined> = process.env): Herdr {
  const env = herdrEnv(parent, path);
  return async (call) => {
    const r = await run([program, "--session", session, ...call.args], { env, timeoutMs: HERDR_LIMIT_MS });
    return { ok: r.ok, stdout: r.ok ? r.stdout : "" };
  };
}

/** Herdr's view of the session, as `herdr.rs` `parse_view` reads `api snapshot`. */
export interface View {
  focusedPane: string | null;
  workspaces: { id: string; label: string; number: number; focused: boolean }[];
  panes: { id: string; workspaceId: string; focused: boolean }[];
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)) : [];

export function parseView(json: string): View | null {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return null;
  }
  const snap = (root as { result?: { snapshot?: unknown } } | null)?.result?.snapshot;
  if (typeof snap !== "object" || snap === null) return null;
  const s = snap as Record<string, unknown>;
  const workspaces = list(s.workspaces).flatMap((w) => {
    const id = str(w.workspace_id);
    const label = str(w.label);
    if (id === null || label === null) return [];
    return [{ id, label, number: typeof w.number === "number" ? w.number : Number.MAX_SAFE_INTEGER, focused: w.focused === true }];
  });
  const panes = list(s.panes).flatMap((p) => {
    const id = str(p.pane_id);
    const workspaceId = str(p.workspace_id);
    return id === null || workspaceId === null ? [] : [{ id, workspaceId, focused: p.focused === true }];
  });
  return { focusedPane: str(s.focused_pane_id), workspaces, panes };
}

/** The workspace carrying `label`: of several, the focused one, else the lowest number (`herdr::workspace_with_label`). */
export function workspaceWithLabel(view: View, label: string): string | null {
  const found = view.workspaces.filter((w) => w.label === label).sort((a, b) => Number(b.focused) - Number(a.focused) || a.number - b.number);
  return found[0]?.id ?? null;
}

/** A workspace's focused pane, else its first (`launch::first_mate_pane`). */
export function paneOf(view: View, workspace: string): string | null {
  const panes = view.panes.filter((p) => p.workspaceId === workspace);
  return (panes.find((p) => p.focused) ?? panes[0])?.id ?? null;
}

/** `pane process-info` → each foreground process's `argv0`, never `name` (`herdr::parse_foreground`). */
export function foregroundOf(json: string): string[] {
  try {
    const procs = (JSON.parse(json) as { result?: { process_info?: { foreground_processes?: unknown } } })?.result?.process_info?.foreground_processes;
    return list(procs).flatMap((p) => (typeof p.argv0 === "string" ? [p.argv0] : []));
  } catch {
    return [];
  }
}

/** `workspace create` → the new workspace's pane, `result.root_pane.pane_id` (`herdr::root_pane`). */
export function rootPane(json: string): string | null {
  try {
    return str((JSON.parse(json) as { result?: { root_pane?: { pane_id?: unknown } } })?.result?.root_pane?.pane_id) ?? null;
  } catch {
    return null;
  }
}
