import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { herdr, startHerdrServer, stopHerdrSession } from "../helpers.ts";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStandIn, makeStubTools } from "../stub-tools/make.ts";

// The Work page's chrome (build spec AC-18), in `kinas-e2e-crew`: the first mate's workspace running the stand-in, and a
// worker's workspace as Firstmate makes one — labelled `└ <id> · p:<token>`, its tab `fm-<id>` — behind the working
// task's endpoint.target, so the collector finds its pane.

export const SESSION = "kinas-e2e-crew";
const TASK = "shop-health-9c2e";

interface Created {
  result: { root_pane: { pane_id: string; tab_id: string } };
}

export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession(SESSION);
  const home = makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json");
  const tools = makeStubTools(join(dataDir, "tools"));
  const standIn = makeStandIn(join(dataDir, "standin"));
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  startHerdrServer(SESSION, config);
  const mate = JSON.parse(herdr(SESSION, "workspace", "create", "--cwd", home, "--label", "firstmate", "--focus")) as Created;
  herdr(SESSION, "pane", "run", mate.result.root_pane.pane_id, standIn);
  const worker = JSON.parse(herdr(SESSION, "workspace", "create", "--cwd", join(dataDir, "root"), "--label", `└ ${TASK} · p:e2e`, "--no-focus")) as Created;
  herdr(SESSION, "tab", "rename", worker.result.root_pane.tab_id, `fm-${TASK}`);
  herdr(SESSION, "pane", "run", worker.result.root_pane.pane_id, standIn);
  // The working snapshot, its target pointed at the worker's real pane.
  const fixtures = join(home, "fixtures", "snapshot.json");
  const snapshot = readFileSync(join(process.cwd(), "fixtures", "crew-snapshot.working.synthetic.json"), "utf8")
    .replaceAll("__FM_HOME__", home)
    .replace("kinas-e2e-crew:w2:p2", `${SESSION}:${worker.result.root_pane.pane_id}`);
  writeFileSync(fixtures, snapshot);
  return {
    KINAS_PANE_SHELL_ONLY: "0",
    KINAS_HERDR_SESSION: SESSION,
    KINAS_E2E_HERDR_CONFIG_PATH: config,
    KINAS_E2E_TOOL_DIR: tools,
    KINAS_E2E_CREW_COMMAND: standIn,
  };
}

export function teardown(): void {
  stopHerdrSession(SESSION);
}
