import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, herdr, startHerdrServer, stopHerdrSession } from "../helpers.ts";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStandIn, makeStubTools } from "../stub-tools/make.ts";

// Add to crew (build spec AC-17), in the throwaway session `kinas-e2e-crew` — never `default` — with the fake Firstmate
// home (no clones: nothing is in the crew yet), every tool a stub, the clipboard a file, and a stand-in for `claude`
// that records its arguments and its stdin. Three client folders: alpha-9c2e (github.com/o/alpha-9c2e), plain-9c2e (no
// remote) and quote-9c2e, whose origin carries a quote. No `firstmate` workspace: the first mate starts stopped.

export const SESSION = "kinas-e2e-crew";

function clientFolder(root: string, name: string, origin: string | null) {
  mkdirSync(join(root, name, ".git"), { recursive: true });
  writeFileSync(join(root, name, ".git", "config"), origin ? `[remote "origin"]\n\turl = ${origin}\n` : "[core]\n\tbare = false\n");
  writeFileSync(join(root, name, ".git", "HEAD"), "ref: refs/heads/main\n");
}

export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession(SESSION);
  makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json");
  const tools = makeStubTools(join(dataDir, "tools"));
  const standIn = makeStandIn(join(dataDir, "standin"));
  const root = join(dataDir, "root");
  clientFolder(root, "alpha-9c2e", "git@github.com:o/alpha-9c2e.git");
  clientFolder(root, "plain-9c2e", null);
  clientFolder(root, "quote-9c2e", "https://github.com/o/al'pha");
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  startHerdrServer(SESSION, config);
  herdr(SESSION, "workspace", "create", "--cwd", root, "--label", "elsewhere", "--focus");
  return {
    KINAS_ROOT: root,
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
