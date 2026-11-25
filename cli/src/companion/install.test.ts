import { describe, expect, test } from "bun:test";
import { FIRSTMATE_PIN } from "@kinas/commands/crew-tools";
import { run } from "@kinas/context";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeMachine, fakeReleases } from "./fake-machine.ts";
import { install, keeps } from "./install.ts";
import { COMPANION_UNIT, HERDR_UNIT, OWNER_LINE, OWNER_MARKER, relayEntries, REPLACING_MARKER, UNIT_HEADER } from "./setup.ts";

// Setup's installs on the VPS (build spec §12 slices 4.2 and 4.5; §17 2026-11-24 #2–#3, 2026-11-25 #4–#7; ADR 0025).

const HERDR_BYTES = "#!/bin/sh\necho herdr 0.9.5\n";

function withHerdrRelease() {
  return fakeMachine({}, { releases: fakeReleases({ herdr: HERDR_BYTES }) });
}

describe("install herdr", () => {
  test("downloads the pinned asset, checks its SHA-256, and puts it at ~/.local/bin/herdr", async () => {
    const m = withHerdrRelease();
    expect(await install({ item: "herdr" }, m.deps)).toEqual({ done: true });
    const herdr = join(m.deps.paths.bin, "herdr");
    expect(readFileSync(herdr, "utf8")).toBe(HERDR_BYTES);
    expect(readdirSync(m.deps.paths.bin)).toEqual(["herdr"]);
  });

  test("install_herdr_leaves_a_foreign_binary: a Herdr Kinas did not install is never overwritten", async () => {
    const m = withHerdrRelease();
    mkdirSync(m.deps.paths.bin, { recursive: true });
    writeFileSync(join(m.deps.paths.bin, "herdr"), "the captain's own 0.9.5");
    expect(await install({ item: "herdr" }, m.deps)).toEqual({ cannot: "foreign" });
    expect(readFileSync(join(m.deps.paths.bin, "herdr"), "utf8")).toBe("the captain's own 0.9.5");
    expect((m.deps.releases as ReturnType<typeof fakeReleases>).fetched).toEqual([]);
  });

  test("Kinas's own copy, by its pinned SHA-256, is replaced", async () => {
    const m = withHerdrRelease();
    mkdirSync(m.deps.paths.bin, { recursive: true });
    writeFileSync(join(m.deps.paths.bin, "herdr"), HERDR_BYTES);
    expect(await install({ item: "herdr" }, m.deps)).toEqual({ done: true });
  });

  test("a download whose SHA-256 is not the pinned one is dropped, and nothing lands", async () => {
    const releases = fakeReleases({ herdr: HERDR_BYTES });
    const m = fakeMachine({}, { releases: { ...releases, fetch: async (_r, _a, dest) => (writeFileSync(dest, "tampered"), true) } });
    expect(await install({ item: "herdr" }, m.deps)).toEqual({ cannot: "checksum" });
    expect(existsSync(join(m.deps.paths.bin, "herdr"))).toBe(false);
    expect(readdirSync(m.deps.paths.bin)).toEqual([]);
  });

  test("a tar.gz release is opened and its one binary installed", async () => {
    const m = fakeMachine();
    const work = join(m.root, "pack");
    mkdirSync(join(work, "treehouse-v2.3.0"), { recursive: true });
    writeFileSync(join(work, "treehouse-v2.3.0", "treehouse"), "#!/bin/sh\necho v2.3.0\n");
    chmodSync(join(work, "treehouse-v2.3.0", "treehouse"), 0o755);
    const tgz = join(m.root, "t.tar.gz");
    expect((await run(["tar", "-czf", tgz, "-C", work, "treehouse-v2.3.0"], { timeoutMs: 10_000 })).ok).toBe(true);
    const bytes = await Bun.file(tgz).bytes();
    const sum = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    m.deps.releases = {
      pins: [{ name: "treehouse", version: "2.3.0", repo: "kunchenguid/treehouse", kind: "tar.gz", assets: { x64: { asset: "t.tar.gz", sha256: sum }, arm64: { asset: "t.tar.gz", sha256: sum } } }],
      fetch: async (_r, _a, dest) => (writeFileSync(dest, bytes), true),
    };
    const { installRelease } = await import("./install.ts");
    expect(await installRelease(m.deps, "treehouse")).toEqual({ done: true });
    expect(readFileSync(join(m.deps.paths.bin, "treehouse"), "utf8")).toContain("v2.3.0");
  });

  test("not on Linux without a test root, or an architecture with no asset: nothing is fetched", async () => {
    const m = withHerdrRelease();
    expect(await install({ item: "herdr" }, { ...m.deps, arch: "ia32" })).toEqual({ cannot: "arch" });
    expect(await install({ item: "herdr" }, { ...m.deps, platform: "darwin", paths: { ...m.deps.paths, root: null } })).toEqual({ cannot: "not-linux" });
  });
});

describe("install herdr-service (§17 2026-11-24 #2, 2026-11-25 #6)", () => {
  function withHerdr(over: Parameters<typeof fakeMachine>[0] = {}) {
    const m = fakeMachine(over);
    mkdirSync(m.deps.paths.bin, { recursive: true });
    writeFileSync(m.deps.paths.herdr, HERDR_BYTES);
    return m;
  }

  test("no server running: Firstmate's owner marker first, then the unit, enabled and started", async () => {
    const m = withHerdr();
    expect(await install({ item: "herdr-service" }, m.deps)).toEqual({ done: true });
    expect(readFileSync(join(m.sessionDir, OWNER_MARKER), "utf8")).toBe(`${OWNER_LINE}\n`);
    expect(existsSync(join(m.sessionDir, REPLACING_MARKER))).toBe(false);
    const unit = readFileSync(join(m.deps.paths.units, HERDR_UNIT), "utf8");
    expect(unit.startsWith(UNIT_HEADER)).toBe(true);
    expect(unit).toContain(`ExecStart=${m.deps.paths.herdr} server --session default`);
    expect(unit).toContain(`Environment=PATH=${m.deps.path}`);
    expect(m.state.units[HERDR_UNIT]).toBe("active");
    expect(m.herdrCalls.map((c) => c.join(" "))).not.toContain("server stop");
  });

  test("herdr_service_refuses_beside_a_running_server: a server outside the unit is the captain's — nothing written, nothing stopped", async () => {
    const m = withHerdr({ server: { running: true, startsWithUnit: true, stops: true } });
    expect(await install({ item: "herdr-service" }, m.deps)).toEqual({ cannot: "herdr-running" });
    expect(m.state.server.running).toBe(true);
    expect(existsSync(join(m.sessionDir, OWNER_MARKER))).toBe(false);
    expect(existsSync(join(m.deps.paths.units, HERDR_UNIT))).toBe(false);
    expect(m.herdrCalls.map((c) => c.join(" "))).toEqual(["status --json"]);
    expect(m.ran.filter((a) => a.includes("enable"))).toEqual([]);
  });

  test("adopt (the captain's click): replacing marker, stop, the unit, running again, replacing marker gone", async () => {
    const m = withHerdr({ server: { running: true, startsWithUnit: true, stops: true } });
    expect(await install({ item: "herdr-service", adopt: true }, m.deps)).toEqual({ done: true });
    expect(m.herdrCalls.map((c) => c.join(" "))).toContain("server stop");
    expect(m.state.server.running).toBe(true);
    expect(m.state.units[HERDR_UNIT]).toBe("active");
    expect(existsSync(join(m.sessionDir, OWNER_MARKER))).toBe(true);
    expect(existsSync(join(m.sessionDir, REPLACING_MARKER))).toBe(false);
  });

  test("a unit that never brings the server up is disabled again, and both markers go", async () => {
    const m = withHerdr({ server: { running: false, startsWithUnit: false, stops: true } });
    expect(await install({ item: "herdr-service" }, m.deps)).toEqual({ cannot: "herdr-start" });
    expect(m.state.units[HERDR_UNIT]).toBe("inactive");
    expect(existsSync(join(m.sessionDir, OWNER_MARKER))).toBe(false);
    expect(existsSync(join(m.sessionDir, REPLACING_MARKER))).toBe(false);
  });

  test("a marker naming another owner, or a unit file Kinas did not write, is left alone", async () => {
    const m = withHerdr();
    writeFileSync(join(m.sessionDir, OWNER_MARKER), "systemd user unit herdr-mine.service\n");
    expect(await install({ item: "herdr-service" }, m.deps)).toEqual({ cannot: "other-owner" });
    const n = withHerdr();
    mkdirSync(n.deps.paths.units, { recursive: true });
    writeFileSync(join(n.deps.paths.units, HERDR_UNIT), "[Service]\nExecStart=/opt/herdr server\n");
    expect(await install({ item: "herdr-service" }, n.deps)).toEqual({ cannot: "foreign-unit" });
    expect(readFileSync(join(n.deps.paths.units, HERDR_UNIT), "utf8")).toBe("[Service]\nExecStart=/opt/herdr server\n");
    expect(existsSync(join(n.sessionDir, OWNER_MARKER))).toBe(false);
  });

  test("under a test root, a marker outside it is refused; with no user manager, nothing is written", async () => {
    const m = withHerdr();
    m.deps.herdr = async () => ({ ok: true, stdout: JSON.stringify({ server: { running: false, socket: "/elsewhere/herdr.sock" } }) });
    expect(await install({ item: "herdr-service" }, m.deps)).toEqual({ cannot: "outside-root" });
    const n = withHerdr({ systemd: false });
    expect(await install({ item: "herdr-service" }, n.deps)).toEqual({ cannot: "systemd" });
    expect(existsSync(join(n.sessionDir, OWNER_MARKER))).toBe(false);
  });
});

describe("the companion's own unit", () => {
  test("runs ~/.local/bin/kinas companion run with the companion's PATH, enabled and started", async () => {
    const m = fakeMachine();
    expect(await install({ item: "companion-service" }, m.deps)).toEqual({ done: true });
    const unit = readFileSync(join(m.deps.paths.units, COMPANION_UNIT), "utf8");
    expect(unit).toContain(`ExecStart=${join(m.deps.paths.bin, "kinas")} companion run`);
    expect(unit).toContain("Restart=always");
    expect(m.state.units[COMPANION_UNIT]).toBe("active");
  });
});

describe("Firstmate's home", () => {
  test("cloned at the pin beside its place, then renamed in, with its backend set to herdr", async () => {
    const m = fakeMachine();
    expect(await install({ item: "firstmate" }, m.deps)).toEqual({ done: true });
    expect(existsSync(join(m.deps.paths.home, ".git"))).toBe(true);
    expect(readFileSync(join(m.deps.paths.home, "config", "backend"), "utf8")).toBe("herdr\n");
    expect(m.ran.find((a) => a.includes("checkout"))).toContain(FIRSTMATE_PIN);
    expect(readdirSync(join(m.deps.paths.home, "..")).filter((n) => n.includes("kinas-new"))).toEqual([]);
  });

  test("a home already there is never cloned over", async () => {
    const m = fakeMachine();
    mkdirSync(m.deps.paths.home, { recursive: true });
    writeFileSync(join(m.deps.paths.home, "mine"), "x");
    expect(await install({ item: "firstmate" }, m.deps)).toEqual({ cannot: "exists" });
    expect(readdirSync(m.deps.paths.home)).toEqual(["mine"]);
  });
});

describe("the relay rule (ADR 0025, slice 4.5)", () => {
  function withHome() {
    const m = fakeMachine();
    mkdirSync(join(m.deps.paths.home, ".git"), { recursive: true });
    mkdirSync(join(m.deps.paths.home, ".claude"), { recursive: true });
    return m;
  }
  const settingsFile = (m: ReturnType<typeof withHome>) => join(m.deps.paths.home, ".claude", "settings.local.json");

  test("relay_rule_added_keeping_the_rest: the four entries appended; every other key and entry as it was; the old file kept beside", async () => {
    const m = withHome();
    const before = { model: "opus", permissions: { allow: ["Bash(git status)", `Bash(${m.deps.paths.home}/bin/fm-send.sh *)`], deny: ["Bash(rm *)"] }, hooks: { Stop: [] } };
    writeFileSync(settingsFile(m), JSON.stringify(before));
    expect(await install({ item: "relay-rule" }, m.deps)).toEqual({ done: true });
    const after = JSON.parse(readFileSync(settingsFile(m), "utf8"));
    expect(after.model).toBe("opus");
    expect(after.hooks).toEqual({ Stop: [] });
    expect(after.permissions.deny).toEqual(["Bash(rm *)"]);
    const entries = relayEntries(m.deps.paths.home);
    expect(after.permissions.allow).toEqual(["Bash(git status)", `Bash(${m.deps.paths.home}/bin/fm-send.sh *)`, entries[0], entries[2], entries[3]]);
    const backups = readdirSync(join(m.deps.paths.home, ".claude")).filter((n) => n.includes("kinas-backup"));
    expect(backups).toEqual(["settings.local.json.kinas-backup-1795000000000"]);
    expect(JSON.parse(readFileSync(join(m.deps.paths.home, ".claude", backups[0]!), "utf8"))).toEqual(before);
    // Once more: nothing to add, nothing written.
    expect(await install({ item: "relay-rule" }, m.deps)).toEqual({ done: true });
    expect(readdirSync(join(m.deps.paths.home, ".claude")).filter((n) => n.includes("kinas-backup"))).toHaveLength(1);
  });

  test("no file yet: it is made with the rule alone", async () => {
    const m = withHome();
    expect(await install({ item: "relay-rule" }, m.deps)).toEqual({ done: true });
    expect(JSON.parse(readFileSync(settingsFile(m), "utf8"))).toEqual({ permissions: { allow: relayEntries(m.deps.paths.home) } });
  });

  test("relay_rule_refuses_a_file_that_is_not_json: reported, never rewritten, no copy made", async () => {
    const m = withHome();
    writeFileSync(settingsFile(m), "{ permissions: // the captain's own notes\n");
    expect(await install({ item: "relay-rule" }, m.deps)).toEqual({ cannot: "not-json" });
    expect(readFileSync(settingsFile(m), "utf8")).toBe("{ permissions: // the captain's own notes\n");
    writeFileSync(settingsFile(m), '{"permissions":{"allow":"Bash(*)"}}');
    expect(await install({ item: "relay-rule" }, m.deps)).toEqual({ cannot: "not-list" });
    expect(readFileSync(settingsFile(m), "utf8")).toBe('{"permissions":{"allow":"Bash(*)"}}');
    writeFileSync(settingsFile(m), "[]");
    expect(await install({ item: "relay-rule" }, m.deps)).toEqual({ cannot: "not-json" });
    expect(readdirSync(join(m.deps.paths.home, ".claude")).filter((n) => n.includes("kinas-"))).toEqual([]);
  });

  test("keeps: a lost key, a changed value or a dropped entry is caught", () => {
    const before = { a: 1, permissions: { allow: ["x"], deny: ["y"] } };
    expect(keeps(before, { a: 1, permissions: { allow: ["x", "z"], deny: ["y"] } })).toBe(true);
    expect(keeps(before, { permissions: { allow: ["x", "z"], deny: ["y"] } })).toBe(false);
    expect(keeps(before, { a: 1, permissions: { allow: ["z"], deny: ["y"] } })).toBe(false);
    expect(keeps(before, { a: 1, permissions: { allow: ["x"] } })).toBe(false);
  });

  test("with no Firstmate home, nothing is written", async () => {
    const m = fakeMachine();
    expect(await install({ item: "relay-rule" }, m.deps)).toEqual({ cannot: "no-firstmate" });
    expect(await install({ item: "permission-mode" }, m.deps)).toEqual({ cannot: "no-firstmate" });
  });
});

describe("the permission mode (§19 #4, slice 4.5)", () => {
  function withHome(mode: string | null) {
    const m = fakeMachine();
    mkdirSync(join(m.deps.paths.home, ".git"), { recursive: true });
    mkdirSync(join(m.deps.paths.home, "config"), { recursive: true });
    if (mode !== null) writeFileSync(join(m.deps.paths.home, "config", "claude-permission-mode"), mode);
    return m;
  }
  const file = (m: ReturnType<typeof withHome>) => join(m.deps.paths.home, "config", "claude-permission-mode");

  test("absent: auto, with no copy to keep", async () => {
    const m = withHome(null);
    expect(await install({ item: "permission-mode" }, m.deps)).toEqual({ done: true });
    expect(readFileSync(file(m), "utf8")).toBe("auto\n");
    expect(readdirSync(join(m.deps.paths.home, "config"))).toEqual(["claude-permission-mode"]);
  });

  test("bypass: auto, the old file kept beside it", async () => {
    const m = withHome("bypass\n");
    expect(await install({ item: "permission-mode" }, m.deps)).toEqual({ done: true });
    expect(readFileSync(file(m), "utf8")).toBe("auto\n");
    expect(readFileSync(`${file(m)}.kinas-backup-1795000000000`, "utf8")).toBe("bypass\n");
  });

  test("anything else is the captain's: left as it is", async () => {
    const m = withHome("plan\n");
    expect(await install({ item: "permission-mode" }, m.deps)).toEqual({ cannot: "mode-other" });
    expect(readFileSync(file(m), "utf8")).toBe("plan\n");
  });
});

describe("the crew's tools and the client folders", () => {
  test("npm tools need Node's npm: with no Node, nothing runs", async () => {
    const m = fakeMachine();
    expect(await install({ item: "crew-tools" }, m.deps)).toEqual({ cannot: "no-node" });
    expect(m.state.npm).toEqual([]);
  });

  test("with Node, each missing tool: the releases from their pins, the npm ones at their exact versions", async () => {
    const releases = fakeReleases({ treehouse: "t", "no-mistakes": "n" });
    const m = fakeMachine({}, { node: "/n/bin", releases });
    expect(await install({ item: "crew-tools" }, m.deps)).toEqual({ done: true });
    expect(releases.fetched).toEqual(["treehouse-linux", "no-mistakes-linux"]);
    expect(m.state.npm).toEqual(["gh-axi@0.1.35", "tasks-axi@0.2.6", "quota-axi@0.1.51", "chrome-devtools-axi@0.1.35", "lavish-axi@0.1.80"]);
    expect(m.ran.filter((a) => a[0] === "/n/bin/npm").every((a) => a[1] === "install" && a[2] === "-g")).toBe(true);
  });

  test("clone: gh repo clone into ~/projects/<folder>, never over a folder already there", async () => {
    const m = fakeMachine();
    expect(await install({ item: "clone", folder: "shop", repo: "acme/shop" }, m.deps)).toEqual({ done: true });
    expect(m.ran.find((a) => a[0] === m.deps.paths.gh && a[1] === "repo")).toEqual([m.deps.paths.gh, "repo", "clone", "acme/shop", join(m.deps.paths.projects, "shop"), "--", "--quiet"]);
    expect(await install({ item: "clone", folder: "shop", repo: "acme/shop" }, m.deps)).toEqual({ cannot: "exists" });
    expect(await install({ item: "clone", folder: "..", repo: "acme/shop" }, m.deps)).toEqual({ cannot: "bad-request" });
  });
});

describe("never as root", () => {
  test("every item answers root, and nothing runs", async () => {
    const m = fakeMachine({}, { uid: 0, releases: fakeReleases({ herdr: HERDR_BYTES }) });
    for (const item of ["herdr", "herdr-service", "firstmate", "relay-rule", "permission-mode", "crew-tools", "companion-service"] as const) {
      expect(await install({ item }, m.deps)).toEqual({ cannot: "root" });
    }
    expect(await install({ item: "clone", folder: "shop", repo: "acme/shop" }, m.deps)).toEqual({ cannot: "root" });
    expect(m.ran).toEqual([]);
    expect(m.herdrCalls).toEqual([]);
  });
});
