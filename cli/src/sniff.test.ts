import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cases from "../../fixtures/reader/sniff-cases.json";
import { SNIFF_BYTES, sniff, sniffFile } from "./sniff.ts";

// The same cases as the_sniff_matches_the_shared_cases in app/src-tauri/src/reader/access.rs, so the CLI and the
// app agree on what a text file is (R1, R6). The table stores bytes as hex because a NUL cannot be written as
// JSON text.

interface Case {
  name: string;
  hex: string;
  expected: "text" | "binary";
}

const bytesOf = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

const dir = mkdtempSync(join(tmpdir(), "kinas-sniff-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the shared cases", () => {
  test("every case agrees with the table", () => {
    expect((cases as Case[]).length).toBeGreaterThan(0);
    for (const c of cases as Case[]) {
      expect(c.hex.length % 2, `odd hex: ${c.name}`).toBe(0);
      expect(sniff(bytesOf(c.hex)), c.name).toBe(c.expected);
    }
  });
});

describe("reading a file's head", () => {
  test("a text file is text, and a file with a NUL is binary", () => {
    const sql = join(dir, "migration.sql");
    writeFileSync(sql, "create table leads (id uuid primary key);\n");
    expect(sniffFile(sql)).toBe("text");

    const bin = join(dir, "blob.bin");
    writeFileSync(bin, Buffer.from([0x68, 0x69, 0x00, 0x01]));
    expect(sniffFile(bin)).toBe("binary");
  });

  test("an empty file is text", () => {
    const empty = join(dir, "empty.txt");
    writeFileSync(empty, "");
    expect(sniffFile(empty)).toBe("text");
  });

  test("only the head decides: binary past the window does not make a file binary", () => {
    // A long text header followed by a NUL. The read stops at SNIFF_BYTES, so this opens — the whole-file UTF-8
    // check in read_text is what refuses it later, with a different message.
    const late = join(dir, "late.txt");
    writeFileSync(late, Buffer.concat([Buffer.from("a".repeat(SNIFF_BYTES)), Buffer.from([0x00])]));
    expect(sniffFile(late)).toBe("text");
  });

  test("a multi-byte character straddling the window edge is text, not corruption", () => {
    // The last byte of the window is the first byte of a two-byte character, so the decode of the window alone
    // fails; dropping the partial tail is what makes it pass.
    const straddle = join(dir, "straddle.txt");
    writeFileSync(straddle, Buffer.concat([Buffer.from("a".repeat(SNIFF_BYTES - 1)), Buffer.from("é")]));
    expect(sniffFile(straddle)).toBe("text");
  });
});
