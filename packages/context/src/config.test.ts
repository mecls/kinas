import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { insideRoot, loadConfig } from "./config.ts";

// The projects root, which `kinas open` and the app's reader both enforce (PRD R1). The Rust copy in
// app/src-tauri/src/paths.rs (`projects_root_from`) is tested against the same cases, so the two cannot drift.

const dir = mkdtempSync(join(tmpdir(), "kinas-config-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// An empty data folder, so no store answers for Settings → Projects folder: without it these cases read the real
// app's store, and a root saved there (Miguel's, 2026-09-23) outranked every file under test.
const noStore = join(dir, "no-store");

function withFile(name: string, contents: string | null): Record<string, string> {
  const path = join(dir, name);
  if (contents !== null) writeFileSync(path, contents);
  return { KINAS_CONFIG: path, KINAS_DATA_DIR: noStore };
}

describe("the projects root", () => {
  test("KINAS_ROOT wins over the file", () => {
    expect(loadConfig({ ...withFile("env.json", '{"root":"/from/file"}'), KINAS_ROOT: "/from/env" }).root).toBe("/from/env");
  });
  test("KINAS_ROOT is trimmed, and a blank one is no root at all, as the app reads it (paths.rs projects_root_with)", () => {
    // The app trims the variable and skips a blank one; the CLI took `" /from/env"` as a folder under the home and
    // `"  "` as `~/  `, so `kinas open` judged and searched another root than the reader it hands paths to.
    expect(loadConfig({ ...withFile("env-pad.json", '{"root":"/from/file"}'), KINAS_ROOT: " /from/env " }).root).toBe("/from/env");
    expect(loadConfig({ ...withFile("env-blank.json", '{"root":"/from/file"}'), KINAS_ROOT: "   " }).root).toBe("/from/file");
  });
  test("the file's root is used, with ~/ expanded", () => {
    expect(loadConfig(withFile("abs.json", '{"root":"/from/file"}')).root).toBe("/from/file");
    expect(loadConfig(withFile("tilde.json", '{"root":"~/x"}')).root).toBe(join(homedir(), "x"));
  });
  test("a relative root joins the home folder", () => {
    expect(loadConfig(withFile("rel.json", '{"root":"rel"}')).root).toBe(join(homedir(), "rel"));
  });
  test("a blank root, invalid JSON or no file fall back to the default", () => {
    const fallback = join(homedir(), "Documents/Projects/SintraLabs");
    expect(loadConfig(withFile("blank.json", '{"root":"   "}')).root).toBe(fallback);
    expect(loadConfig(withFile("bad.json", "{nope")).root).toBe(fallback);
    expect(loadConfig(withFile("absent.json", null)).root).toBe(fallback);
  });
});

describe("inside the projects root (`kinas context --cwd`)", () => {
  test("a root written with a trailing slash still holds its folders", () => {
    const config = loadConfig(withFile("slash.json", '{"root":"/from/file/"}'));
    expect(insideRoot(config, "/from/file/proj")).toBe(true);
    expect(insideRoot(config, "/from/file")).toBe(true);
    expect(insideRoot(config, "/from/file-old/proj")).toBe(false);
  });
  test("a root reached through a symlink holds a folder named by its real path, and the other way round", () => {
    const real = realpathSync.native(dir);
    mkdirSync(join(real, "projects/proj"), { recursive: true });
    symlinkSync(join(real, "projects"), join(real, "link"));
    const viaLink = loadConfig(withFile("link.json", JSON.stringify({ root: join(real, "link") })));
    expect(insideRoot(viaLink, join(real, "projects/proj"))).toBe(true);
    expect(insideRoot(viaLink, join(real, "link/proj"))).toBe(true);
    const viaReal = loadConfig(withFile("real.json", JSON.stringify({ root: join(real, "projects") })));
    expect(insideRoot(viaReal, join(real, "link/proj"))).toBe(true);
    expect(insideRoot(viaReal, join(real, "elsewhere"))).toBe(false);
  });
});

describe("Firstmate's home", () => {
  test("FM_HOME, then the file, then Kinas's own clone in the data folder (the first mate, 2026-09-25)", () => {
    expect(loadConfig(withFile("fm-none.json", null)).firstmateHome).toBe(join(noStore, "firstmate"));
    expect(loadConfig(withFile("fm-file.json", '{"firstmate_home":"/from/file"}')).firstmateHome).toBe("/from/file");
    expect(loadConfig({ ...withFile("fm-env.json", '{"firstmate_home":"/from/file"}'), FM_HOME: "/from/env" }).firstmateHome).toBe("/from/env");
  });
});

describe("on the Linux machine (the factory in the cloud, slice 5.3)", () => {
  test("the defaults are the companion's folders, and what is set still wins", () => {
    const env = { KINAS_CONFIG: join(dir, "linux-none.json") };
    const linux = loadConfig(env, "linux");
    expect([linux.root, linux.firstmateHome, linux.dataDir]).toEqual([
      join(homedir(), "projects"),
      join(homedir(), ".local/share/kinas/firstmate"),
      join(homedir(), ".local/state/kinas"),
    ]);
    const set = loadConfig({ ...env, KINAS_ROOT: "/srv/clients", FM_HOME: "/srv/fm", KINAS_DATA_DIR: noStore }, "linux");
    expect([set.root, set.firstmateHome, set.dataDir]).toEqual(["/srv/clients", "/srv/fm", noStore]);
    // On the Mac, unchanged.
    const mac = loadConfig({ ...env, KINAS_DATA_DIR: noStore }, "darwin");
    expect([mac.root, mac.firstmateHome]).toEqual([join(homedir(), "Documents/Projects/SintraLabs"), join(noStore, "firstmate")]);
  });
});
