import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStubTools } from "../stub-tools/make.ts";

// Reconciliation (build spec AC-9), in two launches over one data folder, as reader-pins-a/-b do: `-a` leaves a mirror
// with one task in flight whose endpoint Firstmate reports dead and whose worktree is gone, and one healthy; `-b`
// launches over it and reads the Reconcile group. They sort in that order: `bun e2e/run.ts crew-reconcile` runs the
// pair. No Herdr: the pane is a plain shell, and no line here needs a Herdr view.

export const SHARED = join(tmpdir(), "kinas-e2e-reconcile-shared");

export function setup(): Record<string, string> {
  rmSync(SHARED, { recursive: true, force: true });
  mkdirSync(join(SHARED, "root"), { recursive: true });
  makeFakeHome(SHARED, "crew-snapshot.empty.synthetic.json");
  return { KINAS_DATA_DIR: SHARED, KINAS_ROOT: join(SHARED, "root"), KINAS_E2E_TOOL_DIR: makeStubTools(join(SHARED, "tools")) };
}
