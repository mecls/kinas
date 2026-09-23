import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setup as usageSetup } from "./usage.setup.ts";

export { teardown } from "./usage.setup.ts";

// AC-3 (build-spec §14): Home on the Usage page's fixtures, with Claude's session at 97 % — the one danger row Needs
// attention must hold — and a projects root holding two repositories, so Overnight lists two folders by name.

export function setup(dataDir: string): Record<string, string> {
  const env = usageSetup(dataDir);

  const handoff = join(dataDir, "inbox", "claude-rate-limits.json");
  const reading = JSON.parse(readFileSync(handoff, "utf8")) as { rate_limits: { five_hour: { used_percentage: number } } };
  reading.rate_limits.five_hour.used_percentage = 97;
  writeFileSync(handoff, JSON.stringify(reading));

  const root = join(dataDir, "root");
  for (const repo of ["acme", "globex"]) {
    mkdirSync(join(root, repo), { recursive: true });
    writeFileSync(join(root, repo, ".git"), "gitdir: /elsewhere\n");
  }
  return { ...env, KINAS_ROOT: root };
}
