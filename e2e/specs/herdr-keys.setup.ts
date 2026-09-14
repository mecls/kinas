import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stopHerdrSession } from "../helpers.ts";

// A throwaway Herdr session (never `default`, build spec invariant 20) with the ⌃Tab bindings written the
// way Herdr 0.9.0 accepts them. Miguel's own config uses an ignored [keybindings] section (PRD §7 Q3).
// Runs before the app launches, so it is the place to clear a session left over from an earlier run.
export function setup(dataDir: string): Record<string, string> {
  stopHerdrSession("kinas-e2e");
  const config = join(dataDir, "herdr-e2e-config.toml");
  writeFileSync(config, 'onboarding = false\n\n[keys]\ncycle_pane_next = "ctrl+tab"\ncycle_pane_previous = "ctrl+shift+tab"\n');
  return { KINAS_PANE_SHELL_ONLY: "0", KINAS_HERDR_SESSION: "kinas-e2e", KINAS_E2E_HERDR_CONFIG_PATH: config };
}
