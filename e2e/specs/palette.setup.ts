import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The palette's file search (tasks/interface-polish, slices 1 and 2): the run's projects folder holds a README.md, and
// meeting notes whose name is stored decomposed. Its text carries the fixtures' tag, `9c2e`, so a privacy case can look for
// it in the log and know any hit came from here.

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "# The projects folder 9c2e\n\nFound by name from the palette.\n");
  // Slice 2: a name stored decomposed, as some Mac tools store it — "Reunião de março", its accents combining marks.
  mkdirSync(join(root, "atas"), { recursive: true });
  writeFileSync(join(root, "atas", "Reunião de março.md"), "# Meeting notes 9c2e\n");
  return {};
}
