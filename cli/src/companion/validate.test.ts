import { describe, expect, test } from "bun:test";
import { validate } from "./validate.ts";

describe("the companion's request validator (ADR 0024)", () => {
  test("accepts each verb in its exact shape", () => {
    expect(validate({ verb: "hello" })).toEqual({ verb: "hello" });
    expect(validate({ verb: "refresh" })).toEqual({ verb: "refresh" });
    expect(validate({ verb: "bundle", cursor: null })).toEqual({ verb: "bundle", cursor: null });
    expect(validate({ verb: "bundle" })).toEqual({ verb: "bundle", cursor: null });
    expect(validate({ verb: "bundle", cursor: { epoch: "e1", offset: 42, events: 7 } })).toEqual({ verb: "bundle", cursor: { epoch: "e1", offset: 42, events: 7 } });
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
