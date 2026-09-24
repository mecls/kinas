import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The reader's tabs (tasks/reader-layout/prd.md §5, Part 2): a projects root of its own in the run's data folder,
// holding sixteen small files and one that links to the fourth. Their names carry a tag, `9c2e`, found nowhere else
// in the repository, so the privacy case can look for it in the log and the store and know any hit came from here.
// `tab-01` is tall, with thirty headings, so a tab has somewhere to be scrolled to.

const TAG = "9c2e";
const name = (n: number) => `tab-${String(n).padStart(2, "0")}-${TAG}.md`;

function tall(title: string, sections: number): string {
  const lines = [`# ${title}`, ""];
  for (let i = 1; i <= sections; i++) lines.push(`## Part ${i}`, "", `Part ${i} of ${title}, long enough to take a few lines of the reader. `.repeat(6), "");
  return lines.join("\n");
}

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, name(1)), tall("Tab one", 30));
  for (let n = 2; n <= 16; n++) writeFileSync(join(root, name(n)), `# Tab ${n}\n\nA small file.\n`);
  writeFileSync(join(root, `linker-${TAG}.md`), `# Linker\n\nIt leads to [the fourth tab](${name(4)}).\n`);
  return { KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}
