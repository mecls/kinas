import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStubTools } from "../stub-tools/make.ts";

// Home's night (build spec AC-15, the Home half): the fake Firstmate home with its clones (alpha names o/alpha-9c2e),
// every tool a stub, and two client folders — alpha-9c2e, the crew's, and quiet-9c2e, with no work. No Herdr: the pane
// is a plain shell, and nothing here launches the first mate.

function clientFolder(root: string, name: string, origin: string) {
  mkdirSync(join(root, name, ".git"), { recursive: true });
  writeFileSync(join(root, name, ".git", "config"), `[remote "origin"]\n\turl = ${origin}\n`);
  writeFileSync(join(root, name, ".git", "HEAD"), "ref: refs/heads/main\n");
}

export function setup(dataDir: string): Record<string, string> {
  makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json", { clones: true });
  const root = join(dataDir, "root");
  clientFolder(root, "alpha-9c2e", "https://github.com/o/alpha-9c2e");
  clientFolder(root, "quiet-9c2e", "https://github.com/o/quiet-9c2e");
  return { KINAS_ROOT: root, KINAS_E2E_TOOL_DIR: makeStubTools(join(dataDir, "tools")) };
}
