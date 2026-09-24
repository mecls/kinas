import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The fake Firstmate home the crew specs run against (build spec §11.1, §13): Kinas's own clone lives at
// `<data dir>/firstmate`, so the fake does too. Its scripts are stubs from ./bin that log their call to
// state/calls.log; its snapshot is whichever fixture the spec puts in fixtures/snapshot.json. It is a git repository at
// a fixed commit, as a real clone at the pin is. Nothing here is Firstmate's code, and no spec runs Firstmate.

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "fixtures");

/** Builds the fake home under `dataDir` with `snapshot` (a file in fixtures/) as its fleet. Returns the home. */
export function makeFakeHome(dataDir: string, snapshot: string): string {
  const home = join(dataDir, "firstmate");
  cpSync(join(here, "bin"), join(home, "bin"), { recursive: true });
  for (const dir of ["data", "state", "config", "fixtures", "projects"]) mkdirSync(join(home, dir), { recursive: true });
  for (const script of ["fm-fleet-snapshot.sh", "fm-project-mode.sh", "fm-afk-contract.sh"]) chmodSync(join(home, "bin", script), 0o755);
  writeFileSync(join(home, "config", "backend"), "herdr\n");
  writeFileSync(join(home, "data", "backlog.md"), "# Backlog\n\n## In flight\n\n## Queued\n\n## Done\n");
  setSnapshot(home, snapshot);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", home, "-c", "user.name=Kinas e2e", "-c", "user.email=e2e@kinas.invalid", "-c", "commit.gpgsign=false", ...args], {
      stdio: "ignore",
      env: { ...process.env, GIT_AUTHOR_DATE: "2026-09-22T00:00:00Z", GIT_COMMITTER_DATE: "2026-09-22T00:00:00Z" },
    });
  git("init", "-q", "-b", "main");
  git("add", "bin", "config");
  git("commit", "-q", "-m", "the fake Firstmate at its pin");
  return home;
}

/**
 * Puts `snapshot` (a file in fixtures/) where the stub prints it from, with `__FM_HOME__` made the home — written to a
 * temporary file and renamed, so the stub never reads half a file — and the exit code the stub should return.
 */
export function setSnapshot(home: string, snapshot: string, exit = 0): void {
  const text = readFileSync(join(fixtures, snapshot), "utf8").replaceAll("__FM_HOME__", home);
  const target = join(home, "fixtures", "snapshot.json");
  writeFileSync(`${target}.tmp`, text);
  renameSync(`${target}.tmp`, target);
  writeFileSync(join(home, "fixtures", "snapshot-exit"), `${exit}\n`);
}
