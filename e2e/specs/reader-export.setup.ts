import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup as readerSetup, teardown as readerTeardown } from "./reader.setup.ts";

// Download and Print (tasks/three-column-shell-build-spec.md AC-7, AC-9, AC-10) against the reader spec's projects
// root. No agent can click a native sheet, so two debug-only seams stand in for them: the save sheet's answer is
// named here, and the print sheet is not raised at all. Every rule behind the save sheet still runs.
//
// The destination is its own temp folder, deliberately **outside** the run's data folder: a copy into Kinas' own
// data is refused (§6.5), which is the right answer and the wrong test.

let out: string | undefined;

export function setup(dataDir: string): Record<string, string> {
  out = mkdtempSync(join(tmpdir(), "kinas-e2e-out-"));
  return { ...readerSetup(dataDir), KINAS_E2E_EXPORT_TO: join(out, "plan copy.md"), KINAS_E2E_OUT: out, KINAS_E2E_NO_PRINT: "1" };
}

export function teardown(): void {
  readerTeardown();
  if (out) rmSync(out, { recursive: true, force: true });
  out = undefined;
}
