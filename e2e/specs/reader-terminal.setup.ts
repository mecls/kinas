import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stopHerdrSession } from "../helpers.ts";

// Folders in the sidebar and Open in the terminal (2026-09-21), against a throwaway Herdr session, never `default`
// (build spec invariant 20), with onboarding off so the pane attaches straight away.
//
// The projects root is made here, with names found nowhere else — so "this name is not in the log" means something —
// and with no README at the top, so opening the root itself opens no file.

export const SESSION = "kinas-e2e-terminal";

export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession(SESSION);
  const root = join(dataDir, "root");
  mkdirSync(join(root, "proj-alpha-9c2e", "notes"), { recursive: true });
  mkdirSync(join(root, "proj-beta-9c2e"), { recursive: true });
  writeFileSync(join(root, "proj-alpha-9c2e", "README.md"), "# Alpha\n\nThe folder that gets pinned and opened in the terminal.\n");
  writeFileSync(join(root, "proj-alpha-9c2e", "notes", "inner.md"), "# Inner\n");
  writeFileSync(join(root, "proj-beta-9c2e", "file.md"), "# Beta\n\nThe folder that is deleted from under its row.\n");
  writeFileSync(join(root, "loose-9c2e.md"), "# Loose\n\nA file at the top of the projects folder.\n");
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  return { KINAS_PANE_SHELL_ONLY: "0", KINAS_HERDR_SESSION: SESSION, KINAS_E2E_HERDR_CONFIG_PATH: config, KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}

export function teardown(): void {
  stopHerdrSession(SESSION);
}
