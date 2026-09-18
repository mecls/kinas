import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SHARED } from "./reader-pins-a.setup.ts";

// The second launch of the pins pair (see reader-pins-a.setup.ts): the same data folder and projects root, exactly
// as `-a` left them. Nothing is wiped and nothing is written — that is the test.

export function setup(): Record<string, string> {
  const root = join(SHARED, "root");
  if (!existsSync(join(SHARED, "kinas.sqlite")) || !existsSync(root)) {
    throw new Error(`reader-pins-b is the second launch of a pair: run \`bun e2e/run.ts reader-pins\` so reader-pins-a fills ${SHARED} first`);
  }
  return { KINAS_DATA_DIR: SHARED, KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}

export function teardown(): void {
  rmSync(SHARED, { recursive: true, force: true });
}
