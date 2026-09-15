import { describe, expect, test } from "bun:test";
import { launchKey } from "./hold.ts";

describe("the launch screen's keys (keymap.md)", () => {
  test("Enter continues; q, Q and Ctrl+C quit", () => {
    expect(launchKey("\r")).toBe("enter");
    expect(launchKey("\n")).toBe("enter");
    expect(launchKey("q")).toBe("quit");
    expect(launchKey("Q")).toBe("quit");
    expect(launchKey("\x03")).toBe("quit");
  });

  test("Tab and everything else is ignored, escape sequences included", () => {
    for (const key of ["\t", "\x1b[Z", "\x1b[9;5u", "j", "k", " ", "\x1b", "\x1b[A", "\x1bOQ", "\x1b[1;5Q", "\x1bq", "\x04", "\x1a"]) {
      expect([JSON.stringify(key), launchKey(key)]).toEqual([JSON.stringify(key), null]);
    }
  });

  test("keys that arrive together: the escape sequence is skipped, the command after it still counts", () => {
    expect(launchKey("\x1b[A\x03")).toBe("quit");
    expect(launchKey("\x1b[1;5Q\r")).toBe("enter");
    expect(launchKey("\x1bOQq")).toBe("quit");
    expect(launchKey("\t\r")).toBe("enter");
    expect(launchKey("\tq")).toBe("quit");
    expect(launchKey("\x1bq\x1b[B")).toBeNull();
  });
});
