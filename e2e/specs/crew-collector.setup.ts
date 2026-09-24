import { makeFakeHome } from "../fake-firstmate/make.ts";

// The crew's collector (build spec AC-3): a fake Firstmate home at `<data dir>/firstmate` whose fleet starts empty. No
// Herdr session, no stub tools, no `claude`: the collector needs only the snapshot script.

export function setup(dataDir: string): Record<string, string> {
  makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json");
  return {};
}
