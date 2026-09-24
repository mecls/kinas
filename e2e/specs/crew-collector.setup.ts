import { join } from "node:path";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { makeStubTools } from "../stub-tools/make.ts";

// The crew's collector (build spec AC-3): a fake Firstmate home at `<data dir>/firstmate` whose fleet starts empty, and
// every tool present as a stub. No Herdr session and no `claude`: the collector needs only the snapshot script.

export function setup(dataDir: string): Record<string, string> {
  makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json");
  return { KINAS_E2E_TOOL_DIR: makeStubTools(join(dataDir, "tools")) };
}
