import { describe, expect, test } from "bun:test";
import { validate } from "./validate.ts";

describe("the companion's request validator (ADR 0024)", () => {
  test("accepts each verb in its exact shape", () => {
    expect(validate({ verb: "hello" })).toEqual({ verb: "hello" });
    expect(validate({ verb: "refresh" })).toEqual({ verb: "refresh" });
    expect(validate({ verb: "bundle", cursor: null })).toEqual({ verb: "bundle", cursor: null });
    expect(validate({ verb: "bundle" })).toEqual({ verb: "bundle", cursor: null });
    expect(validate({ verb: "bundle", cursor: { epoch: "e1", offset: 42, events: 7 } })).toEqual({ verb: "bundle", cursor: { epoch: "e1", offset: 42, events: 7 } });

    // Slice 3: the Herdr actions.
    expect(validate({ verb: "view" })).toEqual({ verb: "view" });
    expect(validate({ verb: "launch-first-mate" })).toEqual({ verb: "launch-first-mate" });
    expect(validate({ verb: "focus", workspace: "w3" })).toEqual({ verb: "focus", workspace: "w3" });
    expect(validate({ verb: "open-workspace", folder: "kinas/docs", label: "kinas/docs" })).toEqual({ verb: "open-workspace", folder: "kinas/docs", label: "kinas/docs" });
    expect(validate({ verb: "open-workspace", folder: "", label: "projects" })).toEqual({ verb: "open-workspace", folder: "", label: "projects" });
  });

  test("an action carries nothing it could run: a workspace id, a folder under the projects folder, a short label", () => {
    expect(validate({ verb: "launch-first-mate", command: "rm -rf ~" })).toEqual({ refused: 'unknown field "command"' });
    for (const workspace of ["", "w 3", "w3; ls", "../w3", "x".repeat(65), 3, null]) {
      expect(validate({ verb: "focus", workspace })).toEqual({ refused: "workspace is not a Herdr workspace id" });
    }
    for (const folder of ["/etc", "../x", "a/../../b", "a//b", "a/./b", "a/", ".", "a\nb", "a\u0000b", "x".repeat(1025), 1]) {
      expect(validate({ verb: "open-workspace", folder, label: "x" })).toEqual({ refused: "folder is not a folder under the projects folder" });
    }
    for (const label of ["", "a\u001bb", "é".repeat(81), 7]) {
      expect(validate({ verb: "open-workspace", folder: "a", label })).toEqual({ refused: "label is not a workspace label" });
    }
    expect("refused" in validate({ verb: "open-workspace", folder: "a", label: "é".repeat(80) })).toBe(false);
  });

  test("refuses everything else, and says why without echoing a long value", () => {
    for (const bad of [null, [], "hello", 1, { verb: "run" }, { verb: "hello", extra: 1 }, { verb: "bundle", cursor: "x" }]) {
      expect("refused" in validate(bad)).toBe(true);
    }
    expect(validate({ verb: "bundle", cursor: { epoch: "e", offset: -1, events: 0 } })).toEqual({ refused: "cursor.offset and cursor.events are counts" });
    expect(validate({ verb: "bundle", cursor: { epoch: "e", offset: 1.5, events: 0 } })).toEqual({ refused: "cursor.offset and cursor.events are counts" });
    expect(validate({ verb: "bundle", cursor: { epoch: "x".repeat(257), offset: 0, events: 0 } })).toEqual({ refused: "cursor.epoch is not a short string" });
    expect(validate({ verb: "bundle", cursor: { epoch: "e", offset: 0, events: 0, path: "/home" } })).toEqual({ refused: 'unknown field "path"' });
    const long = validate({ verb: "hello", ["k".repeat(500)]: 1 }) as { refused: string };
    expect(long.refused.length).toBeLessThan(80);
  });

  test("install (slice 4): one item; clone names a folder and a repo; adopt is for Herdr's service only", () => {
    expect(validate({ verb: "install", item: "herdr" })).toEqual({ verb: "install", item: "herdr" });
    expect(validate({ verb: "install", item: "herdr-service", adopt: true })).toEqual({ verb: "install", item: "herdr-service", adopt: true });
    expect(validate({ verb: "install", item: "clone", folder: "shop", repo: "acme/shop" })).toEqual({ verb: "install", item: "clone", folder: "shop", repo: "acme/shop" });
    expect(validate({ verb: "install", item: "sudo" })).toEqual({ refused: "item is not one Kinas installs" });
    expect(validate({ verb: "install", item: "herdr", adopt: true })).toEqual({ refused: "adopt is for Herdr's service only" });
    expect(validate({ verb: "install", item: "herdr-service", adopt: "yes" })).toEqual({ refused: "adopt is for Herdr's service only" });
    expect(validate({ verb: "install", item: "herdr", folder: "x" })).toEqual({ refused: "folder and repo are for clone only" });
    expect(validate({ verb: "install", item: "clone", folder: "../etc", repo: "acme/shop" })).toEqual({ refused: "folder is not a folder name" });
    expect(validate({ verb: "install", item: "clone", folder: "..", repo: "acme/shop" })).toEqual({ refused: "folder is not a folder name" });
    expect(validate({ verb: "install", item: "clone", folder: "shop", repo: "acme/shop; rm -rf ~" })).toEqual({ refused: "repo is not a GitHub owner/repo" });
    expect(validate({ verb: "install", item: "clone", folder: "shop", repo: "https://github.com/acme/shop" })).toEqual({ refused: "repo is not a GitHub owner/repo" });
    expect(validate({ verb: "install", item: "clone", folder: "shop" })).toEqual({ refused: "repo is not a GitHub owner/repo" });
    expect(validate({ verb: "install", item: "herdr", url: "https://x" })).toEqual({ refused: 'unknown field "url"' });
  });

  test("answer (slice 6): a task id, a decision key, the words, Kinas's request id, from the Mac", () => {
    const ok = { verb: "answer" as const, task: "t1-9c2e", key: "api-shape.v2_9c2e", words: "On t1-9c2e (api-shape.v2_9c2e): REST\nand JSON", request_id: "mac-01JX:2", from: "mac" as const };
    expect(validate(ok)).toEqual(ok);
    expect(validate({ ...ok, words: "é".repeat(4_096) })).toMatchObject({ verb: "answer" });
    expect(validate({ ...ok, extra: 1 })).toEqual({ refused: 'unknown field "extra"' });
    for (const task of ["", "-t", "t 1", "t/1", "x".repeat(65), 1]) expect(validate({ ...ok, task })).toEqual({ refused: "task is not a task id" });
    for (const key of ["", "a b", "a/b", "a]b", "x".repeat(129), null]) expect(validate({ ...ok, key })).toEqual({ refused: "key is not a decision key" });
    for (const words of ["", "  \n", "a\u0000b", "x".repeat(8_193), "é".repeat(4_097), 7]) {
      expect(validate({ ...ok, words })).toEqual({ refused: "words are empty, hold a NUL, or are over 8,192 bytes" });
    }
    for (const request_id of ["", ".x", "a/b", "a b", "x".repeat(97), 3]) expect(validate({ ...ok, request_id })).toEqual({ refused: "request_id is not a request id" });
    // A phone's answer comes through the cloud store (slice 10), never through the Mac's door.
    for (const from of ["phone", undefined, "MAC"]) expect(validate({ ...ok, from })).toEqual({ refused: "from is not mac" });
  });

  test("the pairing verbs: pair-start and phones take nothing, unpair one phone's id", () => {
    expect(validate({ verb: "pair-start" })).toEqual({ verb: "pair-start" });
    expect(validate({ verb: "phones" })).toEqual({ verb: "phones" });
    expect(validate({ verb: "test-notification" })).toEqual({ verb: "test-notification" });
    expect(validate({ verb: "test-notification", id: "x" })).toHaveProperty("refused");
    expect(validate({ verb: "unpair", id: "k5788xyz_-" })).toEqual({ verb: "unpair", id: "k5788xyz_-" });
    for (const bad of [{ verb: "pair-start", code: "x" }, { verb: "phones", id: "a" }, { verb: "unpair" }, { verb: "unpair", id: "" }, { verb: "unpair", id: "a b" }, { verb: "unpair", id: "a".repeat(65) }, { verb: "unpair", id: 5 }, { verb: "unpair", id: "a", extra: 1 }]) {
      expect(validate(bad), JSON.stringify(bad)).toHaveProperty("refused");
    }
  });
});
