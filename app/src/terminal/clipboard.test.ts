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
