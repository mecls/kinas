import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Tree changes (tasks/tree-changes/prd.md §5): a projects root holding `repo` and `plain`. Every name and text carries
// the same token, found nowhere else, so a later step can say none of them reached the log.
//
// `repo` is a plain folder until slice 3 makes it a real git repository, with README and docs/old committed and
// notes/ ignored; everything here holds for both.

export const TOKEN = "5d1c";
export const README_TEXT = `# Repo ${TOKEN}\n\nThe committed text.\n`;
export const OLD_TEXT = ["# Old", "", `One ${TOKEN}.`, `Two ${TOKEN}.`, `Three ${TOKEN}.`].join("\n") + "\n";

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  const repo = join(root, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(join(repo, "notes"), { recursive: true });
  mkdirSync(join(repo, "node_modules"), { recursive: true });
  writeFileSync(join(repo, `README-${TOKEN}.md`), README_TEXT);
  writeFileSync(join(repo, "docs", `old-${TOKEN}.md`), OLD_TEXT);
  writeFileSync(join(repo, "notes", `n-${TOKEN}.md`), `# Notes ${TOKEN}\n`);
  writeFileSync(join(repo, "node_modules", `x-${TOKEN}.md`), `# Hidden ${TOKEN}\n`);

  const plain = join(root, "plain");
  mkdirSync(join(plain, "docs"), { recursive: true });
  writeFileSync(join(plain, `README-${TOKEN}.md`), `# Plain ${TOKEN}\n\nA folder that is not a repository.\n`);
  writeFileSync(join(plain, "docs", `overview-${TOKEN}.md`), `# Overview ${TOKEN}\n`);
  return { KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}
