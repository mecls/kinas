import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isKinasCopy, readWritten, recordWritten, sha256Of, WRITTEN_FILE } from "./written.ts";

// The record of what Kinas wrote on the machine (the captain, 2026-11-25; build spec §17): the only test of "Kinas's copy".

function place() {
  const root = mkdtempSync(join(tmpdir(), "kinas-written-"));
  const paths = { state: join(root, "state") };
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  return { root, paths, bin };
}

describe("isKinasCopy", () => {
  test("a file the record does not name is not Kinas's, whatever its bytes", async () => {
    const { paths, bin } = place();
    writeFileSync(join(bin, "herdr"), "the pinned release, byte for byte");
    expect(await isKinasCopy(paths, join(bin, "herdr"))).toBe(false);
  });

  test("a file Kinas recorded, still with the bytes it wrote, is Kinas's", async () => {
    const { paths, bin } = place();
    const file = join(bin, "herdr");
    writeFileSync(file, "kinas wrote this");
    recordWritten(paths, file, { item: "herdr", version: "0.9.5", sha256: (await sha256Of(file))!, at: 1 }, 1);
    expect(await isKinasCopy(paths, file)).toBe(true);
  });

  test("a file Kinas wrote that has since changed is not Kinas's any more", async () => {
    const { paths, bin } = place();
    const file = join(bin, "herdr");
    writeFileSync(file, "kinas wrote this");
    recordWritten(paths, file, { item: "herdr", version: "0.9.5", sha256: (await sha256Of(file))!, at: 1 }, 1);
    writeFileSync(file, "the captain's own build");
    expect(await isKinasCopy(paths, file)).toBe(false);
  });

  test("a recorded path whose file is gone is not Kinas's", async () => {
    const { paths, bin } = place();
    recordWritten(paths, join(bin, "gone"), { item: "herdr", version: "0.9.5", sha256: "a".repeat(64), at: 1 }, 1);
    expect(await isKinasCopy(paths, join(bin, "gone"))).toBe(false);
  });
});

describe("the record", () => {
  test("is one JSON file in the state folder, mode 0600, keyed by path, with every entry kept", () => {
    const { paths, bin } = place();
    recordWritten(paths, join(bin, "herdr"), { item: "herdr", version: "0.9.5", sha256: "a".repeat(64), at: 10 }, 10);
    recordWritten(paths, join(bin, "treehouse"), { item: "treehouse", version: "2.3.0", sha256: "b".repeat(64), at: 20 }, 20);
    const file = join(paths.state, WRITTEN_FILE);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      v: 1,
      files: {
        [join(bin, "herdr")]: { item: "herdr", version: "0.9.5", sha256: "a".repeat(64), at: 10 },
        [join(bin, "treehouse")]: { item: "treehouse", version: "2.3.0", sha256: "b".repeat(64), at: 20 },
      },
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(paths.state)).toEqual([WRITTEN_FILE]);
  });

  test("a later write for the same path replaces that entry only", () => {
    const { paths, bin } = place();
    recordWritten(paths, join(bin, "herdr"), { item: "herdr", version: "0.9.5", sha256: "a".repeat(64), at: 10 }, 10);
    recordWritten(paths, join(bin, "herdr"), { item: "herdr", version: "0.9.6", sha256: "c".repeat(64), at: 30 }, 30);
    expect(readWritten(paths)).toEqual({ [join(bin, "herdr")]: { item: "herdr", version: "0.9.6", sha256: "c".repeat(64), at: 30 } });
  });

  test("a record that does not read as one owns nothing, and is kept beside the new one, never written over", async () => {
    const { paths, bin } = place();
    mkdirSync(paths.state, { recursive: true });
    const file = join(paths.state, WRITTEN_FILE);
    for (const bad of ["not json", "[]", '{"v":2,"files":{}}', '{"v":1,"files":{"/x":{"item":"herdr"}}}']) {
      writeFileSync(file, bad);
      expect(readWritten(paths)).toEqual({});
    }
    writeFileSync(join(bin, "herdr"), "x");
    writeFileSync(file, `{"v":1,"files":{"${join(bin, "herdr")}":{"item":"herdr","version":"0.9.5","sha256":"${(await sha256Of(join(bin, "herdr")))!}","at":1}}`); // cut short
    expect(await isKinasCopy(paths, join(bin, "herdr"))).toBe(false);
    const cut = readFileSync(file, "utf8");
    recordWritten(paths, join(bin, "treehouse"), { item: "treehouse", version: "2.3.0", sha256: "b".repeat(64), at: 7 }, 7);
    expect(readFileSync(join(paths.state, `${WRITTEN_FILE}.unreadable-7`), "utf8")).toBe(cut);
    expect(Object.keys(readWritten(paths))).toEqual([join(bin, "treehouse")]);
  });
});
