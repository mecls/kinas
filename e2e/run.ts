#!/usr/bin/env bun
// Builds the debug app (with the embedded WebDriver and test hooks), then runs each spec against a
// fresh KINAS_DATA_DIR. A spec may ship `<name>.setup.ts` exporting `setup(dataDir)`, which prepares
// fixtures and returns extra environment variables for the app.
//
//   bun e2e/run.ts            build, then every spec
//   bun e2e/run.ts shell      only specs whose file name contains "shell"
//   KINAS_E2E_SKIP_BUILD=1    reuse the last debug build

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const failed: string[] = [];
for (const spec of specs) {
  const dataDir = mkdtempSync(join(tmpdir(), "kinas-e2e-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // A test app launched from inside a Herdr pane must not inherit that pane's identity.
    if (value !== undefined && !key.toUpperCase().includes("HERDR")) env[key] = value;
  }
  env.KINAS_DATA_DIR = dataDir;

  const setupFile = join(specsDir, spec.replace(/\.e2e\.ts$/, ".setup.ts"));
  if (existsSync(setupFile)) {
    const { setup } = (await import(setupFile)) as { setup: (dir: string) => Promise<Record<string, string>> | Record<string, string> };
    Object.assign(env, await setup(dataDir));
  }

  console.log(`\n=== ${spec} (data: ${dataDir})`);
  const run = spawnSync(join(root, "node_modules/.bin/wdio"), ["run", join(root, "e2e/wdio.conf.ts"), "--spec", join(specsDir, spec)], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (run.status === 0) {
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
