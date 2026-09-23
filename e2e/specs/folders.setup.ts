import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Folder views (tasks/folder-views/prd.md §5): the tree fixtures/projects-discovery.json describes — six client folders
// by name — planted under the data folder as the shell spec plants it, plus `plain/`, a folder with no .git for Add a
// client folder… to take. The folder sheet cannot be clicked by an agent: a debug build reads its pick from the file
// KINAS_E2E_PICK_FOLDER names (projects.rs), which the spec rewrites between cases. Empty is Cancel.

const repo = join(import.meta.dir, "../..");

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  const shared = JSON.parse(readFileSync(join(repo, "fixtures/projects-discovery.json"), "utf8")) as { tree: string[] };
  for (const p of shared.tree) {
    const file = join(root, p);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, p.endsWith("/.git") ? "gitdir: /elsewhere\n" : "ref: refs/heads/main\n");
  }
  mkdirSync(join(root, "plain"), { recursive: true });
  const pick = join(dataDir, "pick.txt");
  writeFileSync(pick, "");
  return { KINAS_ROOT: root, KINAS_E2E_PICK_FOLDER: pick };
}
