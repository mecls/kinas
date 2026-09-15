import { describe, expect, test } from "bun:test";
import { CLIPBOARD_MAX_BYTES } from "./clipboard.ts";
import { parseOsc52 } from "./osc52.ts";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const write = (text: string) => ({ kind: "write", text });
const IGNORE = { kind: "ignore" };

describe("OSC 52 writes reach the clipboard", () => {
  test("c; with base64 UTF-8 writes the text, accents and symbols intact", () => {
    expect(parseOsc52(`c;${b64("ção ✓")}`)).toEqual(write("ção ✓"));
  });
  test("an empty target list writes", () => {
    expect(parseOsc52(";aGk=")).toEqual(write("hi"));
  });
  test("every target writes the one macOS clipboard", () => {
    for (const targets of ["p", "q", "s", "0", "7", "cp"]) expect(parseOsc52(`${targets};aGk=`)).toEqual(write("hi"));
  });
  test("padding is optional", () => {
    expect(parseOsc52("c;aGk")).toEqual(write("hi"));
    expect(parseOsc52("c;aA")).toEqual(write("h"));
  });
  test("exactly the limit is written", () => {
    const text = "a".repeat(CLIPBOARD_MAX_BYTES);
    expect(parseOsc52(`c;${b64(text)}`)).toEqual(write(text));
  });
});

describe("everything else is ignored", () => {
  test("a query never reads the clipboard", () => {
    expect(parseOsc52("c;?")).toEqual(IGNORE);
  });
  test("an empty payload never wipes the clipboard", () => {
    expect(parseOsc52("c;")).toEqual(IGNORE);
  });
  test("invalid base64", () => {
    for (const payload of ["!!!", "a", "aG=k", "a==="]) expect(parseOsc52(`c;${payload}`)).toEqual(IGNORE);
  });
  test("bytes that are not UTF-8", () => {
    expect(parseOsc52("c;/w==")).toEqual(IGNORE);
  });
  test("no separator, or an unknown target", () => {
    expect(parseOsc52("aGk=")).toEqual(IGNORE);
    expect(parseOsc52("x;aGk=")).toEqual(IGNORE);
  });
  test("one byte over the limit", () => {
    expect(parseOsc52(`c;${b64("a".repeat(CLIPBOARD_MAX_BYTES + 1))}`)).toEqual(IGNORE);
  });
});
