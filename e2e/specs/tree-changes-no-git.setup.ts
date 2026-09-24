import { fixture } from "./tree-changes.setup.ts";

// The tree-changes fixture again, `repo` still a git repository, but this launch cannot find git (a debug build reads
// KINAS_E2E_NO_GIT): every listed text file is copied instead, and the marks are the same.

export function setup(dataDir: string): Record<string, string> {
  return { ...fixture(dataDir), KINAS_E2E_NO_GIT: "1" };
}
