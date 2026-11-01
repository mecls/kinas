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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEnv } from "./env.ts";

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
  // The run's environment minus every variable that names a place the app or the CLI reads, plus the harness's own
  // empty places and config file (env.ts): no e2e run reads Miguel's config, history or live Herdr unless its setup
  // points it somewhere.
  const { env, folders, files } = specEnv(process.env, dataDir);
  for (const folder of folders) mkdirSync(folder, { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(path, text);

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
