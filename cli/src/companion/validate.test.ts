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
});
