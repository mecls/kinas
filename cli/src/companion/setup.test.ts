import { describe, expect, test } from "bun:test";
import { FIRSTMATE_PIN } from "@kinas/commands/crew-tools";
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fakeMachine, fakeReleases } from "./fake-machine.ts";
import { fakeProc, SANDBOX_NS, type FakeProc } from "./fake-proc.ts";
import { readWritten } from "./written.ts";
import { install } from "./install.ts";
import { rpc } from "./rpc.ts";
import {
  CHECK_IDS,
  checks,
  COMPANION_UNIT,
  HERDR_UNIT,
  namesOf,
  permissionModeOf,
  legacyRelayEntries,
  relayEntries,
  relayInstruction,
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
    expect(r["relay-instruction"]).toEqual({ id: "relay-instruction", state: "later", detail: "after Firstmate" });
    expect(r["first-mate-launch"]).toEqual({ id: "first-mate-launch", state: "later", detail: "after Firstmate" });
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
    mkdirSync(join(m.deps.paths.projectRoots[0]!, "shop"), { recursive: true });
    const r = byId(await checks({ ...m.deps, node: `${m.deps.home}/.local/share/fnm/aliases/default/bin` }));
    expect(r.herdr).toEqual({ id: "herdr", state: "ok", detail: "0.9.5 · installed by Kinas" });
    expect(r["herdr-server"]).toEqual({ id: "herdr-server", state: "ok", detail: "running under systemd" });
    expect(r.firstmate).toEqual({ id: "firstmate", state: "ok", detail: `${FIRSTMATE_PIN.slice(0, 7)} (pinned)` });
    expect(r["relay-rule"]?.state).toBe("ok");
    expect(r["relay-instruction"]?.state).toBe("bad");
    expect(await install({ item: "relay-instruction" }, m.deps)).toEqual({ done: true });
    expect(byId(await checks(m.deps))["relay-instruction"]).toEqual({ id: "relay-instruction", state: "ok", detail: "written: passed to the first mate at launch" });
    expect(r["first-mate-launch"]).toEqual({ id: "first-mate-launch", state: "ok", detail: "no first mate running now" });
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

describe("the relay instruction and the first mate's launch (ADR 0026, slice 4.8)", () => {
  function withHome() {
    const m = fakeMachine();
    mkdirSync(join(m.deps.paths.home, ".git"), { recursive: true });
    return m;
  }

  test("Install writes Kinas's words and records them; a file Kinas did not write is left, and so said", async () => {
    const m = withHome();
    const file = m.deps.paths.relayInstruction;
    expect(byId(await checks(m.deps))["relay-instruction"]).toEqual({
      id: "relay-instruction",
      state: "bad",
      detail: "not written: the first mate isn't told how to pass your answers on",
      install: "relay-instruction",
    });
    expect(await install({ item: "relay-instruction" }, m.deps)).toEqual({ done: true });
    expect(readFileSync(file, "utf8")).toBe(relayInstruction(m.deps.paths.home));
    expect(readWritten(m.deps.paths)[file]?.item).toBe("relay-instruction");
    // Kinas's own copy, changed by hand since: no longer Kinas's.
    writeFileSync(file, "the captain's own words\n");
    expect(byId(await checks(m.deps))["relay-instruction"]?.state).toBe("bad");
    expect(await install({ item: "relay-instruction" }, m.deps)).toEqual({ cannot: "foreign" });
    expect(readFileSync(file, "utf8")).toBe("the captain's own words\n");
  });

  test("the words name the four calls in exactly the rule's forms, with the home filled in", () => {
    const text = relayInstruction("/h/fm");
    expect(text).toContain("`FM_HOME=/h/fm bin/fm-send.sh <task> --resolve-key <key> '<answer>'`");
    expect(text).toContain("`bin/fm-captain-hold.sh answer <task> --decision-file <that file> --release`");
    expect(text).toContain("`bin/fm-inbox.sh drain --ack <note id>`");
    expect(text).toContain("`bin/fm-wake-drain.sh --ack-through <N> --recovery-generation <generation>`");
    expect(text).toContain("no `cd`, no `;`, `&&` or `|`");
  });

  test("the first mate's row reads each running first mate's command line for the flag", async () => {
    const m = withHome();
    const { paths } = m.deps;
    const home = realpathSync(paths.home);
    const versions = join(m.root, "share-claude", "versions");
    mkdirSync(versions, { recursive: true });
    writeFileSync(join(versions, "2.1.332"), "#!/bin/sh\n");
    mkdirSync(dirname(paths.realClaude), { recursive: true });
    rmSync(paths.realClaude, { force: true });
    symlinkSync(join(versions, "2.1.332"), paths.realClaude);
    const exe = join(realpathSync(versions), "2.1.332");
    const mate = (flag: boolean): FakeProc => ({ pid: 10, ppid: 1, exe, cwd: home, cmdline: ["claude", ...(flag ? ["--append-system-prompt-file", paths.relayInstruction] : [])] });
    const row = async () => byId(await checks(m.deps))["first-mate-launch"];

    fakeProc(paths.proc, [mate(true)]);
    expect(await row()).toEqual({ id: "first-mate-launch", state: "ok", detail: "started with Kinas's relay instruction" });
    fakeProc(paths.proc, [mate(false)]);
    expect(await row()).toEqual({ id: "first-mate-launch", state: "warn", detail: "started without Kinas's relay instruction: launch it from the Work page" });
    // A worker, another folder, another binary, another namespace or another user is not a first mate.
    for (const p of [
      { ...mate(false), env: { FM_TASK_ID: "t1" } },
      { ...mate(false), cwd: "/elsewhere" },
      { ...mate(false), exe: "/usr/bin/node" },
      { ...mate(false), ns: SANDBOX_NS },
      { ...mate(false), uid: 1002 },
    ]) {
      fakeProc(paths.proc, [p]);
      expect((await row())?.detail).toBe("no first mate running now");
    }
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
    expect(relayState(null, home)).toEqual({ kind: "missing", missing: relayEntries(home), legacy: [], settings: null });
    expect(relayState(JSON.stringify({ permissions: { allow: relayEntries(home) } }), home)).toEqual({ kind: "ok" });
    expect(relayState("not json", home)).toEqual({ kind: "not-json" });
    expect(relayState("[1]", home)).toEqual({ kind: "not-json" });
    expect(relayState('{"permissions":[]}', home)).toEqual({ kind: "not-list" });
    expect(relayState('{"permissions":{"allow":[1]}}', home)).toEqual({ kind: "not-list" });
    expect(relayEntries(home)).toEqual([
      "Bash(FM_HOME=/h/fm bin/fm-send.sh * --resolve-key *)",
      "Bash(FM_HOME=/h/fm /h/fm/bin/fm-send.sh * --resolve-key *)",
      "Bash(bin/fm-inbox.sh drain --ack *)",
      "Bash(FM_HOME=/h/fm bin/fm-inbox.sh drain --ack *)",
      "Bash(bin/fm-wake-drain.sh --ack-through * --recovery-generation *)",
      "Bash(FM_HOME=/h/fm bin/fm-wake-drain.sh --ack-through * --recovery-generation *)",
      "Bash(bin/fm-captain-hold.sh answer * --decision-file * --release)",
      "Bash(FM_HOME=/h/fm bin/fm-captain-hold.sh answer * --decision-file * --release)",
    ]);
    expect(legacyRelayEntries(home)).toEqual([
      "Bash(bin/fm-send.sh *)",
      "Bash(/h/fm/bin/fm-send.sh *)",
      "Bash(FM_HOME=/h/fm bin/fm-send.sh *)",
      "Bash(FM_HOME=/h/fm /h/fm/bin/fm-send.sh *)",
    ]);
    // All eight but one of ADR 0025's wider entries still there: not ok, and the old entry is named for removal.
    const both = JSON.stringify({ permissions: { allow: [...relayEntries(home), "Bash(bin/fm-send.sh *)"] } });
    expect(relayState(both, home)).toMatchObject({ kind: "missing", missing: [], legacy: ["Bash(bin/fm-send.sh *)"] });
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

describe("the projects folders the captain names (slice 5.3)", () => {
  /** A machine whose `roots` setting names two folders under the test root, the second not made yet. */
  function named() {
    const m = fakeMachine();
    const root = m.deps.paths.root!;
    m.deps.paths.projectRoots = [join(root, "miraside"), join(root, "personal")];
    m.deps.paths.projectsNamed = true;
    mkdirSync(join(root, "miraside", "portal"), { recursive: true });
    mkdirSync(join(root, "miraside", "site"), { recursive: true });
    return m;
  }

  test("the row counts each folder; one not there is a warn, and nothing makes it", async () => {
    const m = named();
    expect(byId(await checks(m.deps)).projects).toEqual({ id: "projects", state: "warn", detail: "~/miraside · 2 folders · ~/personal is not there" });
    mkdirSync(join(m.deps.paths.root!, "personal", "notes"), { recursive: true });
    expect(byId(await checks(m.deps)).projects).toEqual({ id: "projects", state: "ok", detail: "~/miraside · 2 folders · ~/personal · 1 folder" });
    expect(readdirSync(m.deps.paths.root!)).not.toContain("projects");
  });

  test("a setting that could not all be used says so on the row", async () => {
    const m = named();
    mkdirSync(join(m.deps.paths.root!, "personal"));
    m.deps.paths.projectsProblem = 'roots: left out "relative" (not an absolute or ~/ folder, or inside another)';
    expect(byId(await checks(m.deps)).projects?.state).toBe("warn");
    expect(byId(await checks(m.deps)).projects?.detail).toContain('left out "relative"');
  });

  test("Clone goes into the first folder, never over a folder of that name in any of them, and never makes a named one", async () => {
    const m = named();
    expect(await install({ item: "clone", folder: "shop", repo: "acme/shop" }, m.deps)).toEqual({ done: true });
    expect(m.ran.find((a) => a[0] === m.deps.paths.gh && a[1] === "repo")).toEqual([m.deps.paths.gh, "repo", "clone", "acme/shop", join(m.deps.paths.root!, "miraside", "shop"), "--", "--quiet"]);
    mkdirSync(join(m.deps.paths.root!, "personal", "notes"), { recursive: true });
    expect(await install({ item: "clone", folder: "notes", repo: "acme/notes" }, m.deps)).toEqual({ cannot: "exists" });
    const gone = named();
    rmSync(join(gone.deps.paths.root!, "miraside"), { recursive: true });
    expect(await install({ item: "clone", folder: "shop", repo: "acme/shop" }, gone.deps)).toEqual({ cannot: "no-projects" });
    expect(readdirSync(gone.deps.paths.root!)).not.toContain("miraside");
  });

  test("hello lists the folders of every projects folder, each name once", async () => {
    const m = named();
    mkdirSync(join(m.deps.paths.root!, "personal", "notes"), { recursive: true });
    mkdirSync(join(m.deps.paths.root!, "personal", "site"), { recursive: true });
    const deps = { paths: m.deps.paths, version: "0.1.0", herdrVersion: async () => null, readNow: async () => {}, now: () => 1, herdr: m.deps.herdr, setup: m.deps };
    const said = await rpc('{"verb":"hello"}', deps);
    expect((said.reply as { folders: string[] }).folders).toEqual(["notes", "portal", "site"]);
  });
});
