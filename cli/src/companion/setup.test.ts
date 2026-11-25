import { describe, expect, test } from "bun:test";
import { FIRSTMATE_PIN } from "@kinas/commands/crew-tools";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeMachine, fakeReleases } from "./fake-machine.ts";
import { install } from "./install.ts";
import { rpc } from "./rpc.ts";
import {
  CHECK_IDS,
  checks,
  COMPANION_UNIT,
  HERDR_UNIT,
  namesOf,
  permissionModeOf,
  relayEntries,
  relayState,
  systemLine,
  type Check,
} from "./setup.ts";

// Setup's checks on the VPS (build spec §12 slice 4.2; §17 2026-11-25 #3): one row per piece, in a fixed order.

const byId = (rows: Check[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("the rows", () => {
  test("every id, once, in the fixed order — on a bare machine", async () => {
    const m = fakeMachine();
    const rows = await checks(m.deps);
    expect(rows.map((r) => r.id)).toEqual([...CHECK_IDS]);
    const r = byId(rows);
    expect(r.system).toEqual({ id: "system", state: "ok", detail: "Linux · x86_64 · 8 cores · 15 GB · 296 GB free" });
    expect(r.herdr).toEqual({ id: "herdr", state: "bad", detail: "not installed", install: "herdr" });
    expect(r["herdr-server"]).toEqual({ id: "herdr-server", state: "later", detail: "after Herdr" });
    expect(r.firstmate).toEqual({ id: "firstmate", state: "bad", detail: "not cloned", install: "firstmate" });
    expect(r["relay-rule"]?.state).toBe("later");
    expect(r["permission-mode"]?.state).toBe("later");
    expect(r.tools).toEqual({ id: "tools", state: "later", detail: "0 of 7 · after Node" });
    expect(r.node).toEqual({ id: "node", state: "bad", detail: "Node is not where Kinas looks: fnm's default alias or Volta" });
    expect(r.companion).toEqual({ id: "companion", state: "bad", detail: "not running under systemd", install: "companion-service" });
    expect(r.linger?.state).toBe("ok");
    expect(r.claude).toEqual({ id: "claude", state: "bad", detail: "not installed: install Claude Code in the VPS's terminal" });
    expect(r.gh?.state).toBe("bad");
    expect(r["api-key"]).toEqual({ id: "api-key", state: "ok", detail: "not set" });
    expect(r.projects?.state).toBe("warn");
  });

  test("a ready machine reads green", async () => {
    const m = fakeMachine({ server: { running: true, startsWithUnit: true, stops: true }, units: { [HERDR_UNIT]: "active", [COMPANION_UNIT]: "active" } });
    m.deps.releases = fakeReleases({ herdr: "#!/bin/sh\n" });
    expect(await install({ item: "herdr" }, m.deps)).toEqual({ done: true });
    const home = m.deps.paths.home;
    mkdirSync(join(home, ".git"), { recursive: true });
    mkdirSync(join(home, "config"), { recursive: true });
    writeFileSync(join(home, "config", "backend"), "herdr\n");
    writeFileSync(join(home, "config", "claude-permission-mode"), "auto\n");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: relayEntries(home) } }));
    writeFileSync(m.deps.paths.claude, "#!/bin/sh\n");
    mkdirSync(m.deps.paths.claudeHome, { recursive: true });
    writeFileSync(join(m.deps.paths.claudeHome, ".credentials.json"), "{}");
    writeFileSync(m.deps.paths.gh, "#!/bin/sh\n");
    mkdirSync(join(m.deps.paths.projects, "shop"), { recursive: true });
    const r = byId(await checks({ ...m.deps, node: `${m.deps.home}/.local/share/fnm/aliases/default/bin` }));
    expect(r.herdr).toEqual({ id: "herdr", state: "ok", detail: "0.9.5 · installed by Kinas" });
    expect(r["herdr-server"]).toEqual({ id: "herdr-server", state: "ok", detail: "running under systemd" });
    expect(r.firstmate).toEqual({ id: "firstmate", state: "ok", detail: `${FIRSTMATE_PIN.slice(0, 7)} (pinned)` });
    expect(r["relay-rule"]?.state).toBe("ok");
    expect(r["permission-mode"]).toEqual({ id: "permission-mode", state: "ok", detail: "auto" });
    expect(r.node).toEqual({ id: "node", state: "ok", detail: "~/.local/share/fnm/aliases/default/bin" });
    expect(r.companion?.state).toBe("ok");
    expect(r.claude).toEqual({ id: "claude", state: "ok", detail: "signed in" });
    expect(r.gh).toEqual({ id: "gh", state: "ok", detail: "signed in" });
    expect(r.projects).toEqual({ id: "projects", state: "ok", detail: "~/projects · 1 folder" });
  });

  test("a Herdr byte for byte the pinned release that Kinas did not write is the captain's", async () => {
    const m = fakeMachine();
    m.deps.releases = fakeReleases({ herdr: "the release" });
    mkdirSync(m.deps.paths.bin, { recursive: true });
    writeFileSync(m.deps.paths.herdr, "the release");
    expect(byId(await checks(m.deps)).herdr).toEqual({ id: "herdr", state: "ok", detail: "0.9.5 · yours: Kinas leaves it as it is" });
  });

  test("the captain's own Herdr is green and never offered Install; a server outside the unit offers to adopt it", async () => {
    const m = fakeMachine({ server: { running: true, startsWithUnit: true, stops: true } });
    m.deps.releases = fakeReleases({ herdr: "kinas's copy" });
    mkdirSync(m.deps.paths.bin, { recursive: true });
    writeFileSync(m.deps.paths.herdr, "the captain's own");
    const r = byId(await checks(m.deps));
    expect(r.herdr).toEqual({ id: "herdr", state: "ok", detail: "0.9.5 · yours: Kinas leaves it as it is" });
    expect(r["herdr-server"]).toEqual({
      id: "herdr-server",
      state: "warn",
      detail: "running, not under systemd: it won't come back after a restart",
      install: "herdr-service",
      adopt: true,
    });
  });

  test("linger off, Claude Code and gh not signed in: the commands for the captain, from fixed shapes", async () => {
    const m = fakeMachine({ linger: "no", gh: { present: true, signedIn: false } });
    mkdirSync(m.deps.paths.bin, { recursive: true });
    writeFileSync(m.deps.paths.gh, "#!/bin/sh\n");
    writeFileSync(m.deps.paths.claude, "#!/bin/sh\n");
    const r = byId(await checks(m.deps));
    expect(r.linger).toEqual({ id: "linger", state: "warn", detail: "off: your services stop when you log out", run: "sudo loginctl enable-linger captain" });
    expect(r.claude).toEqual({ id: "claude", state: "warn", detail: "not signed in", run: "claude" });
    expect(r.gh).toEqual({ id: "gh", state: "warn", detail: "not signed in", run: "gh auth login" });
  });

  test("as root, the System row says so first", async () => {
    const m = fakeMachine({}, { uid: 0 });
    expect(byId(await checks(m.deps)).system?.state).toBe("bad");
    expect(byId(await checks(m.deps)).system?.detail).toStartWith("logged in as root");
  });

  test("with no user manager, the services rows say so and offer nothing", async () => {
    const m = fakeMachine({ systemd: false });
    const r = byId(await checks(m.deps));
    expect(r.companion).toEqual({ id: "companion", state: "bad", detail: "systemd's user manager does not answer: Kinas keeps services with it" });
  });
});

describe("AC-8: whether ANTHROPIC_API_KEY is set, never its value (invariant 3)", () => {
  const PLANTED = "sk-ant-api03-PLANTED-never-leaves-0123456789";

  test("set in the login shell: the row is red, and the planted value is in no reply, no file and no log", async () => {
    const m = fakeMachine({ loginEnv: `HOME=/home/c\0ANTHROPIC_API_KEY=${PLANTED}\0PATH=/usr/bin\0` });
    const logged: string[] = [];
    const deps = {
      paths: m.deps.paths,
      version: "0.1.0",
      herdrVersion: async () => null,
      readNow: async () => {},
      now: () => 1,
      herdr: m.deps.herdr,
      setup: m.deps,
    };
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => (logged.push(String(chunk)), true)) as typeof process.stderr.write;
    let reply: unknown;
    try {
      reply = (await rpc('{"verb":"hello"}', deps)).reply;
    } finally {
      process.stderr.write = origWrite;
    }
    const rows = (reply as { checks: Check[] }).checks;
    expect(byId(rows)["api-key"]).toEqual({
      id: "api-key",
      state: "bad",
      detail: "set — every run would bill the API, not your plan: remove it from the VPS's login profile",
    });
    expect(JSON.stringify(reply)).not.toContain("PLANTED");
    expect(logged.join("")).not.toContain("PLANTED");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    for (const file of walk(m.root)) expect(readFileSync(file, "utf8")).not.toContain("PLANTED");
    expect(m.ran).toContainEqual(["bash", "-l", "-c", "env -0"]);
  });

  test("set in the companion's own environment: red, without asking the login shell", async () => {
    const m = fakeMachine({}, { env: { ANTHROPIC_API_KEY: PLANTED } });
    const r = byId(await checks(m.deps));
    expect(r["api-key"]?.state).toBe("bad");
    expect(JSON.stringify(r)).not.toContain("PLANTED");
    expect(m.ran).not.toContainEqual(["bash", "-l", "-c", "env -0"]);
  });

  test("namesOf keeps names only", () => {
    expect([...namesOf(`A=1\0ANTHROPIC_API_KEY=${PLANTED}\0B=x=y\0\0`)]).toEqual(["A", "ANTHROPIC_API_KEY", "B"]);
  });
});

describe("pure readings", () => {
  test("relayState: missing entries, or why the file is left alone", () => {
    const home = "/h/fm";
    expect(relayState(null, home)).toEqual({ kind: "missing", missing: relayEntries(home), settings: null });
    expect(relayState(JSON.stringify({ permissions: { allow: relayEntries(home) } }), home)).toEqual({ kind: "ok" });
    expect(relayState("not json", home)).toEqual({ kind: "not-json" });
    expect(relayState("[1]", home)).toEqual({ kind: "not-json" });
    expect(relayState('{"permissions":[]}', home)).toEqual({ kind: "not-list" });
    expect(relayState('{"permissions":{"allow":[1]}}', home)).toEqual({ kind: "not-list" });
    expect(relayEntries(home)).toEqual([
      "Bash(bin/fm-send.sh *)",
      "Bash(/h/fm/bin/fm-send.sh *)",
      "Bash(FM_HOME=/h/fm bin/fm-send.sh *)",
      "Bash(FM_HOME=/h/fm /h/fm/bin/fm-send.sh *)",
    ]);
  });

  test("permissionModeOf reads the token as fm-spawn.sh does", () => {
    expect(permissionModeOf(null)).toBe("bypass");
    expect(permissionModeOf(" auto \n")).toBe("auto");
    expect(permissionModeOf("bypass")).toBe("bypass");
    expect(permissionModeOf("")).toBe("bypass");
    expect(permissionModeOf("plan")).toEqual({ other: "plan" });
  });

  test("systemLine names the distribution from os-release", () => {
    const os = 'NAME="Debian GNU/Linux"\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nID=debian\n';
    expect(systemLine(os, "x64", { cores: 8, memBytes: 15 * 1024 ** 3, freeBytes: 296 * 1024 ** 3 })).toBe("Debian GNU/Linux 13 (trixie) · x86_64 · 8 cores · 15 GB · 296 GB free");
    expect(systemLine(null, "arm64", { cores: 4, memBytes: 8 * 1024 ** 3, freeBytes: null })).toBe("Linux · aarch64 · 4 cores · 8 GB");
  });
});
