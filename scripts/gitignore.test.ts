import { expect, test } from "bun:test";
import { join } from "node:path";

// The repository is public. Under tasks/ only the templates and, per feature, the status
// file, the PRD and the mockups are tracked; every other planning document stays on this
// Mac. This pins that split so an edit to .gitignore cannot leak a spec silently.
// git check-ignore judges paths that need not exist, so the table names files that may
// never be written.

const root = join(import.meta.dir, "..");

const tracked = [
  "tasks/_templates/build-spec.md",
  "tasks/_templates/mockup.html",
  "tasks/first-mate/status.md",
  "tasks/first-mate/prd.md",
  "tasks/first-mate/mockups/board.html",
  ".claude/skills/software-factory/SKILL.md",
  "docs/adr/0001-one-writer.md",
  "docs/external/keychain.md",
];

const ignored = [
  "tasks/first-mate/build-spec.md",
  "tasks/first-mate/architecture.md",
  "tasks/first-mate/handoff.md",
  "tasks/prd-crew.md",
  "tasks/three-column-shell-build-spec.md",
  "tasks/tasks-process.md",
  "tasks/plan-anything.md",
  "scripts/private-names",
  ".claude/worktrees/process/README.md",
];

function isIgnored(path: string): boolean {
  const run = Bun.spawnSync(["git", "check-ignore", "-q", "--", path], { cwd: root });
  // 0: ignored; 1: not ignored; anything else is git itself failing
  if (run.exitCode !== 0 && run.exitCode !== 1) {
    throw new Error(`git check-ignore failed for ${path}: ${run.stderr.toString()}`);
  }
  return run.exitCode === 0;
}

test.each(tracked)("%s is tracked", (path) => {
  expect(isIgnored(path)).toBe(false);
});

test.each(ignored)("%s stays on this Mac", (path) => {
  expect(isIgnored(path)).toBe(true);
});
