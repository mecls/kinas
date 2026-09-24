import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, herdr, startHerdrServer, stopHerdrSession } from "../helpers.ts";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStandIn, makeStubTools } from "../stub-tools/make.ts";

// The launcher and the start focus (build spec AC-2, AC-16), in the throwaway session `kinas-e2e-crew` — never `default`
// — with the fake Firstmate home, every tool a stub, and a stand-in for `claude`. Before Kinas starts, the session holds
// an unfocused `firstmate` workspace and a focused other one, so the start focus has something to do.

export const SESSION = "kinas-e2e-crew";

export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession(SESSION);
  const home = makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json");
  const tools = makeStubTools(join(dataDir, "tools"));
  const standIn = makeStandIn(join(dataDir, "standin"));
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  startHerdrServer(SESSION, config);
  herdr(SESSION, "workspace", "create", "--cwd", home, "--label", "firstmate", "--no-focus");
  herdr(SESSION, "workspace", "create", "--cwd", join(dataDir, "root"), "--label", "elsewhere", "--focus");
  return {
    KINAS_PANE_SHELL_ONLY: "0",
    KINAS_HERDR_SESSION: SESSION,
    KINAS_E2E_HERDR_CONFIG_PATH: config,
    KINAS_E2E_TOOL_DIR: tools,
    KINAS_E2E_CREW_COMMAND: standIn,
    // Where this run's lines start in the shared log.
    KINAS_E2E_LOG_FROM: String(existsSync(APP_LOG) ? statSync(APP_LOG).size : 0),
  };
}

export function teardown(): void {
  stopHerdrSession(SESSION);
}
