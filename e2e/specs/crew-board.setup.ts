import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, herdr, startHerdrServer, stopHerdrSession } from "../helpers.ts";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStubTools } from "../stub-tools/make.ts";

// The board, the PR and the task detail (build spec AC-4, AC-6, AC-7), in the throwaway session `kinas-e2e-crew` —
// never `default` — with the fake Firstmate home (its clones name o/alpha-9c2e, o/beta-9c2e, o/gamma-9c2e and
// acme-9c2e/shop-9c2e; delta-9c2e has no origin), every tool a stub, a stub `gh`, and two client folders whose git
// configs name alpha and beta. The session holds a worker's workspace, unfocused, for the snapshot's endpoint.target.

export const SESSION = "kinas-e2e-crew";

function clientFolder(root: string, name: string, origin: string) {
  mkdirSync(join(root, name, ".git"), { recursive: true });
  writeFileSync(join(root, name, ".git", "config"), `[remote "origin"]\n\turl = ${origin}\n`);
  writeFileSync(join(root, name, ".git", "HEAD"), "ref: refs/heads/main\n");
}

export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession(SESSION);
  const home = makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json", { clones: true });
  const tools = makeStubTools(join(dataDir, "tools"));
  const root = join(dataDir, "root");
  clientFolder(root, "alpha-9c2e", "git@github.com:o/alpha-9c2e.git");
  clientFolder(root, "beta-9c2e", "https://github.com/O/Beta-9c2e");
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  startHerdrServer(SESSION, config);
  // A worker's own workspace, as Firstmate makes one (slice 0), and another focused: Open its pane must move the focus.
  const created = JSON.parse(herdr(SESSION, "workspace", "create", "--cwd", home, "--label", "└ shop-health-9c2e · p:e2e", "--no-focus")) as {
    result: { root_pane: { pane_id: string } };
  };
  writeFileSync(join(dataDir, "worker-pane.txt"), created.result.root_pane.pane_id);
  herdr(SESSION, "workspace", "create", "--cwd", root, "--label", "elsewhere", "--focus");
  return {
    KINAS_ROOT: root,
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
