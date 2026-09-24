import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The window's title bar (tasks/reader-layout/prd.md §5, Part 3): a projects root of its own in the run's data folder,
// holding the three files ← and → walk through — A tall, so a place has a scroll position to come back to.

function tall(title: string, sections: number): string {
  const lines = [`# ${title}`, ""];
  for (let i = 1; i <= sections; i++) lines.push(`## Part ${i}`, "", `Part ${i} of ${title}, long enough to take a few lines of the reader. `.repeat(6), "");
  return lines.join("\n");
}

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "place-a.md"), tall("Place A", 30));
  writeFileSync(join(root, "place-b.md"), "# Place B\n\nA small file.\n");
  writeFileSync(join(root, "place-c.md"), "# Place C\n\nA small file.\n");
  return { KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}
