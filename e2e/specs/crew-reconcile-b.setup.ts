import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SHARED } from "./crew-reconcile-a.setup.ts";

// The second launch of the reconcile pair (see crew-reconcile-a.setup.ts): the same data folder, exactly as `-a` left
// it. Nothing is wiped and nothing is written by this setup.

export function setup(): Record<string, string> {
  if (!existsSync(join(SHARED, "kinas.sqlite"))) {
    throw new Error(`crew-reconcile-b is the second launch of a pair: run \`bun e2e/run.ts crew-reconcile\` so crew-reconcile-a fills ${SHARED} first`);
  }
  return { KINAS_DATA_DIR: SHARED, KINAS_ROOT: join(SHARED, "root"), KINAS_E2E_TOOL_DIR: join(SHARED, "tools", "bin") };
}

export function teardown(): void {
  rmSync(SHARED, { recursive: true, force: true });
}
