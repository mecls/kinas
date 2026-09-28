import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Crew marks (tasks/crew-marks/prd.md §5): the captain's clone of a client repository in the projects root, and the
// first mate's crew with its own clone of the same repository in a fake Firstmate home (`<data dir>/firstmate`) and a
// worker's worktree outside that home, as `treehouse` makes them. One bare remote stands behind a github.com URL
// (`insteadOf`), so both configs read the same GitHub `origin` and git pushes to the folder. No Firstmate script
// exists in the fake home, so the crew's collector stays asleep. Every name carries the token.

export const TOKEN = "7c3a";
export const BRANCH = `fm/task-${TOKEN}`;
const URL = `https://github.com/kinas-e2e/shop-${TOKEN}.git`;

/** The worker's worktree, from the projects root the spec is given. */
export const worktreeOf = (root: string) => join(dirname(root), "treehouse", `shop-${TOKEN}`, "1", "shop");

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  const remote = join(dataDir, `remote-${TOKEN}.git`);
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "-q", "--bare");
  const instead = `url.${remote}.insteadOf`;

  const captain = join(root, "shop");
  mkdirSync(join(captain, "docs"), { recursive: true });
  writeFileSync(join(captain, `README-${TOKEN}.md`), `# Shop ${TOKEN}\n\nWhat the remote holds.\n`);
  writeFileSync(join(captain, "docs", `plan-${TOKEN}.md`), `# Plan ${TOKEN}\n`);
  writeFileSync(join(captain, ".gitignore"), "notes/\n");
  git(captain, "init", "-q");
  git(captain, "add", "-A");
  git(captain, "commit", "-q", "-m", "the shop");
  git(captain, "remote", "add", "origin", URL);
  git(captain, "config", instead, URL);
  git(captain, "push", "-q", "-u", "origin", "main");

  const projects = join(dataDir, "firstmate", "projects");
  mkdirSync(projects, { recursive: true });
  git(projects, "-c", `${instead}=${URL}`, "clone", "-q", URL, "shop");
  const clone = join(projects, "shop");
  git(clone, "config", instead, URL);
  const worktree = worktreeOf(root);
  mkdirSync(dirname(worktree), { recursive: true });
  git(clone, "worktree", "add", "-q", worktree, "-b", BRANCH);
  git(worktree, "push", "-q", "-u", "origin", BRANCH);
  return { KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}

/** No global hook, signing or editor gets in the way of the fixture's commits, or the spec's. */
export function git(cwd: string, ...args: string[]) {
  const config = ["-c", "user.name=Kinas e2e", "-c", "user.email=e2e@kinas.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main"];
  const result = spawnSync("git", [...config, ...args], { cwd, encoding: "utf8", timeout: 20000 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in the fixture: ${result.stderr}`);
}
