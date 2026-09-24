import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Tree changes (tasks/tree-changes/prd.md §5): a projects root holding `plain`, a folder that is not a repository.
// Every name and text carries the same token, found nowhere else, so a later step can say none of them reached the
// log. Slice 3 adds `repo`, a real git repository beside it.

export const TOKEN = "5d1c";

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  const plain = join(root, "plain");
  mkdirSync(join(plain, "docs"), { recursive: true });
  writeFileSync(join(plain, `README-${TOKEN}.md`), `# Plain ${TOKEN}\n\nA folder that is not a repository.\n`);
  writeFileSync(join(plain, "docs", `overview-${TOKEN}.md`), `# Overview ${TOKEN}\n\nThe first version.\n`);
  return { KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}
