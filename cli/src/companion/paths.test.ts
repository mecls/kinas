import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companionPath, nodeDir } from "./paths.ts";

// The companion's PATH (build spec §12 slice 2.0; §17 2026-11-24 #1): the home lab showed that neither a
// non-interactive ssh nor a Herdr server started outside a login shell has ~/.local/bin or Node on its PATH.

function fakeHome(withNode: string[]): string {
  const home = mkdtempSync(join(tmpdir(), "kinas-companion-path-"));
  for (const dir of withNode) {
    mkdirSync(join(home, dir), { recursive: true });
    writeFileSync(join(home, dir, "node"), "#!/bin/sh\n");
    chmodSync(join(home, dir, "node"), 0o755);
  }
  return home;
}

const runs = (p: string) => {
  try {
    return (statSync(p).mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

describe("the companion's PATH", () => {
  test("companion_path_order: ~/.local/bin, then Node's folder, then the system's — never the caller's", () => {
    const home = fakeHome([".local/share/fnm/aliases/default/bin"]);
    expect(companionPath(home, runs)).toBe(
      `${home}/.local/bin:${home}/.local/share/fnm/aliases/default/bin:/usr/local/bin:/usr/bin:/bin`,
    );
    expect(companionPath(home, runs)).not.toContain(process.env.PATH ?? "\u0000");
  });

  test("node_dir_first_that_exists: fnm's default alias before Volta; none leaves Node out", () => {
    expect(nodeDir(fakeHome([".volta/bin", ".local/share/fnm/aliases/default/bin"]), runs)).toEndWith(".local/share/fnm/aliases/default/bin");
    expect(nodeDir(fakeHome([".volta/bin"]), runs)).toEndWith(".volta/bin");
    const bare = fakeHome([]);
    expect(nodeDir(bare, runs)).toBeNull();
    expect(companionPath(bare, runs)).toBe(`${bare}/.local/bin:/usr/local/bin:/usr/bin:/bin`);
  });

  test("a node that cannot run does not count", () => {
    const home = fakeHome([]);
    mkdirSync(join(home, ".volta/bin"), { recursive: true });
    writeFileSync(join(home, ".volta/bin/node"), "");
    expect(nodeDir(home, runs)).toBeNull();
  });
});
