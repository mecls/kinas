import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

// The projects root, which `kinas open` and the app's reader both enforce (PRD R1). The Rust copy in
// app/src-tauri/src/paths.rs (`projects_root_from`) is tested against the same cases, so the two cannot drift.

const dir = mkdtempSync(join(tmpdir(), "kinas-config-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function withFile(name: string, contents: string | null): Record<string, string> {
  const path = join(dir, name);
  if (contents !== null) writeFileSync(path, contents);
  return { KINAS_CONFIG: path };
}

describe("the projects root", () => {
  test("KINAS_ROOT wins over the file", () => {
    expect(loadConfig({ ...withFile("env.json", '{"root":"/from/file"}'), KINAS_ROOT: "/from/env" }).root).toBe("/from/env");
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
