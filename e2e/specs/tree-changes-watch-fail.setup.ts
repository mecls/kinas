import { fixture } from "./tree-changes.setup.ts";

// The tree-changes fixture, in a launch whose every watch is refused (a debug build reads KINAS_E2E_WATCH_FAIL).

export function setup(dataDir: string): Record<string, string> {
  return { ...fixture(dataDir), KINAS_E2E_WATCH_FAIL: "1" };
}
