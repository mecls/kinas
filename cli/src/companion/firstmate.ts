// The only file in the companion that names a Firstmate script, and its only runner (build spec §6.6, §11.2 `FmCall`;
// ADRs 0020, 0022). The list is a type: four read-only scripts with Kinas's argv and limits
// (app/src-tauri/src/crew/firstmate.rs), the read-only hold check, and the inbox's `note` and `receipts` — the one write,
// ADR 0022's. `fm-send.sh`, any hold, spawn, park or teardown script is never run; firstmate.test.ts holds the guard.
//
// Each runs as Kinas runs it on the Mac: `bash <home>/bin/<script> <args>`, cwd the home, FM_HOME the home, the PATH
// the companion builds from constants (paths.ts `companionPath`), no inherited HERDR_*, stdin closed unless the call
// carries one, killed at its limit.

import { run } from "@kinas/context";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type AfkField = "entered" | "expected_return";

export type FmCall =
  | { script: "fm-fleet-snapshot.sh"; args: ["--json"] }
  | { script: "fm-capacity.sh"; args: ["--json"] }
  | { script: "fm-afk-contract.sh"; args: ["field", AfkField] }
  | { script: "fm-project-mode.sh"; args: [string] }
  | { script: "fm-captain-hold.sh"; args: ["open", string, "--distinguish-absent"] }
  | { script: "fm-inbox.sh"; args: ["note", "--request-id", string, "--json", "-"]; stdin: string }
  | { script: "fm-inbox.sh"; args: ["receipts", "--json"] };

/** The calls, by what they are for: the only way the rest of the companion names one. */
export const CALL = {
  snapshot: { script: "fm-fleet-snapshot.sh", args: ["--json"] },
  capacity: { script: "fm-capacity.sh", args: ["--json"] },
  afk: (name: AfkField): FmCall => ({ script: "fm-afk-contract.sh", args: ["field", name] }),
  mode: (project: string): FmCall => ({ script: "fm-project-mode.sh", args: [project] }),
  holdOpen: (task: string): FmCall => ({ script: "fm-captain-hold.sh", args: ["open", task, "--distinguish-absent"] }),
  note: (requestId: string, words: string): FmCall => ({ script: "fm-inbox.sh", args: ["note", "--request-id", requestId, "--json", "-"], stdin: words }),
  receipts: { script: "fm-inbox.sh", args: ["receipts", "--json"] },
} as const satisfies Record<string, FmCall | ((...a: never[]) => FmCall)>;

/** One script's answer, as the Mac's `bundle.rs` `ScriptOut` reads it. `stderr_first` is never logged. */
export interface ScriptOut {
  exit: number | null;
  timed_out: boolean;
  stdout: string;
  stderr_first: string | null;
}

export interface Firstmate {
  run(call: FmCall, limitMs: number): Promise<ScriptOut>;
}

/** Kinas's limits (crew/firstmate.rs): the snapshot 20 s, a setting 3 s, capacity 10 s. */
export const LIMITS = { snapshot: 20_000, setting: 3_000, capacity: 10_000, hold: 5_000, inbox: 10_000 } as const;

/** Whether Firstmate's home is there: its snapshot script, as the Mac's `home::installed` asks. */
export function installed(home: string): boolean {
  try {
    return statSync(join(home, "bin", "fm-fleet-snapshot.sh")).isFile();
  } catch {
    return false;
  }
}

/** The environment a script runs with: the companion's own, less any Herdr pane identity, with PATH and FM_HOME set. */
export function scriptEnv(parent: Record<string, string | undefined>, home: string, path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) if (v !== undefined && !k.toUpperCase().includes("HERDR")) env[k] = v;
  env.PATH = path;
  env.FM_HOME = home;
  return env;
}

export function firstmate(home: string, path: string, parent: Record<string, string | undefined> = process.env): Firstmate {
  const env = scriptEnv(parent, home, path);
  return {
    async run(call, limitMs) {
      const stdin = "stdin" in call ? call.stdin : undefined;
      const r = await run(["bash", join(home, "bin", call.script), ...call.args], { cwd: home, env, timeoutMs: limitMs, stdin });
      const first = r.stderr.split("\n").find((l) => l.trim() !== "");
      return { exit: r.timedOut ? null : r.code, timed_out: r.timedOut, stdout: r.stdout, stderr_first: first ?? (r.error && !r.timedOut ? r.error : null) };
    },
  };
}

/** `config/lane-capacity` as Firstmate reads it (fm-capacity.sh `parse_lane_config`; the Mac's `config::lane_config`). */
export type LaneConfig = { kind: "absent" } | { kind: "cap"; cap: number } | { kind: "auto" } | { kind: "quota" } | { kind: "invalid" };

export function laneConfigOf(text: string): LaneConfig {
  const lines = text
    .split("\n")
    .map((l) => (l.split("#")[0] ?? "").replace(/[\t\r]/g, " ").trim())
    .filter((l) => l !== "");
  const first = lines.shift();
  if (first === undefined) return { kind: "invalid" };
  let head: LaneConfig;
  if (first === "auto") head = { kind: "auto" };
  else if (first.length <= 9 && /^[0-9]+$/.test(first)) head = { kind: "cap", cap: Number(first) };
  else return { kind: "invalid" };
  return lines.some((l) => l.split(" ")[0] === "quota-provider") ? { kind: "quota" } : head;
}

/** The gate: capacity is read only with a cap or `auto`, never with a `quota-provider` (ADR 0020). */
export function laneConfig(home: string): LaneConfig {
  const file = join(home, "config", "lane-capacity");
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > 1024 * 1024) return { kind: "absent" };
    return laneConfigOf(readFileSync(file, "utf8"));
  } catch {
    return { kind: "absent" };
  }
}
