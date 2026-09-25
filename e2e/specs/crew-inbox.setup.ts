import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, herdr, startHerdrServer, stopHerdrSession } from "../helpers.ts";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStandIn, makeStubTools } from "../stub-tools/make.ts";

// The Inbox (build spec AC-5, AC-12, AC-14, the one count), in the throwaway session `kinas-e2e-crew` — never `default`
// — with the fake Firstmate home, every tool a stub, the clipboard a file (KINAS_E2E_CLIPBOARD_FILE), and a stand-in for
// `claude` that records its arguments and every byte of its stdin. Before Kinas starts, the session holds a `firstmate`
// workspace whose pane runs the stand-in, a held task's worker, and another workspace, focused.

export const SESSION = "kinas-e2e-crew";

const paneOf = (json: string) => (JSON.parse(json) as { result: { root_pane: { pane_id: string } } }).result.root_pane.pane_id;

export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession(SESSION);
  const home = makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json");
  const tools = makeStubTools(join(dataDir, "tools"));
  const standIn = makeStandIn(join(dataDir, "standin"));
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  startHerdrServer(SESSION, config);
  const firstMate = paneOf(herdr(SESSION, "workspace", "create", "--cwd", home, "--label", "firstmate", "--no-focus"));
  herdr(SESSION, "pane", "run", firstMate, standIn);
  const worker = paneOf(herdr(SESSION, "workspace", "create", "--cwd", home, "--label", "└ held-9c2e · p:e2e", "--no-focus"));
  writeFileSync(join(dataDir, "worker-pane.txt"), worker);
  herdr(SESSION, "workspace", "create", "--cwd", join(dataDir, "root"), "--label", "elsewhere", "--focus");
  return {
    KINAS_PANE_SHELL_ONLY: "0",
    KINAS_HERDR_SESSION: SESSION,
    KINAS_E2E_HERDR_CONFIG_PATH: config,
    KINAS_E2E_TOOL_DIR: tools,
    KINAS_E2E_CREW_COMMAND: standIn,
    KINAS_E2E_CLIPBOARD_FILE: join(dataDir, "clipboard.txt"),
    KINAS_E2E_LOG_FROM: String(existsSync(APP_LOG) ? statSync(APP_LOG).size : 0),
  };
}

export function teardown(): void {
  stopHerdrSession(SESSION);
}
