import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { makeFakeVps } from "../fake-vps/make.ts";
import { APP_LOG } from "../helpers.ts";
import { makeStubTools } from "../stub-tools/make.ts";

// Agents on a VPS (tasks/cloud-factory, build spec §12 slice 1.5; ADR 0024): the place set in Settings, the door
// through a stub ssh to a fake VPS, and the Crew board drawn from the companion's reading. No Herdr session and no
// Firstmate home on this side: with a VPS set, the crew is read there and nothing runs here.

export function setup(dataDir: string): Record<string, string> {
  const vps = makeFakeVps(dataDir);
  const tools = makeStubTools(join(dataDir, "tools"));
  return {
    KINAS_E2E_SSH: vps.ssh,
    KINAS_E2E_TOOL_DIR: tools,
    KINAS_E2E_LOG_FROM: String(existsSync(APP_LOG) ? statSync(APP_LOG).size : 0),
  };
}
