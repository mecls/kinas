import { cpSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The reader's projects root (tasks/prd-kinas-open.md): fixtures/reader copied into the run's data folder, a file outside
// it, and a symlink out of it. External links are logged, not opened, so no browser appears on Miguel's screen.
export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  cpSync(join(import.meta.dir, "../../fixtures/reader"), root, { recursive: true });
  mkdirSync(join(dataDir, "outside"), { recursive: true });
  writeFileSync(join(dataDir, "outside", "x.md"), "# Outside the root\n\nThis file is outside the projects root.\n");
  symlinkSync(join(dataDir, "outside", "x.md"), join(root, "link-out.md"));
  return { KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1" };
}
