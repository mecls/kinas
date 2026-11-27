// Tests only: a Linux machine as setup.ts and install.ts see it, in a temporary test root (KINAS_COMPANION_ROOT) — its
// systemd user manager, loginctl, gh, git and Herdr's server are state here, and only `tar` runs for real. Nothing
// outside the root is read or written, and every argv run is kept in `ran` for the tests to assert on.

import { FIRSTMATE_PIN, type LinuxRelease } from "@kinas/commands/crew-tools";
import { run as realRun } from "@kinas/context";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HerdrCall } from "./herdr.ts";
import { companionPaths } from "./paths.ts";
import { HERDR_UNIT, type Releases, type RunOut, type SetupDeps } from "./setup.ts";

export interface MachineState {
  /** Herdr's `default` server. */
  server: { running: boolean; startsWithUnit: boolean; stops: boolean };
  /** systemd's user manager answers. */
  systemd: boolean;
  units: Record<string, "active" | "inactive">;
  linger: "yes" | "no" | null;
  gh: { present: boolean; signedIn: boolean };
  /** What `bash -l -c 'env -0'` prints. */
  loginEnv: string;
  /** Packages `npm install -g` was asked for. */
  npm: string[];
}

export interface FakeMachine {
  deps: SetupDeps;
  state: MachineState;
  root: string;
  /** Herdr's session folder, where its socket is: Firstmate's markers go here. */
  sessionDir: string;
  ran: string[][];
  herdrCalls: string[][];
}

const ok = (stdout = ""): RunOut => ({ ok: true, code: 0, stdout, stderr: "" });
const no = (stderr = ""): RunOut => ({ ok: false, code: 1, stdout: "", stderr });

/** A Releases whose assets are `bytes` under their pinned names, pinned at their own SHA-256. */
export function fakeReleases(bytes: Record<string, string>, kinds: Record<string, "raw" | "tar.gz"> = {}): Releases & { fetched: string[] } {
  const sum = (s: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
  const pins: LinuxRelease[] = Object.entries(bytes).map(([name, body]) => {
    const asset = `${name}-linux`;
    return { name, version: "0.9.5", repo: `fake/${name}`, kind: kinds[name] ?? "raw", assets: { x64: { asset, sha256: sum(body) }, arm64: { asset, sha256: sum(body) } } };
  });
  const fetched: string[] = [];
  return {
    pins,
    fetched,
    async fetch(release, asset, dest) {
      fetched.push(asset);
      const body = bytes[release.name];
      if (body === undefined) return false;
      writeFileSync(dest, body);
      return true;
    },
  };
}

export function fakeMachine(over: Partial<MachineState> = {}, setup: Partial<SetupDeps> = {}): FakeMachine {
  const root = mkdtempSync(join(tmpdir(), "kinas-setup-"));
  const paths = companionPaths({ KINAS_COMPANION_ROOT: root });
  const home = join(root, "home");
  const sessionDir = join(root, "herdr-session");
  mkdirSync(home, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  const state: MachineState = {
    server: { running: false, startsWithUnit: true, stops: true },
    systemd: true,
    units: {},
    linger: "yes",
    gh: { present: true, signedIn: true },
    loginEnv: "HOME=/home/c\0PATH=/usr/bin\0",
    npm: [],
    ...over,
  };
  const ran: string[][] = [];
  const herdrCalls: string[][] = [];

  const run = async (argv: string[]): Promise<RunOut> => {
    ran.push(argv);
    const [cmd, ...args] = argv;
    if (cmd === paths.systemctl) {
      if (!state.systemd) return no("Failed to connect to bus: No medium found");
      const [, verb, ...rest] = args;
      if (verb === "is-active") return { ...no(), stdout: `${state.units[rest[0]!] ?? "inactive"}\n`, code: state.units[rest[0]!] === "active" ? 0 : 3, ok: state.units[rest[0]!] === "active" };
      if (verb === "daemon-reload") return ok();
      if (verb === "enable" && rest[0] === "--now") {
        state.units[rest[1]!] = "active";
        if (rest[1] === HERDR_UNIT && state.server.startsWithUnit) state.server.running = true;
        return ok();
      }
      if (verb === "restart") {
        if (state.units[rest[0]!] !== "active") return no();
        if (rest[0] === HERDR_UNIT) state.server.running = state.server.startsWithUnit;
        return ok();
      }
      if (verb === "disable" && rest[0] === "--now") {
        state.units[rest[1]!] = "inactive";
        if (rest[1] === HERDR_UNIT) state.server.running = false;
        return ok();
      }
      return no();
    }
    if (cmd === paths.loginctl) return state.linger === null ? no("Failed to connect to bus") : ok(`Linger=${state.linger}\n`);
    if (cmd === paths.gh) {
      if (!state.gh.present) return { ...no(), error: "ENOENT" } as RunOut;
      if (args[0] === "auth") return state.gh.signedIn ? ok() : no("You are not logged into any GitHub hosts.");
      if (args[0] === "repo" && args[1] === "clone") {
        mkdirSync(join(args[3]!, ".git"), { recursive: true });
        return ok();
      }
      return no();
    }
    if (cmd === "bash" && args.join(" ") === "-l -c env -0") return ok(state.loginEnv);
    if (cmd === "git") {
      if (args[0] === "clone") {
        mkdirSync(join(args[args.length - 1]!, ".git"), { recursive: true });
        return ok();
      }
      if (args[0] === "-C" && args[2] === "checkout") return ok();
      if (args[0] === "-C" && args[2] === "rev-parse") return ok(`${FIRSTMATE_PIN}\n`);
      return no();
    }
    if (cmd === paths.herdr && args[0] === "--version") return ok("herdr 0.9.5\n");
    if (cmd?.endsWith("/npm") && args[0] === "install") {
      state.npm.push(args[2]!);
      // The sandbox's runtime lands beside Node, its seccomp helper inside, as npm puts it.
      if (args[2]?.startsWith("@anthropic-ai/sandbox-runtime@")) {
        for (const arch of ["x64", "arm64"]) {
          const dir = join(dirname(cmd), "..", "lib", "node_modules", "@anthropic-ai", "sandbox-runtime", "vendor", "seccomp", arch);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, "apply-seccomp"), "");
        }
      }
      return ok();
    }
    if (cmd === "tar") return realRun(argv, { timeoutMs: 20_000 });
    return no(`not on the fake machine: ${cmd}`);
  };

  const herdr = async (call: HerdrCall) => {
    herdrCalls.push([...call.args]);
    if (call.args[0] === "status") {
      return { ok: true, stdout: JSON.stringify({ server: { running: state.server.running, socket: join(sessionDir, "herdr.sock") } }) };
    }
    if (call.args[0] === "server" && call.args[1] === "stop") {
      if (state.server.stops) state.server.running = false;
      return { ok: state.server.stops, stdout: "" };
    }
    return { ok: false, stdout: "" };
  };

  const deps: SetupDeps = {
    paths,
    home,
    user: "captain",
    uid: 1001,
    platform: "linux",
    arch: "x64",
    env: {},
    path: `${home}/.local/bin:/usr/bin:/bin`,
    node: null,
    run,
    herdr,
    releases: fakeReleases({}),
    which: () => null,
    machine: () => ({ cores: 8, memBytes: 15 * 1024 ** 3, freeBytes: 296 * 1024 ** 3 }),
    sleep: async () => {},
    now: () => 1_795_000_000_000,
    fetch: async () => ({ status: 599, text: async () => "" }),
    ...setup,
  };
  return { deps, state, root, sessionDir, ran, herdrCalls };
}

/** A Firstmate runner for an rpc test that runs no script: any call fails the test. */
export const NO_FIRSTMATE: import("./firstmate.ts").Firstmate = {
  run: async (call) => {
    throw new Error(`no Firstmate in this test: ${call.script}`);
  },
};
