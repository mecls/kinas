import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@kinas/context";
import { companionPath, companionPaths, nodeDir } from "./paths.ts";

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

test("kinas context on the Linux machine reads the companion's own folders (slice 5.3)", () => {
  const none = { KINAS_CONFIG: join(tmpdir(), `kinas-none-${process.pid}.json`) };
  const paths = companionPaths(none);
  const config = loadConfig(none, "linux");
  expect([config.roots, config.firstmateHome, config.dataDir]).toEqual([paths.projectRoots, paths.home, paths.state]);
  expect([paths.projectsNamed, paths.projectsProblem]).toEqual([false, null]);
});

test("the projects folders the captain names are the companion's and kinas context's alike, and never ~/projects (slice 5.3)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kinas-roots-"));
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify({ roots: ["~/miraside", "~/personal"] }));
  const paths = companionPaths({ KINAS_CONFIG: file });
  const config = loadConfig({ KINAS_CONFIG: file }, "linux");
  expect(paths.projectRoots).toEqual([join(homedir(), "miraside"), join(homedir(), "personal")]);
  expect(config.roots).toEqual(paths.projectRoots);
  expect([paths.projectsNamed, paths.projectsProblem]).toEqual([true, null]);
});
