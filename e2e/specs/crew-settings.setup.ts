import { join } from "node:path";
import { makeStubTools } from "../stub-tools/make.ts";

// Settings → Crew and the Crew page before the first launch (build spec AC-1's app half, §4 Settings): every tool as a
// stub, and no Firstmate home yet — the spec installs the fake one part-way, as `kinas crew setup` would.

export function setup(dataDir: string): Record<string, string> {
  return { KINAS_E2E_TOOL_DIR: makeStubTools(join(dataDir, "tools")) };
}
