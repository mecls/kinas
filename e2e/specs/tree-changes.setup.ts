import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tree changes (tasks/tree-changes/prd.md §5): a projects root holding `repo` and `plain`. Every name and text carries
// the same token, found nowhere else, so a later step can say none of them reached the log.
//
// `repo` is a real git repository: README and docs/old committed, notes/ and node_modules/ ignored — so the README
// that is written back to its committed text loses its M through `git hash-object`, not a kept copy.
// `tree-changes-no-git` launches over the same fixture with git out of reach, and marks all the same.

export const TOKEN = "5d1c";
export const README_TEXT = `# Repo ${TOKEN}\n\nThe committed text.\n`;
export const OLD_TEXT = ["# Old", "", `One ${TOKEN}.`, `Two ${TOKEN}.`, `Three ${TOKEN}.`].join("\n") + "\n";

/** Where Download writes a deleted file's text: outside the run's data folder, which a copy may never go into. */
let out: string | undefined;

export function setup(dataDir: string): Record<string, string> {
  out = mkdtempSync(join(tmpdir(), "kinas-e2e-out-"));
  return { ...fixture(dataDir), KINAS_E2E_EXPORT_TO: join(out, `rescued old-${TOKEN}.md`) };
}

export function teardown(): void {
  if (out) rmSync(out, { recursive: true, force: true });
  out = undefined;
}

/** The projects root and its two folders; the other tree-changes launches reuse it. */
export function fixture(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  const repo = join(root, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(join(repo, "notes"), { recursive: true });
  mkdirSync(join(repo, "node_modules"), { recursive: true });
  writeFileSync(join(repo, `README-${TOKEN}.md`), README_TEXT);
  writeFileSync(join(repo, "docs", `old-${TOKEN}.md`), OLD_TEXT);
  writeFileSync(join(repo, "notes", `n-${TOKEN}.md`), `# Notes ${TOKEN}\n`);
  writeFileSync(join(repo, "node_modules", `x-${TOKEN}.md`), `# Hidden ${TOKEN}\n`);
  writeFileSync(join(repo, ".gitignore"), "notes/\nnode_modules/\n");
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "the fixture");

  const plain = join(root, "plain");
  mkdirSync(join(plain, "docs"), { recursive: true });
  writeFileSync(join(plain, `README-${TOKEN}.md`), `# Plain ${TOKEN}\n\nA folder that is not a repository.\n`);
  writeFileSync(join(plain, "docs", `overview-${TOKEN}.md`), `# Overview ${TOKEN}\n`);
  // Over the reader's 4 MB when its tree is first shown, so Kinas keeps no copy of it (build spec AC-5).
  writeFileSync(join(plain, `big-${TOKEN}.md`), `# Big ${TOKEN}\n\n${"A line of a long file.\n".repeat(200_000)}`);
  return { KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}

/** No global hook, signing or editor gets in the way of the fixture's one commit. */
function git(cwd: string, ...args: string[]) {
  const config = ["-c", "user.name=Kinas e2e", "-c", "user.email=e2e@kinas.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main"];
  const result = spawnSync("git", [...config, ...args], { cwd, encoding: "utf8", timeout: 20000 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in the fixture: ${result.stderr}`);
}
