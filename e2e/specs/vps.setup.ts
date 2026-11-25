import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFakeVps } from "../fake-vps/make.ts";
import { APP_LOG, startHerdrServer, stopHerdrSession } from "../helpers.ts";
import { makeStandIn, makeStubTools } from "../stub-tools/make.ts";

// Agents on a VPS (tasks/cloud-factory, build spec §12 slices 1.5, 2.4, 3.3; ADR 0024): the place set in Settings, the
// door through a stub ssh to a fake VPS, and the Crew board drawn from the companion's reading. No Firstmate home on this
// side: with a VPS set, the crew is read there and nothing runs here. The "VPS's" Herdr is the throwaway session
// `kinas-e2e-vps` — never `default` — which the companion's Herdr calls reach through the fake machine's `bin/herdr`
// and the Work page attaches through `KINAS_E2E_HERDR_REMOTE=local`; `bin/claude` there is the stand-in.

export const VPS_SESSION = "kinas-e2e-vps";

export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession(VPS_SESSION);
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  startHerdrServer(VPS_SESSION, config);
  const vps = makeFakeVps(dataDir, { herdrSession: VPS_SESSION });
  makeStandIn(join(vps.root, "bin"));
  // ADR 0026: the launch needs Kinas's own copy of the relay instruction there. The companion's install writes and
  // records it, exactly as Settings' Install would — run directly, so the stub ssh's calls.log holds only the app's calls.
  const home = join(dataDir, "fake-vps", "home");
  const installed = spawnSync(join(home, ".local", "bin", "kinas"), ["companion", "rpc"], {
    cwd: home,
    env: { ...process.env, HOME: home, KINAS_COMPANION_ROOT: vps.root },
    input: '{"verb":"install","item":"relay-instruction"}\n',
    encoding: "utf8",
  });
  if (installed.status !== 0 || !/"done":true/.test(installed.stdout)) throw new Error(`the relay instruction was not installed: ${installed.stdout}${installed.stderr}`);
  const tools = makeStubTools(join(dataDir, "tools"));
  return {
    KINAS_E2E_SSH: vps.ssh,
    KINAS_E2E_TOOL_DIR: tools,
    // The pane attaches Herdr (not the base env's plain shell), and with the VPS set it is the throwaway session here.
    KINAS_PANE_SHELL_ONLY: "0",
    KINAS_HERDR_SESSION: VPS_SESSION,
    KINAS_E2E_HERDR_REMOTE: "local",
    KINAS_E2E_HERDR_CONFIG_PATH: config,
    KINAS_E2E_LOG_FROM: String(existsSync(APP_LOG) ? statSync(APP_LOG).size : 0),
  };
}

export function teardown(): void {
  stopHerdrSession(VPS_SESSION);
}
