#!/usr/bin/env bun
// Builds the debug app (with the embedded WebDriver and test hooks), then runs each spec against a
// fresh KINAS_DATA_DIR. A spec may ship `<name>.setup.ts` exporting `setup(dataDir)`, which prepares
// fixtures and returns extra environment variables for the app, and optionally `teardown()`. WebdriverIO
// runs as an async child process, so a setup can keep a stub server answering while the spec runs.
//
//   bun e2e/run.ts            build, then every spec
//   bun e2e/run.ts shell      only specs whose file name contains "shell"
//   KINAS_E2E_SKIP_BUILD=1    reuse the last debug build

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface SpecSetup {
  setup?: (dataDir: string) => Promise<Record<string, string>> | Record<string, string>;
  teardown?: () => Promise<void> | void;
}

const root = join(import.meta.dir, "..");
const specsDir = join(root, "e2e/specs");
const filters = process.argv.slice(2);
const specs = readdirSync(specsDir)
  .filter((f) => f.endsWith(".e2e.ts"))
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
  .sort();

if (!process.env.KINAS_E2E_SKIP_BUILD) {
  const build = spawnSync("bun", ["run", "tauri", "build", "--debug", "--no-bundle", "--features", "e2e"], {
    cwd: join(root, "app"),
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

function run(command: string, args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const failed: string[] = [];
for (const spec of specs) {
  const dataDir = mkdtempSync(join(tmpdir(), "kinas-e2e-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // A test app launched from inside a Herdr pane must not inherit that pane's identity.
    if (value !== undefined && !key.toUpperCase().includes("HERDR")) env[key] = value;
  }
  env.KINAS_DATA_DIR = dataDir;
  // No spec attaches Herdr's `default` session (build spec invariant 20): a plain shell unless the
  // spec's setup asks for a throwaway session explicitly.
  env.KINAS_PANE_SHELL_ONLY = "1";
  // Readers see empty transcript roots, an unreachable Ollama and an in-memory Keychain unless the spec's
  // setup says otherwise: no e2e run reads Miguel's history, calls ollama.com or touches his Keychain.
  for (const sub of ["claude", "pi"]) mkdirSync(join(dataDir, "empty", sub), { recursive: true });
  env.KINAS_CLAUDE_PROJECTS_DIR = join(dataDir, "empty", "claude");
  env.KINAS_PI_SESSIONS_DIR = join(dataDir, "empty", "pi");
  env.KINAS_OLLAMA_BASE_URL = "http://127.0.0.1:9";
  // Unreachable by default, so no spec but the one that sets up a stub can reach a real Convex deployment.
  env.KINAS_CONVEX_BASE_URL = "http://127.0.0.1:9";
  // Same for Hostinger, and it matters more here: that token can restart or recreate a real machine.
  env.KINAS_HOSTINGER_BASE_URL = "http://127.0.0.1:9";
  env.KINAS_E2E_MEMORY_KEYCHAIN = "1";
  // Test launches never register the real global hotkey or a login item.
  env.KINAS_E2E_NO_SYSTEM_HOOKS = "1";
  // The sidebar lists the repositories under the projects root (projects.rs) on every launch, so a spec that sets
  // no root of its own gets an empty one here rather than Miguel's real folder.
  mkdirSync(join(dataDir, "root"), { recursive: true });
  env.KINAS_ROOT = join(dataDir, "root");
  // The crew's tool health looks only in this (empty) folder and the system's own, never at the tools installed on this
  // Mac (login_path.rs); a crew spec's setup points it at its stub tools instead.
  mkdirSync(join(dataDir, "empty", "tools"), { recursive: true });
  env.KINAS_E2E_TOOL_DIR = join(dataDir, "empty", "tools");

  const setupFile = join(specsDir, spec.replace(/\.e2e\.ts$/, ".setup.ts"));
  const hooks: SpecSetup = existsSync(setupFile) ? ((await import(setupFile)) as SpecSetup) : {};
  if (hooks.setup) Object.assign(env, await hooks.setup(dataDir));

  console.log(`\n=== ${spec} (data: ${dataDir})`);
  let status = 1;
  try {
    status = await run(join(root, "node_modules/.bin/wdio"), ["run", join(root, "e2e/wdio.conf.ts"), "--spec", join(specsDir, spec)], env);
  } finally {
    await hooks.teardown?.();
  }
  if (status === 0) {
    rmSync(dataDir, { recursive: true, force: true });
  } else {
    failed.push(spec);
    console.log(`kept ${dataDir} for inspection`);
  }
}

if (failed.length) {
  console.log(`\nFAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nall ${specs.length} e2e spec(s) passed`);
