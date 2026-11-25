import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
      `HOME='${home}' KINAS_COMPANION_ROOT='${root}' exec "$@"`,
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
