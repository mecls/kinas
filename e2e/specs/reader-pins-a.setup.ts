import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pinned and Recent (tasks/three-column-shell-build-spec.md AC-12, AC-13), in two launches.
//
// A pin's whole point is surviving a relaunch, and one spec is one launch. So `reader-pins-a` and `reader-pins-b`
// share a data folder: this setup wipes and fills it and hands it to the app in place of the runner's own
// (`Object.assign(env, setup())` lets a setup override KINAS_DATA_DIR); `-b` reuses it as it was left and removes it
// afterwards. They sort in that order, and `bun e2e/run.ts reader-pins` runs the pair. The projects root lives inside
// the shared folder, because a pin stores an absolute path and the second launch has to find the same one.

export const SHARED = join(tmpdir(), "kinas-e2e-pins-shared");

export function setup(): Record<string, string> {
  rmSync(SHARED, { recursive: true, force: true });
  mkdirSync(SHARED, { recursive: true });
  const root = join(SHARED, "root");
  cpSync(join(import.meta.dir, "../../fixtures/reader"), root, { recursive: true });
  // Names found nowhere else, so "this name is not in the log" means something.
  writeFileSync(join(root, "pin-me-7f3a.md"), "# Pin me\n\nA file that gets pinned from the reader's menu.\n");
  writeFileSync(join(root, "pinned-then-gone-7f3a.md"), "# Here today\n\nPinned, then deleted from disk.\n");
  return { KINAS_DATA_DIR: SHARED, KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}
