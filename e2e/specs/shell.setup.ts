import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The shell spec's projects root: the tree fixtures/projects-discovery.json describes, planted under the data
// folder, so the sidebar's client folders are the fixture's repositories by name and nothing of Miguel's.

const repo = join(import.meta.dir, "../..");

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  const shared = JSON.parse(readFileSync(join(repo, "fixtures/projects-discovery.json"), "utf8")) as { tree: string[] };
  for (const p of shared.tree) {
    const file = join(root, p);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, p.endsWith("/.git") ? "gitdir: /elsewhere\n" : "ref: refs/heads/main\n");
  }
  return { KINAS_ROOT: root };
}
