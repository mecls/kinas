import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, herdr, startHerdrServer, stopHerdrSession } from "../helpers.ts";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStubTools } from "../stub-tools/make.ts";

// The order log (build spec AC-8), in the throwaway session `kinas-e2e-crew` — never `default` — with the fake Firstmate
// home and every tool a stub. The session holds a worker's workspace (the snapshot's endpoint.target names its pane) and
// a `firstmate` workspace, both plain shells: what the spec types runs there as the captain's lines would.

export const SESSION = "kinas-e2e-crew";

const paneOf = (json: string) => (JSON.parse(json) as { result: { root_pane: { pane_id: string } } }).result.root_pane.pane_id;

export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession(SESSION);
  const home = makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json");
  const tools = makeStubTools(join(dataDir, "tools"));
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  startHerdrServer(SESSION, config);
  const worker = paneOf(herdr(SESSION, "workspace", "create", "--cwd", home, "--label", "└ shop-health-9c2e · p:e2e", "--no-focus"));
  writeFileSync(join(dataDir, "worker-pane.txt"), worker);
  herdr(SESSION, "workspace", "create", "--cwd", home, "--label", "firstmate", "--focus");
  return {
    KINAS_PANE_SHELL_ONLY: "0",
    KINAS_HERDR_SESSION: SESSION,
    KINAS_E2E_HERDR_CONFIG_PATH: config,
    KINAS_E2E_TOOL_DIR: tools,
    KINAS_E2E_LOG_FROM: String(existsSync(APP_LOG) ? statSync(APP_LOG).size : 0),
  };
}

export function teardown(): void {
  stopHerdrSession(SESSION);
}
