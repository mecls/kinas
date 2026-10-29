import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";

// The clipboard command, as the webview sees it: it records each call and resolves, or rejects when told to.
const calls: { command: string; args: unknown }[] = [];
let refuse = false;
mock.module("@tauri-apps/api/core", () => ({
  ...tauriCore,
  invoke: (command: string, args: unknown) => {
    calls.push({ command, args });
    return refuse ? Promise.reject(new Error("the pasteboard refused the text")) : Promise.resolve(undefined);
  },
}));

const { CLIPBOARD_MAX_BYTES, writeClipboard } = await import("./clipboard.ts");

beforeEach(() => {
  calls.length = 0;
  refuse = false;
});

describe("writeClipboard says whether the text reached the clipboard", () => {
  test("text the command accepts resolves true", async () => {
    expect(await writeClipboard("wrold")).toBe(true);
    expect(calls).toEqual([{ command: "clipboard_write_text", args: { text: "wrold" } }]);
  });

  test("a refusal resolves false and never rejects", async () => {
    refuse = true;
    expect(await writeClipboard("wrold")).toBe(false);
  });

  test("empty text resolves false without calling the command", async () => {
    expect(await writeClipboard("")).toBe(false);
    expect(calls).toEqual([]);
  });

  test("text over the limit resolves false without calling the command", async () => {
    expect(await writeClipboard("a".repeat(CLIPBOARD_MAX_BYTES + 1))).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("one clipboard door (selection and clipboard, 2026-09-15)", () => {
  test("nothing under app/src writes the clipboard but writeClipboard: no navigator.clipboard outside this module", () => {
    const { readdirSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
    const { join, relative } = require("node:path") as typeof import("node:path");
    const src = join(import.meta.dir, "..");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
      }
      return out;
    };
    const offenders = walk(src)
      .filter((p) => readFileSync(p, "utf8").includes("navigator.clipboard"))
      .map((p) => relative(src, p));
    expect(offenders).toEqual([]);
    // The guard is reading real code: it finds its own needle when one is planted.
    expect("void navigator.clipboard.writeText(line)".includes("navigator.clipboard")).toBe(true);
  });
});
