import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The reader's layout (tasks/reader-layout/prd.md §5, Part 1): fixtures/reader copied into the run's data folder, as
// reader-panel does, plus two tall documents written here. `long.md` has sixty sections of prose long enough to wrap
// at any width the reader takes, so a change of width moves every line below it; the place-keeping cases scroll it to
// its 40th heading, which no fixture in git has. `second.md` is another tall document, so the next file offers
// Contents too. External links are logged, not opened.

const prose = (n: number) =>
  `Paragraph ${n}, ` + "prose long enough to wrap onto several lines at every width the reader can take, so that a change of width moves the lines below it. ".repeat(4);

function tall(title: string, sections: number): string {
  const lines = [`# ${title}`, ""];
  for (let i = 1; i <= sections; i++) lines.push(`## Section ${i}`, "", prose(i), "", prose(i), "");
  return lines.join("\n");
}

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  cpSync(join(import.meta.dir, "../../fixtures/reader"), root, { recursive: true });
  writeFileSync(join(root, "long.md"), tall("A long plan", 60));
  writeFileSync(join(root, "second.md"), tall("A second plan", 12));
  return { KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}
