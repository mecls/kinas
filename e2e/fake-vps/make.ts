import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFakeHome } from "../fake-firstmate/make.ts";

// A fake VPS for the VPS specs (build spec §12 slice 1.5; ADR 0024): a stub `ssh` the app runs in place of /usr/bin/ssh
// (KINAS_E2E_SSH, debug builds only), and the machine it "reaches" — a home folder holding `.local/bin/kinas` (the CLI
// this run built) and a companion root holding the latest reading (fixtures/companion-bundle.synthetic.json), a
// Herdr that says 0.9.5 and answers nothing else, and the fake Firstmate home of the crew specs (slice 2), so `refresh`
// runs the companion's own reading over the same snapshot. Nothing leaves this Mac and no real ssh runs.
//
// The stub takes the door's argv as ssh would: options up to `--`, then the target, then the remote command, which it
// runs from the fake home exactly as written (`.local/bin/kinas companion rpc`, relative to the login folder), with the
// request on its stdin and HOME the fake home, as a login there has. It answers only `TARGET`; any other target fails as
// an unresolvable host does, exit 255, and while `down` exists beside it (`setDown`) every call times out as a machine
// that stopped answering does. Each call's argv goes to `calls.log` beside it, never the request.
//
// Slice 3: given a throwaway session (`herdrSession`), the machine's Herdr is this Mac's real one on that session — the
// companion's `--session default` swapped for it, HOME this Mac's so the client finds the session's server — and
// `bin/claude` is the stand-in the launcher types. Each Herdr call's argv goes to `herdr.log`. Without one, Herdr says
// 0.9.5 and answers nothing else, as before.

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtures = join(repo, "fixtures");

/** The one target the stub answers. */
export const TARGET = "captain@vps-e2e";
export const LABEL = "vps-e2e";
/** The phone page's address the fake companion knows (slice 8.1): the pairing link is `<this>/#pair=<code>`. */
export const PHONE_URL = "https://kinas-phone.example.test";

export interface FakeVps {
  /** The stub ssh: KINAS_E2E_SSH. */
  ssh: string;
  /** The companion's root (KINAS_COMPANION_ROOT): state/reading.json and bin/herdr. */
  root: string;
  /** Every argv the stub was run with, one line each. */
  calls: string;
  /** Every Herdr argv the companion ran, after `--session default`, one line each (slice 3). */
  herdrCalls: string;
}

function script(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

export function makeFakeVps(dataDir: string, opts: { herdrSession?: string } = {}): FakeVps {
  const dir = join(dataDir, "fake-vps");
  const home = join(dir, "home");
  const root = join(dir, "companion");
  const calls = join(dir, "calls.log");
  const cli = join(repo, "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
  if (!existsSync(cli)) throw new Error(`the fake VPS needs the built CLI at ${cli} (bun run build:cli)`);

  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  symlinkSync(cli, join(home, ".local", "bin", "kinas"));
  mkdirSync(join(root, "state"), { recursive: true });
  copyFileSync(join(fixtures, "companion-bundle.synthetic.json"), join(root, "state", "reading.json"));
  mkdirSync(join(root, "bin"), { recursive: true });
  const herdrCalls = join(dir, "herdr.log");
  const session = opts.herdrSession;
  script(
    join(root, "bin", "herdr"),
    session === undefined
      ? `[ "$1" = "--version" ] || exit 1\necho "herdr 0.9.5"`
      : [
          `[ "$1" = "--version" ] && { echo "herdr 0.9.5"; exit 0; }`,
          `[ "$1" = "--session" ] && [ "$2" = "default" ] || { echo "the fake VPS's Herdr serves default only" >&2; exit 1; }`,
          `shift 2`,
          `echo "$*" >> '${herdrCalls}'`,
          `HOME='${homedir()}' exec '${join(homedir(), ".local/bin/herdr")}' --session '${session}' "$@"`,
        ].join("\n"),
  );
  makeFakeHome(root, "firstmate-fleet-snapshot.current.synthetic.json", { clones: true });

  const ssh = join(dir, "ssh");
  script(
    ssh,
    [
      `echo "ssh $*" >> '${calls}'`,
      `while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done`,
      `[ "$1" = "--" ] || { echo "ssh: the door's argv has no --" >&2; exit 255; }`,
      `shift; target=$1; shift`,
      `[ "$target" = '${TARGET}' ] || { echo "ssh: Could not resolve hostname $target: nodename nor servname provided" >&2; exit 255; }`,
      `[ -e '${join(dir, "down")}' ] && { echo "ssh: connect to host vps-e2e port 22: Operation timed out" >&2; exit 255; }`,
      `cd '${home}' || exit 255`,
      // Slice 8.1: the companion's cloud is a JSONL file beside the calls log, and the phone page has an address.
      `HOME='${home}' KINAS_COMPANION_ROOT='${root}' KINAS_COMPANION_CLOUD='file:${join(dir, "cloud.jsonl")}' KINAS_PHONE_URL='${PHONE_URL}' exec "$@"`,
    ].join("\n"),
  );
  return { ssh, root, calls, herdrCalls };
}

/** The machine stops answering (`true`) or answers again (`false`), as the stub sees it on its next call. */
export function setDown(dataDir: string, down: boolean): void {
  const flag = join(dataDir, "fake-vps", "down");
  if (down) writeFileSync(flag, "");
  else rmSync(flag, { force: true });
}

/**
 * Slice 4.4: the machine without its companion (`present` false: `.local/bin/kinas` moved aside, so the door's ssh runs
 * and `kinas` is not found, exit 127), or with it again.
 */
export function setCompanion(dataDir: string, present: boolean): void {
  const bin = join(dataDir, "fake-vps", "home", ".local", "bin");
  if (present && existsSync(join(bin, "kinas.away"))) renameSync(join(bin, "kinas.away"), join(bin, "kinas"));
  if (!present && existsSync(join(bin, "kinas"))) renameSync(join(bin, "kinas"), join(bin, "kinas.away"));
}

/** The stand-in Herdr setup installs on the fake VPS: it says 0.9.5 and nothing else. */
export const HERDR_STAND_IN = `#!/bin/sh\n[ "$1" = "--version" ] || exit 1\necho "herdr 0.9.5"\n`;

/**
 * Slice 4.4 (build spec §17 2026-11-25 #8): Herdr not installed on the fake VPS yet, and its pinned release a stand-in
 * in the companion root's `releases/`, pinned at its own SHA-256 by `releases/pins.json` — so Install Herdr downloads
 * nothing and still checks the SHA-256 it is given.
 */
export function plantHerdrRelease(root: string): void {
  const dir = join(root, "releases");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "herdr-stand-in"), HERDR_STAND_IN);
  const sha256 = createHash("sha256").update(HERDR_STAND_IN).digest("hex");
  const asset = { asset: "herdr-stand-in", sha256 };
  writeFileSync(join(dir, "pins.json"), JSON.stringify([{ name: "herdr", version: "0.9.5", repo: "fake/herdr", kind: "raw", assets: { x64: asset, arm64: asset } }]));
  rmSync(join(root, "bin", "herdr"), { force: true });
}

/** The pid namespace a fake /proc gives the companion and every process planted beside it. */
const HOST_NS = "pid:[4026531836]";
/** The process `plantSandbox` plants outside the sandbox. */
export const OUTSIDER_PID = 4242;

/**
 * Slice 6.3 (ADR 0027): what the companion's note gate reads, so a note can be written on the fake VPS — `bwrap` and
 * `socat` on its PATH, Node's folder with the sandbox runtime's seccomp helper, and a /proc under the companion's root
 * holding the companion's own namespace. Stand-ins all: the gate only finds them, it never runs them. With `outsider`,
 * a task's process (`FM_TASK_ID` that task) runs outside Kinas's sandbox, and the gate refuses every note; without it,
 * none does.
 */
export function plantSandbox(dataDir: string, outsider: string | null): void {
  const home = join(dataDir, "fake-vps", "home");
  const root = join(dataDir, "fake-vps", "companion");
  for (const tool of ["bwrap", "socat"]) script(join(home, ".local", "bin", tool), "exit 1");
  const node = join(home, ".local", "share", "fnm", "aliases", "default", "bin");
  mkdirSync(node, { recursive: true });
  script(join(node, "node"), "exit 1");
  const arch = process.arch === "x64" ? "x64" : "arm64";
  const helper = join(node, "..", "lib", "node_modules", "@anthropic-ai", "sandbox-runtime", "vendor", "seccomp", arch);
  mkdirSync(helper, { recursive: true });
  script(join(helper, "apply-seccomp"), "exit 1");
  const proc = join(root, "proc");
  const link = (target: string, at: string) => {
    rmSync(at, { force: true });
    symlinkSync(target, at);
  };
  mkdirSync(join(proc, "self", "ns"), { recursive: true });
  link(HOST_NS, join(proc, "self", "ns", "pid"));
  const dir = join(proc, String(OUTSIDER_PID));
  rmSync(dir, { recursive: true, force: true });
  if (outsider === null) return;
  const uid = process.getuid?.() ?? 0;
  mkdirSync(join(dir, "ns"), { recursive: true });
  writeFileSync(join(dir, "status"), `Name:\tpython3\nPPid:\t1\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nNoNewPrivs:\t0\nSeccomp:\t0\n`);
  writeFileSync(join(dir, "cmdline"), "python3\0worker.py\0");
  writeFileSync(join(dir, "environ"), `FM_TASK_ID=${outsider}\0`);
  link("/usr/bin/python3", join(dir, "exe"));
  link("/", join(dir, "cwd"));
  link(HOST_NS, join(dir, "ns", "pid"));
}
