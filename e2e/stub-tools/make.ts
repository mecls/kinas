import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../../packages/commands/src/crew-tools.ts";

// Stub crew tools for the crew specs (build spec §9, §13): a folder the app is pointed at with KINAS_E2E_TOOL_DIR, so its
// tool health never sees the tools installed on this Mac. Each release tool answers `--version` (treehouse also
// `get --help` with --lease); each npm tool is a package.json its command links to — the app reads the version there
// and never runs one, which the stub would log to calls.log. gh answers `auth status` and `pr view`; herdr, claude and
// node exist.

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

export interface StubOptions {
  /** Tools to leave out. */
  missing?: string[];
  signedOut?: boolean;
}

function script(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

/** Builds the stub tools under `dir` and returns the folder to put on the crew's PATH. */
export function makeStubTools(dir: string, opts: StubOptions = {}): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(dir, "calls.log");
  for (const tool of TOOLS) {
    if (opts.missing?.includes(tool.name)) continue;
    if (tool.source === "npm") {
      const pkg = join(dir, "lib", "node_modules", tool.name);
      mkdirSync(join(pkg, "dist", "bin"), { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: tool.name, version: tool.version }));
      script(join(pkg, "dist", "bin", `${tool.name}.js`), `echo "${tool.name} $*" >> '${log}'\necho ${tool.version}`);
      symlinkSync(join(pkg, "dist", "bin", `${tool.name}.js`), join(bin, tool.name));
    } else {
      script(
        join(bin, tool.name),
        `echo "${tool.name} $*" >> '${log}'\nif [ "$1" = get ]; then echo "  --lease  hold the worktree"; else echo "${tool.name} version v${tool.version}"; fi`,
      );
    }
  }
  // `gh pr view <url> --json …` prints fixtures/crew-gh-<n>.json, n from the file `gh-pr` beside bin/ (setGhAnswer);
  // with no such file it fails, as gh does for a PR it cannot see. Anything else is `auth status`.
  const answer = join(dir, "gh-pr");
  script(
    join(bin, "gh"),
    `echo "gh $*" >> '${log}'\nif [ "$1" = pr ]; then n=$(cat '${answer}' 2>/dev/null) || exit 1; cat "${fixtures}/crew-gh-$n.json"; exit $?; fi\n${opts.signedOut ? "exit 1" : "exit 0"}`,
  );
  for (const name of ["node", "npm", "herdr", "claude"]) script(join(bin, name), `echo "${name} $*" >> '${log}'`);
  return bin;
}

/** Which of fixtures/crew-gh-<n>.json the stub `gh pr view` answers from now on. */
export function setGhAnswer(dir: string, n: number): void {
  writeFileSync(join(dir, "gh-pr"), `${n}\n`);
}

/** Takes one tool away, as uninstalling it would. */
export function removeStubTool(dir: string, name: string): void {
  rmSync(join(dir, "bin", name), { force: true });
}

/**
 * The first mate's stand-in for KINAS_E2E_CREW_COMMAND: a script named `claude` that appends its argument count and first
 * argument to argv.log beside it, clears the screen, and becomes `sleep` under the name `claude` — so Herdr's
 * process-info reports `argv0` `claude` and the launcher sees the first mate running (measured in a throwaway session,
 * 2026-09-24). No spec starts the real `claude`.
 */
export function makeStandIn(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "claude");
  writeFileSync(path, `#!/bin/bash\nprintf '%s\\n' "$#\${1:+ $1}" >> '${join(dir, "argv.log")}'\nprintf '\\033[2J\\033[H'\nexec -a claude sleep 3600\n`);
  chmodSync(path, 0o755);
  return path;
}
