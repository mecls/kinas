import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The palette's file search (tasks/interface-polish, slice 1): the run's projects folder holds a README.md, the one file
// the tracer bullet's search answers with. Its text carries the fixtures' tag, `9c2e`, so a privacy case can look for
// it in the log and know any hit came from here.

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "# The projects folder 9c2e\n\nFound by name from the palette.\n");
  return {};
}
