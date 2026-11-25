// Setup on the VPS (build spec §12 slice 4.2; §17 2026-11-24 #1–#4 and 2026-11-25 #3–#7; ADRs 0024, 0025): what
// `hello` reports as checks, one row per piece in a fixed order, and what install.ts may put there. A row is facts and
// fixed words: the Mac caps and filters them, and offers Install only for the items named here.
//
// Read-only. The one read that sees values is the API-key check's: the captain's login shell's environment, from the
// fixed argv `bash -l -c 'env -0'` (a constant string, no input in it), split on NUL with only each entry's name kept;
// the values are never stored, logged or returned (invariant 3). Claude Code's folder is only looked at for whether its
// credentials file exists; nothing is read from it or written to it.

import { atLeast, FIRSTMATE_PIN, TOOLS, versionOf, type Arch, type LinuxRelease } from "@kinas/commands/crew-tools";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { packageVersion } from "../crew-setup.ts";
import { HERDR, serverOf, type Herdr } from "./herdr.ts";
import type { Paths } from "./paths.ts";
import { isKinasCopy, sha256Of } from "./written.ts";

export { isKinasCopy, sha256Of };

export const CHECK_IDS = [
  "system",
  "herdr",
  "herdr-server",
  "firstmate",
  "relay-rule",
  "permission-mode",
  "tools",
  "node",
  "companion",
  "linger",
  "claude",
  "gh",
  "api-key",
  "projects",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** `later`: waits for an earlier row (Firstmate's settings wait for Firstmate). */
export type CheckState = "ok" | "warn" | "bad" | "later";

export const INSTALL_ITEMS = [
  "herdr",
  "herdr-service",
  "firstmate",
  "relay-rule",
  "permission-mode",
  "crew-tools",
  "companion-service",
  "clone",
] as const;
export type InstallItem = (typeof INSTALL_ITEMS)[number];

export interface Check {
  id: CheckId;
  state: CheckState;
  detail: string;
  /** What Install does for this row; absent when Kinas installs nothing here. */
  install?: InstallItem;
  /** Install stops something already running (Herdr's server outside the unit): the Mac says so before the click. */
  adopt?: true;
  /** A command for the captain to run there themselves, from the Mac's fixed shapes. */
  run?: string;
}

export interface RunOut {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}
/** A fixed argv, no shell, with the companion's PATH and HOME (main.ts). */
export type Runner = (argv: string[], opts: { timeoutMs: number; cwd?: string }) => Promise<RunOut>;

/** The release files setup installs, and where their bytes come from. */
export interface Releases {
  pins: readonly LinuxRelease[];
  /** Puts the asset's bytes at `dest`; false when it could not. The caller checks the SHA-256. */
  fetch(release: LinuxRelease, asset: string, dest: string): Promise<boolean>;
}

export interface SetupDeps {
  paths: Paths;
  /** The captain's home on the machine. */
  home: string;
  user: string;
  uid: number;
  platform: string;
  arch: string;
  /** The companion's own environment: read only for whether ANTHROPIC_API_KEY is in it. */
  env: Record<string, string | undefined>;
  /** The PATH the companion's children run with (paths.ts `companionPath`). */
  path: string;
  /** Node's folder, when one of NODE_DIRS holds it. */
  node: string | null;
  run: Runner;
  herdr: Herdr;
  releases: Releases;
  /** A command on `path`, found without running anything. */
  which: (name: string) => string | null;
  /** Cores, memory and the home's free disk, for the System row. */
  machine: () => { cores: number; memBytes: number; freeBytes: number | null };
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** The first line of every unit setup writes: one without it is not Kinas's, and is never overwritten. */
export const UNIT_HEADER = "# Written by `kinas companion install` (Kinas, the factory in the cloud). Kinas rewrites this file.";
export const HERDR_UNIT = "kinas-herdr.service";
export const COMPANION_UNIT = "kinas-companion.service";
/** Firstmate's markers (bin/backends/herdr.sh:1684-1697 at the pin), in the session's socket folder. */
export const OWNER_MARKER = "firstmate-server-owner";
export const REPLACING_MARKER = "firstmate-server-replacing";
export const OWNER_LINE = `systemd user unit ${HERDR_UNIT}`;
/** The session the crew runs in (ADR 0024). */
export const SESSION = "default";

const SHORT_PIN = FIRSTMATE_PIN.slice(0, 7);
const PROBE_MS = 5_000;

// ---------------------------------------------------------------------------------------------------------------------
// Pure readings, each tested on its own.

/** The four entries of ADR 0025's rule, for the home at `home` (absolute): relative and absolute, with and without FM_HOME. */
export function relayEntries(home: string): string[] {
  return [`Bash(bin/fm-send.sh *)`, `Bash(${home}/bin/fm-send.sh *)`, `Bash(FM_HOME=${home} bin/fm-send.sh *)`, `Bash(FM_HOME=${home} ${home}/bin/fm-send.sh *)`];
}

export type RelayState =
  | { kind: "ok" }
  | { kind: "missing"; missing: string[]; settings: Record<string, unknown> | null }
  | { kind: "not-json" }
  | { kind: "not-list" };

/** What the home's `.claude/settings.local.json` holds of the rule. `text` null: the file is not there. */
export function relayState(text: string | null, home: string): RelayState {
  const want = relayEntries(home);
  if (text === null) return { kind: "missing", missing: want, settings: null };
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    return { kind: "not-json" };
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return { kind: "not-json" };
  const permissions = (settings as Record<string, unknown>).permissions;
  if (permissions !== undefined && (typeof permissions !== "object" || permissions === null || Array.isArray(permissions))) return { kind: "not-list" };
  const allow = (permissions as Record<string, unknown> | undefined)?.allow;
  if (allow !== undefined && (!Array.isArray(allow) || allow.some((e) => typeof e !== "string"))) return { kind: "not-list" };
  const have = new Set((allow as string[] | undefined) ?? []);
  const missing = want.filter((e) => !have.has(e));
  return missing.length === 0 ? { kind: "ok" } : { kind: "missing", missing, settings: settings as Record<string, unknown> };
}

/** `config/claude-permission-mode`, as fm-spawn.sh reads it (whitespace removed); null when the file is not there. */
export function permissionModeOf(text: string | null): "auto" | "bypass" | { other: string } {
  if (text === null) return "bypass";
  const token = text.replace(/\s/g, "");
  if (token === "" || token === "bypass") return "bypass";
  if (token === "auto") return "auto";
  return { other: token.slice(0, 24) };
}

const ARCH_WORDS: Record<string, string> = { x64: "x86_64", arm64: "aarch64" };

/** `Debian GNU/Linux 13 (trixie) · x86_64 · 8 cores · 15 GB · 296 GB free`. */
export function systemLine(osRelease: string | null, arch: string, m: { cores: number; memBytes: number; freeBytes: number | null }): string {
  const pretty = /^PRETTY_NAME="?([^"\n]{1,60})"?$/m.exec(osRelease ?? "")?.[1] ?? "Linux";
  const gb = (b: number) => `${Math.round(b / 1024 ** 3)} GB`;
  const parts = [pretty, ARCH_WORDS[arch] ?? arch, `${m.cores} cores`, gb(m.memBytes)];
  if (m.freeBytes !== null) parts.push(`${gb(m.freeBytes)} free`);
  return parts.join(" · ");
}

/** The names in `env -0`'s output. Each value is dropped as its entry is split; none is kept. */
export function namesOf(envZero: string): Set<string> {
  const names = new Set<string>();
  for (const entry of envZero.split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) names.add(entry.slice(0, eq));
  }
  return names;
}

/** A file's SHA-256, hex; null when it cannot be read. */

/** The release pinned for `name`, and whether `arch` is one Kinas has assets for. */
export function pinFor(releases: Releases, name: string): LinuxRelease | null {
  return releases.pins.find((r) => r.name === name) ?? null;
}

export function archOf(arch: string): Arch | null {
  return arch === "x64" || arch === "arm64" ? arch : null;
}


export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** A systemd user unit's state, or null when the user manager does not answer (no bus, no systemctl). */
export async function unitState(d: SetupDeps, unit: string): Promise<"active" | "inactive" | null> {
  const r = await d.run([d.paths.systemctl, "--user", "is-active", unit], { timeoutMs: PROBE_MS });
  const said = r.stdout.trim();
  if (said === "active") return "active";
  return ["inactive", "failed", "activating", "deactivating", "unknown", "reloading"].includes(said) ? "inactive" : null;
}

/** Herdr's server for the session: running, and the folder its socket lives in (where Firstmate's markers go). */
export async function serverNow(d: SetupDeps): Promise<{ running: boolean; dir: string | null } | null> {
  const r = await d.herdr(HERDR.status());
  const s = r.ok ? serverOf(r.stdout) : null;
  return s === null ? null : { running: s.running, dir: s.socket === null ? null : dirname(s.socket) };
}

/** A crew tool on the companion's PATH at a version at or above Firstmate's floor. */
export async function toolOk(d: SetupDeps, tool: (typeof TOOLS)[number]): Promise<boolean> {
  const path = d.which(tool.name);
  if (path === null) return false;
  if (tool.source === "npm") {
    const v = packageVersion(path, tool.name);
    return v !== null && atLeast(v, tool.floor);
  }
  const r = await d.run([path, "--version"], { timeoutMs: PROBE_MS });
  const v = versionOf(`${r.stdout}\n${r.stderr}`);
  if (v === null) return false;
  if (tool.floor === "lease") return (await d.run([path, "get", "--help"], { timeoutMs: PROBE_MS })).stdout.includes("--lease");
  return atLeast(v, tool.floor);
}

/** Whether a folder is a git clone (its `.git` exists). */
export function cloned(folder: string): boolean {
  return existsSync(join(folder, ".git"));
}

// ---------------------------------------------------------------------------------------------------------------------
// The rows.

const row = (id: CheckId, state: CheckState, detail: string, extra: Partial<Check> = {}): Check => ({ id, state, detail, ...extra });

async function system(d: SetupDeps): Promise<Check> {
  if (d.uid === 0) return row("system", "bad", "logged in as root: Kinas installs nothing as root — use your own user");
  if (d.platform !== "linux" && d.paths.root === null) return row("system", "bad", "not Linux: setup works on Linux with systemd");
  return row("system", "ok", systemLine(readText(d.paths.osRelease), d.arch, d.machine()));
}

async function herdr(d: SetupDeps): Promise<Check> {
  if (!existsSync(d.paths.herdr)) return row("herdr", "bad", "not installed", { install: "herdr" });
  const r = await d.run([d.paths.herdr, "--version"], { timeoutMs: PROBE_MS });
  const version = r.ok ? versionOf(r.stdout.slice(0, 200)) : null;
  const ours = await isKinasCopy(d.paths, d.paths.herdr);
  const pin = pinFor(d.releases, "herdr");
  if (version === null) return row("herdr", "bad", ours ? "Kinas's copy does not run" : "yours, and it does not run: Kinas leaves it as it is", ours ? { install: "herdr" } : {});
  if (!ours) return row("herdr", "ok", `${version} · yours: Kinas leaves it as it is`);
  if (pin !== null && version !== pin.version) return row("herdr", "warn", `${version} · Kinas's copy; the pin is ${pin.version}`, { install: "herdr" });
  return row("herdr", "ok", `${version} · installed by Kinas`);
}

async function herdrServer(d: SetupDeps): Promise<Check> {
  if (!existsSync(d.paths.herdr)) return row("herdr-server", "later", "after Herdr");
  const [server, unit] = await Promise.all([serverNow(d), unitState(d, HERDR_UNIT)]);
  if (server === null) return row("herdr-server", "bad", "Herdr's status could not be read");
  if (unit === null) return row("herdr-server", server.running ? "warn" : "bad", "systemd's user manager does not answer: Kinas keeps services with it");
  if (server.running && unit === "active") return row("herdr-server", "ok", "running under systemd");
  if (server.running) {
    return row("herdr-server", "warn", "running, not under systemd: it won't come back after a restart", { install: "herdr-service", adopt: true });
  }
  return row("herdr-server", "bad", "not running", { install: "herdr-service" });
}

async function firstmate(d: SetupDeps): Promise<Check> {
  if (!existsSync(d.paths.home)) return row("firstmate", "bad", "not cloned", { install: "firstmate" });
  if (!cloned(d.paths.home)) return row("firstmate", "bad", "its folder is there but is not a clone: Kinas leaves it as it is");
  const r = await d.run(["git", "-C", d.paths.home, "rev-parse", "HEAD"], { timeoutMs: PROBE_MS });
  const head = r.ok ? r.stdout.trim() : "";
  const backend = (readText(join(d.paths.home, "config", "backend")) ?? "").split("\n")[0]?.trim() ?? "";
  if (head !== FIRSTMATE_PIN) return row("firstmate", "warn", head ? `at ${head.slice(0, 7)}, not Kinas's pin ${SHORT_PIN}` : "its commit could not be read");
  if (backend !== "herdr") return row("firstmate", "warn", `${SHORT_PIN} (pinned), but its backend is ${backend || "unset"}, not herdr`);
  return row("firstmate", "ok", `${SHORT_PIN} (pinned)`);
}

async function relayRule(d: SetupDeps): Promise<Check> {
  if (!cloned(d.paths.home)) return row("relay-rule", "later", "after Firstmate");
  const state = relayState(readText(join(d.paths.home, ".claude", "settings.local.json")), d.paths.home);
  switch (state.kind) {
    case "ok":
      return row("relay-rule", "ok", "the first mate may pass your answers on");
    case "missing":
      return row("relay-rule", "bad", `${4 - state.missing.length} of 4 entries: the first mate can't pass your answers on`, { install: "relay-rule" });
    case "not-json":
      return row("relay-rule", "bad", ".claude/settings.local.json isn't a JSON object: Kinas leaves it as it is");
    case "not-list":
      return row("relay-rule", "bad", "its permissions.allow isn't a list of rules: Kinas leaves it as it is");
  }
}

async function permissionMode(d: SetupDeps): Promise<Check> {
  if (!cloned(d.paths.home)) return row("permission-mode", "later", "after Firstmate");
  const mode = permissionModeOf(readText(join(d.paths.home, "config", "claude-permission-mode")));
  if (mode === "auto") return row("permission-mode", "ok", "auto");
  if (mode === "bypass") {
    return row("permission-mode", "warn", "bypass: on a new machine every worker stops at Claude Code's one-time warning", { install: "permission-mode" });
  }
  return row("permission-mode", "bad", `holds ${mode.other}: Firstmate takes bypass or auto — Kinas leaves it as it is`);
}

async function tools(d: SetupDeps): Promise<Check> {
  const results = await Promise.all(TOOLS.map(async (t) => ({ t, ok: await toolOk(d, t) })));
  const ok = results.filter((r) => r.ok).length;
  const missing = results.filter((r) => !r.ok && r.t.required).map((r) => r.t.name);
  if (missing.length === 0) return row("tools", "ok", `${ok} of ${TOOLS.length} at Kinas's versions`);
  if (d.node === null) return row("tools", "later", `${ok} of ${TOOLS.length} · after Node`);
  return row("tools", "bad", `${ok} of ${TOOLS.length} · missing ${missing.join(", ")}`, { install: "crew-tools" });
}

async function node(d: SetupDeps): Promise<Check> {
  if (d.node === null) return row("node", "bad", "Node is not where Kinas looks: fnm's default alias or Volta");
  return row("node", "ok", `~/${relative(d.home, d.node)}`);
}

async function companion(d: SetupDeps): Promise<Check> {
  const unit = await unitState(d, COMPANION_UNIT);
  if (unit === null) return row("companion", "bad", "systemd's user manager does not answer: Kinas keeps services with it");
  if (unit === "active") return row("companion", "ok", "running under systemd");
  return row("companion", "bad", "not running under systemd", { install: "companion-service" });
}

async function linger(d: SetupDeps): Promise<Check> {
  const r = await d.run([d.paths.loginctl, "show-user", d.user, "--property=Linger"], { timeoutMs: PROBE_MS });
  const said = r.stdout.trim();
  if (said === "Linger=yes") return row("linger", "ok", "on: your services start with the machine");
  if (said === "Linger=no") return row("linger", "warn", "off: your services stop when you log out", { run: `sudo loginctl enable-linger ${d.user}` });
  return row("linger", "warn", "systemd could not say");
}

async function claude(d: SetupDeps): Promise<Check> {
  const present = d.paths.root !== null ? existsSync(d.paths.claude) : d.which("claude") !== null;
  if (!present) return row("claude", "bad", "not installed: install Claude Code in the VPS's terminal");
  if (!existsSync(join(d.paths.claudeHome, ".credentials.json"))) return row("claude", "warn", "not signed in", { run: "claude" });
  return row("claude", "ok", "signed in");
}

async function gh(d: SetupDeps): Promise<Check> {
  const program = d.paths.root !== null ? (existsSync(d.paths.gh) ? d.paths.gh : null) : d.which("gh");
  if (program === null) return row("gh", "bad", "not installed: install GitHub's CLI there");
  const r = await d.run([program, "auth", "status"], { timeoutMs: 8_000 });
  return r.ok ? row("gh", "ok", "signed in") : row("gh", "warn", "not signed in", { run: "gh auth login" });
}

/** Invariant 3: whether ANTHROPIC_API_KEY is set, in the companion's environment or the login shell's — never its value. */
export async function apiKeySet(d: SetupDeps): Promise<boolean> {
  if ("ANTHROPIC_API_KEY" in d.env) return true;
  const r = await d.run(["bash", "-l", "-c", "env -0"], { timeoutMs: PROBE_MS });
  return r.ok && namesOf(r.stdout).has("ANTHROPIC_API_KEY");
}

async function apiKey(d: SetupDeps): Promise<Check> {
  return (await apiKeySet(d))
    ? row("api-key", "bad", "set — every run would bill the API, not your plan: remove it from the VPS's login profile")
    : row("api-key", "ok", "not set");
}

/** The client folders already under the projects folder, by name. */
export function folders(projects: string): string[] {
  try {
    return readdirSync(projects)
      .filter((n) => !n.startsWith(".") && statSync(join(projects, n)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

async function projects(d: SetupDeps): Promise<Check> {
  if (!existsSync(d.paths.projects)) return row("projects", "warn", "~/projects is not there yet: the first clone makes it");
  const n = folders(d.paths.projects).length;
  return row("projects", "ok", `~/projects · ${n} folder${n === 1 ? "" : "s"}`);
}

const ROWS: Record<CheckId, (d: SetupDeps) => Promise<Check>> = {
  system,
  herdr,
  "herdr-server": herdrServer,
  firstmate,
  "relay-rule": relayRule,
  "permission-mode": permissionMode,
  tools,
  node,
  companion,
  linger,
  claude,
  gh,
  "api-key": apiKey,
  projects,
};

/** Every row, read at once, in CHECK_IDS' order. A row that throws says so rather than losing the others. */
export async function checks(d: SetupDeps): Promise<Check[]> {
  return Promise.all(CHECK_IDS.map((id) => ROWS[id](d).catch(() => row(id, "bad", "could not be checked"))));
}
