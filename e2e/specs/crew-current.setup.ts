import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, herdr, startHerdrServer, stopHerdrSession } from "../helpers.ts";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStandIn, makeStubTools } from "../stub-tools/make.ts";

// Firstmate, current (tasks/crew-firstmate-current/prd.md, build spec §11.4): what Firstmate 427056c publishes, on the
// Crew page, the Inbox, Home, Usage and Settings. In the throwaway session `kinas-e2e-crew` — never `default` — with the
// fake Firstmate home at the current shape (fixtures/firstmate-fleet-snapshot.current.synthetic.json), every tool a stub,
// the clipboard a file, a stand-in for `claude` in a `firstmate` workspace, and no browser: KINAS_E2E_NO_OPEN logs a
// link instead of opening it.

export const SESSION = "kinas-e2e-crew";

const paneOf = (json: string) => (JSON.parse(json) as { result: { root_pane: { pane_id: string } } }).result.root_pane.pane_id;

export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession(SESSION);
  const home = makeFakeHome(dataDir, "firstmate-fleet-snapshot.current.synthetic.json", { clones: true });
  const tools = makeStubTools(join(dataDir, "tools"));
  const standIn = makeStandIn(join(dataDir, "standin"));
  const root = join(dataDir, "root");
  mkdirSync(root, { recursive: true });
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  startHerdrServer(SESSION, config);
  const firstMate = paneOf(herdr(SESSION, "workspace", "create", "--cwd", home, "--label", "firstmate", "--no-focus"));
  herdr(SESSION, "pane", "run", firstMate, standIn);
  herdr(SESSION, "workspace", "create", "--cwd", root, "--label", "elsewhere", "--focus");
  return {
    KINAS_ROOT: root,
    KINAS_PANE_SHELL_ONLY: "0",
    KINAS_HERDR_SESSION: SESSION,
    KINAS_E2E_HERDR_CONFIG_PATH: config,
    KINAS_E2E_TOOL_DIR: tools,
    KINAS_E2E_CREW_COMMAND: standIn,
    KINAS_E2E_CLIPBOARD_FILE: join(dataDir, "clipboard.txt"),
    KINAS_E2E_NO_OPEN: "1",
    KINAS_E2E_LOG_FROM: String(existsSync(APP_LOG) ? statSync(APP_LOG).size : 0),
  };
}

export function teardown(): void {
  stopHerdrSession(SESSION);
}
