import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStubTools } from "../stub-tools/make.ts";

// Done work clears (tasks/crew-done-clears/prd.md §5): the fake Firstmate home with its clones (alpha names
// o/alpha-9c2e, and shop-9c2e acme-9c2e/shop-9c2e), every tool a stub — `gh` answering fixtures/crew-gh-<n>.json — and
// one client folder, alpha-9c2e, the crew's. No Herdr: the pane is a plain shell, and nothing here launches the first
// mate. Every name carries the token 9c2e.

function clientFolder(root: string, name: string, origin: string) {
  mkdirSync(join(root, name, ".git"), { recursive: true });
  writeFileSync(join(root, name, ".git", "config"), `[remote "origin"]\n\turl = ${origin}\n`);
  writeFileSync(join(root, name, ".git", "HEAD"), "ref: refs/heads/main\n");
}

export function setup(dataDir: string): Record<string, string> {
  makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json", { clones: true });
  const root = join(dataDir, "root");
  clientFolder(root, "alpha-9c2e", "https://github.com/o/alpha-9c2e");
  return { KINAS_ROOT: root, KINAS_E2E_TOOL_DIR: makeStubTools(join(dataDir, "tools")) };
}
