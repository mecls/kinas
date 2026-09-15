import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stopHerdrSession } from "../helpers.ts";

// Open in editor (tasks/kinas-open-build-spec.md AC-7) against a throwaway Herdr session, never `default` (build spec
// invariant 20), with onboarding off so the pane attaches straight away. The projects root holds one file.
export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession("kinas-e2e-editor");
  const root = join(dataDir, "root");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "other.md"), readFileSync(join(import.meta.dir, "../../fixtures/reader/other.md"), "utf8"));
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, "onboarding = false\n");
  return { KINAS_PANE_SHELL_ONLY: "0", KINAS_HERDR_SESSION: "kinas-e2e-editor", KINAS_E2E_HERDR_CONFIG_PATH: config, KINAS_ROOT: root };
}
