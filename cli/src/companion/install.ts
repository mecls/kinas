// `kinas companion rpc` `install` (build spec §12 slices 4.2 and 4.5; §17 2026-11-24 #2–#3 and 2026-11-25 #4–#8; ADR
// 0025): one item per call, each the captain's own click in Settings, run as the captain's user and never as root.
// Each answers `{ done: true }` or `{ cannot: <code> }`; the Mac puts the code in fixed words.
//
// The rules every item keeps:
// - Never replace what Kinas did not put there. A binary in ~/.local/bin is written only where nothing is, or over a
//   copy whose SHA-256 is a pinned one; a unit only where none is, or over one that starts with UNIT_HEADER; Firstmate
//   only where its folder is not.
// - A download is kept only when its SHA-256 is the pinned one, and lands by rename, never half-written.
// - The two files written into Firstmate's home — the relay rule and the permission mode — are copied beside
//   themselves first, written whole to a temporary file, read back and checked, then renamed into place. The rule only
//   adds entries; a file that is not a JSON object is reported and never written.
// - Herdr's server is stopped only with `adopt`, the captain's "Run Herdr under systemd", and Firstmate's owner marker
//   is written before the unit starts, so Firstmate never starts a second server beside it.

import { FIRSTMATE_REPO, FIRSTMATE_PIN, TOOLS, releaseUrl, type LinuxRelease } from "@kinas/commands/crew-tools";
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { HERDR, herdrUnit } from "./herdr.ts";
import { unitPath } from "./paths.ts";
import {
  archOf,
  cloned,
  COMPANION_UNIT,
  HERDR_UNIT,
  isKinasCopy,
  OWNER_LINE,
  OWNER_MARKER,
  permissionModeOf,
  pinFor,
  readText,
  relayState,
  REPLACING_MARKER,
  serverNow,
  SESSION,
  sha256Of,
  toolOk,
  UNIT_HEADER,
  unitState,
  type InstallItem,
  type Releases,
  type SetupDeps,
} from "./setup.ts";
import { validFolder, validRepo } from "./validate.ts";
import { recordWritten, writeWhole } from "./written.ts";

export type Cannot =
  | "root"
  | "not-linux"
  | "arch"
  | "no-pin"
  | "download"
  | "checksum"
  | "archive"
  | "foreign"
  | "foreign-unit"
  | "herdr-missing"
  | "herdr-status"
  | "herdr-running"
  | "herdr-stop"
  | "herdr-start"
  | "other-owner"
  | "outside-root"
  | "systemd"
  | "exists"
  | "git"
  | "no-firstmate"
  | "not-json"
  | "not-list"
  | "mode-other"
  | "no-node"
  | "npm"
  | "clone"
  | "record"
  | "bad-request";

export type Outcome = { done: true } | { cannot: Cannot };

export interface InstallRequest {
  item: InstallItem;
  folder?: string;
  repo?: string;
  adopt?: boolean;
}

const DONE: Outcome = { done: true };
const cannot = (c: Cannot): Outcome => ({ cannot: c });

const DOWNLOAD_MS = 240_000;
const NPM_MS = 180_000;
const GIT_MS = 120_000;
const SYSTEMCTL_MS = 20_000;

export async function install(req: InstallRequest, d: SetupDeps): Promise<Outcome> {
  if (d.uid === 0) return cannot("root");
  switch (req.item) {
    case "herdr":
      return installRelease(d, "herdr");
    case "herdr-service":
      return herdrService(d, req.adopt === true);
    case "firstmate":
      return firstmate(d);
    case "relay-rule":
      return relayRule(d);
    case "permission-mode":
      return permissionMode(d);
    case "crew-tools":
      return crewTools(d);
    case "companion-service":
      return companionService(d);
    case "clone":
      return req.folder !== undefined && req.repo !== undefined ? clone(d, req.folder, req.repo) : cannot("bad-request");
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Binaries.

/** Linux, or a test root (the e2e's fake VPS runs on this Mac). */
function canInstallHere(d: SetupDeps): boolean {
  return d.platform === "linux" || d.paths.root !== null;
}

/** Download `name`'s pinned asset for this machine, check it, and put its binary at ~/.local/bin/<name>. */
export async function installRelease(d: SetupDeps, name: string): Promise<Outcome> {
  if (!canInstallHere(d)) return cannot("not-linux");
  const arch = archOf(d.arch);
  const pin = pinFor(d.releases, name);
  if (arch === null) return cannot("arch");
  if (pin === null) return cannot("no-pin");
  const target = join(d.paths.bin, name);
  if (existsSync(target) && !(await isKinasCopy(d.paths, target))) return cannot("foreign");
  const { asset, sha256 } = pin.assets[arch];
  mkdirSync(d.paths.bin, { recursive: true });
  const work = mkdtempSync(join(d.paths.bin, `.kinas-${name}-`));
  try {
    const file = join(work, asset);
    if (!(await d.releases.fetch(pin, asset, file)) || !existsSync(file)) return cannot("download");
    if ((await sha256Of(file)) !== sha256) return cannot("checksum");
    let binary = file;
    if (pin.kind === "tar.gz") {
      const unpacked = join(work, "unpacked");
      mkdirSync(unpacked);
      const tar = await d.run(["tar", "-xzf", file, "-C", unpacked], { timeoutMs: 60_000 });
      const found = tar.ok ? findFile(unpacked, name) : null;
      if (found === null) return cannot("archive");
      binary = found;
    }
    const next = `${target}.kinas-new`;
    copyFileSync(binary, next);
    chmodSync(next, 0o755);
    const written = await sha256Of(next);
    if (written === null) return cannot("record");
    renameSync(next, target);
    // Recorded once it is in place: a copy Kinas cannot record is not Kinas's, so it is never replaced later.
    try {
      recordWritten(d.paths, target, { item: name, version: pin.version, sha256: written, at: d.now() }, d.now());
    } catch {
      return cannot("record");
    }
    return DONE;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function findFile(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry === name && stat.isFile()) {
      return path;
    }
  }
  return null;
}

/** Releases from GitHub at the pinned constants: the machine's. */
export function githubReleases(pins: readonly LinuxRelease[]): Releases {
  return {
    pins,
    async fetch(release, asset, dest) {
      try {
        const r = await fetch(releaseUrl(release.repo, release.version, asset), { signal: AbortSignal.timeout(DOWNLOAD_MS) });
        if (!r.ok) return false;
        await Bun.write(dest, r);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Under a test root (§17 2026-11-25 #8): the files in `<root>/releases`, pinned by its `pins.json`. No network. */
export function rootReleases(dir: string): Releases {
  let pins: LinuxRelease[] = [];
  try {
    pins = JSON.parse(readText(join(dir, "pins.json")) ?? "[]") as LinuxRelease[];
  } catch {
    pins = [];
  }
  return {
    pins,
    async fetch(_release, asset, dest) {
      const from = join(dir, asset);
      if (!existsSync(from)) return false;
      copyFileSync(from, dest);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Units.

/** Write a unit only where none is or over Kinas's own; then reload, enable and start it. */
async function startUnit(d: SetupDeps, unit: string, text: string): Promise<Outcome> {
  if (!canInstallHere(d)) return cannot("not-linux");
  const file = join(d.paths.units, unit);
  const existing = readText(file);
  if (existing !== null && !existing.startsWith(UNIT_HEADER)) return cannot("foreign-unit");
  mkdirSync(d.paths.units, { recursive: true });
  writeWhole(file, text);
  for (const args of [["daemon-reload"], ["enable", "--now", unit]]) {
    const r = await d.run([d.paths.systemctl, "--user", ...args], { timeoutMs: SYSTEMCTL_MS });
    if (!r.ok) return cannot("systemd");
  }
  return DONE;
}

async function companionService(d: SetupDeps): Promise<Outcome> {
  const text = [
    UNIT_HEADER,
    "[Unit]",
    "Description=Kinas's companion: reads Firstmate's home for Kinas on the Mac",
    "",
    "[Service]",
    `ExecStart=${join(d.paths.bin, "kinas")} companion run`,
    "Restart=always",
    "RestartSec=5",
    `Environment=PATH=${unitPath(d.home)}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
  return startUnit(d, COMPANION_UNIT, text);
}

/** Inside the test root, when there is one: no test writes a marker into a real Herdr session folder. */
function allowed(d: SetupDeps, path: string): boolean {
  if (d.paths.root === null) return true;
  const rel = relative(resolve(d.paths.root), resolve(path));
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep);
}

async function waitFor(d: SetupDeps, running: boolean, tries: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if ((await serverNow(d))?.running === running) return true;
    await d.sleep(500);
  }
  return false;
}

/**
 * Herdr's server under `kinas-herdr.service` (§17 2026-11-24 #2, 2026-11-25 #6). Never a second server beside a running
 * one: without `adopt` a server running outside the unit is the captain's and the answer is `herdr-running`.
 */
async function herdrService(d: SetupDeps, adopt: boolean): Promise<Outcome> {
  if (!canInstallHere(d)) return cannot("not-linux");
  if (!existsSync(d.paths.herdr)) return cannot("herdr-missing");
  const [server, unit] = await Promise.all([serverNow(d), unitState(d, HERDR_UNIT)]);
  if (server === null || server.dir === null) return cannot("herdr-status");
  if (unit === null) return cannot("systemd");
  if (server.running && unit === "active") return DONE;
  if (server.running && !adopt) return cannot("herdr-running");
  const owner = join(server.dir, OWNER_MARKER);
  const replacing = join(server.dir, REPLACING_MARKER);
  if (!allowed(d, owner)) return cannot("outside-root");
  const said = readText(owner);
  if (said !== null && said.split("\n")[0]?.trim() !== OWNER_LINE) return cannot("other-owner");
  const unitFile = readText(join(d.paths.units, HERDR_UNIT));
  if (unitFile !== null && !unitFile.startsWith(UNIT_HEADER)) return cannot("foreign-unit");

  const wroteOwner = said === null;
  if (wroteOwner) writeWhole(owner, `${OWNER_LINE}\n`);
  const undo = () => {
    rmSync(replacing, { force: true });
    if (wroteOwner) rmSync(owner, { force: true });
  };
  if (server.running) {
    writeWhole(replacing, `${OWNER_LINE}\n`);
    const stopped = await d.herdr(HERDR.serverStop());
    if (!stopped.ok || !(await waitFor(d, false, 20))) {
      undo();
      return cannot("herdr-stop");
    }
  }
  const started = await startUnit(d, HERDR_UNIT, herdrUnit(d.paths.herdr, SESSION, unitPath(d.home), UNIT_HEADER));
  if ("cannot" in started) {
    undo();
    return started;
  }
  if (!(await waitFor(d, true, 30))) {
    await d.run([d.paths.systemctl, "--user", "disable", "--now", HERDR_UNIT], { timeoutMs: SYSTEMCTL_MS });
    undo();
    return cannot("herdr-start");
  }
  rmSync(replacing, { force: true });
  return DONE;
}

// ---------------------------------------------------------------------------------------------------------------------
// Firstmate's home.

/** Clone at the pin where nothing is, then set its backend to herdr — as `kinas crew setup` does on the Mac. */
async function firstmate(d: SetupDeps): Promise<Outcome> {
  const home = d.paths.home;
  if (existsSync(home)) return cannot("exists");
  mkdirSync(dirname(home), { recursive: true });
  // Cloned beside the home and renamed into place whole: a failed clone leaves only its own folder, which goes.
  const next = `${home}.kinas-new-${d.now()}`;
  try {
    const steps = [
      ["git", "clone", "--quiet", FIRSTMATE_REPO, next],
      ["git", "-C", next, "checkout", "--quiet", "-B", "main", FIRSTMATE_PIN],
    ];
    for (const argv of steps) if (!(await d.run(argv, { timeoutMs: GIT_MS })).ok) return cannot("git");
    const head = await d.run(["git", "-C", next, "rev-parse", "HEAD"], { timeoutMs: 5_000 });
    if (head.stdout.trim() !== FIRSTMATE_PIN) return cannot("git");
    mkdirSync(join(next, "config"), { recursive: true });
    writeWhole(join(next, "config", "backend"), "herdr\n");
    if (existsSync(home)) return cannot("exists");
    renameSync(next, home);
    return DONE;
  } finally {
    rmSync(next, { recursive: true, force: true });
  }
}

/** A copy beside the file, named for now, before anything is written over it. */
function keepBeside(d: SetupDeps, file: string): void {
  if (existsSync(file)) copyFileSync(file, `${file}.kinas-backup-${d.now()}`, constants.COPYFILE_EXCL);
}

/** ADR 0025's rule: the missing entries appended to `permissions.allow`; every other key and entry kept as it was. */
async function relayRule(d: SetupDeps): Promise<Outcome> {
  const home = d.paths.home;
  if (!cloned(home)) return cannot("no-firstmate");
  const file = join(home, ".claude", "settings.local.json");
  const before = readText(file);
  const state = relayState(before, home);
  if (state.kind === "ok") return DONE;
  if (state.kind === "not-json") return cannot("not-json");
  if (state.kind === "not-list") return cannot("not-list");
  const settings: Record<string, unknown> = state.settings ?? {};
  const permissions = (settings.permissions as Record<string, unknown> | undefined) ?? {};
  const allow = [...((permissions.allow as string[] | undefined) ?? []), ...state.missing];
  const next = { ...settings, permissions: { ...permissions, allow } };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  // Read back what will be written: every key and every old entry is still there, and the rule is whole.
  if (!keeps(state.settings, JSON.parse(text) as Record<string, unknown>) || relayState(text, home).kind !== "ok") return cannot("not-json");
  mkdirSync(dirname(file), { recursive: true });
  keepBeside(d, file);
  writeWhole(file, text);
  return relayState(readText(file), home).kind === "ok" ? DONE : cannot("not-json");
}

/** `after` holds every top-level key of `before` with the same value, but for `permissions.allow`, which only grew. */
export function keeps(before: Record<string, unknown> | null, after: Record<string, unknown>): boolean {
  if (before === null) return true;
  for (const [k, v] of Object.entries(before)) {
    if (k === "permissions") continue;
    if (JSON.stringify(after[k]) !== JSON.stringify(v)) return false;
  }
  const p0 = (before.permissions as Record<string, unknown> | undefined) ?? {};
  const p1 = (after.permissions as Record<string, unknown> | undefined) ?? {};
  for (const [k, v] of Object.entries(p0)) {
    if (k === "allow") continue;
    if (JSON.stringify(p1[k]) !== JSON.stringify(v)) return false;
  }
  const a0 = (p0.allow as string[] | undefined) ?? [];
  const a1 = (p1.allow as string[] | undefined) ?? [];
  return a0.every((e, i) => a1[i] === e);
}

/** `config/claude-permission-mode` set to `auto`, only over nothing or `bypass` (§19 #4; Firstmate's own setting). */
async function permissionMode(d: SetupDeps): Promise<Outcome> {
  const home = d.paths.home;
  if (!cloned(home)) return cannot("no-firstmate");
  const file = join(home, "config", "claude-permission-mode");
  const mode = permissionModeOf(readText(file));
  if (mode === "auto") return DONE;
  if (mode !== "bypass") return cannot("mode-other");
  mkdirSync(dirname(file), { recursive: true });
  keepBeside(d, file);
  writeWhole(file, "auto\n");
  return permissionModeOf(readText(file)) === "auto" ? DONE : cannot("mode-other");
}

// ---------------------------------------------------------------------------------------------------------------------
// The crew's tools, and the client folders.

/** Each required tool not yet at its floor: npm's at their exact versions with Node's npm, the releases from their pins. */
async function crewTools(d: SetupDeps): Promise<Outcome> {
  const missing: (typeof TOOLS)[number][] = [];
  for (const tool of TOOLS) if (!(await toolOk(d, tool))) missing.push(tool);
  // Node first: an npm tool Kinas cannot install stops this before anything is downloaded.
  if (d.node === null && missing.some((t) => t.source === "npm")) return cannot("no-node");
  for (const tool of missing) {
    if (tool.source === "npm") {
      const r = await d.run([join(d.node!, "npm"), "install", "-g", `${tool.name}@${tool.version}`], { timeoutMs: NPM_MS });
      if (!r.ok) return cannot("npm");
    } else {
      const out = await installRelease(d, tool.name);
      if ("cannot" in out) return out;
    }
  }
  return DONE;
}

async function clone(d: SetupDeps, folder: string, repo: string): Promise<Outcome> {
  if (!validFolder(folder) || !validRepo(repo)) return cannot("bad-request");
  const target = join(d.paths.projects, folder);
  if (existsSync(target)) return cannot("exists");
  mkdirSync(d.paths.projects, { recursive: true });
  const program = d.paths.root !== null ? d.paths.gh : (d.which("gh") ?? "gh");
  const r = await d.run([program, "repo", "clone", repo, target, "--", "--quiet"], { timeoutMs: GIT_MS * 2 });
  return r.ok && cloned(target) ? DONE : cannot("clone");
}

// ---------------------------------------------------------------------------------------------------------------------

/** Write a whole file by rename from a temporary one beside it; never through a link (O_NOFOLLOW on the temporary). */
