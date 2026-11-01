import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRecordFiles, readLock, readRecord } from "./records.ts";

// Old decisions are never rewritten (AGENTS.md, docs/adr/): every record's `## Decision` section is
// held to the hash in decisions.lock. A new record is added with `bun docs/adr/lock.ts`; a changed
// decision is a new record that supersedes the old one, never an edit of it.

const files = listRecordFiles();
const records = files.map((f) => readRecord(f));
const lock = readLock();

test("records are numbered contiguously from 0001", () => {
  expect(files.length).toBeGreaterThan(0);
  const expected = records.map((_, i) => String(i + 1).padStart(4, "0"));
  expect(records.map((r) => r.number)).toEqual(expected);
});

test.each(records)("$file has the record's shape", (r) => {
  expect(r.title, `${r.file}: the title line is "# ${r.number} · <title>"`).not.toBeNull();
  expect(r.date, `${r.file}: a "Date: YYYY-MM-DD" line`).not.toBeNull();
  expect(r.headings).toEqual(["## Context", "## Decision", "## Consequences"]);
  expect(r.decision, `${r.file}: an empty decision decides nothing`).not.toBe("");
});

test.each(records)("$file's decision matches decisions.lock", (r) => {
  const locked = lock[r.number];
  expect(locked, `${r.file} is not in decisions.lock — add its hash to decisions.lock (bun docs/adr/lock.ts)`).toBeDefined();
  expect(r.hash, `${r.file}: a decision is never edited — write a superseding record`).toBe(locked!);
});

test("no locked record has been removed", () => {
  const present = new Set(records.map((r) => r.number));
  const missing = Object.keys(lock).filter((n) => !present.has(n));
  expect(missing, "a record is never deleted — supersede it").toEqual([]);
});

test("a superseded record names a later record that exists", () => {
  const numbers = new Set(records.map((r) => r.number));
  for (const r of records) {
    if (r.supersededBy === null) continue;
    expect(numbers.has(r.supersededBy), `${r.file} is superseded by ${r.supersededBy}, which does not exist`).toBe(true);
    expect(r.supersededBy > r.number, `${r.file} can only be superseded by a later record`).toBe(true);
  }
});

test("a lock that cannot be read is an error, never an empty lock; only a missing one starts empty", () => {
  // lock.ts adds a hash for every record the lock does not know. Read as empty, a lock left with merge-conflict markers
  // (or truncated) knew no record, so lock.ts locked every decision as it stood — an edited one included — and said so as
  // "19 records, 19 added".
  const dir = mkdtempSync(join(tmpdir(), "kinas-adr-lock-"));
  try {
    const at = (name: string, text: string) => {
      writeFileSync(join(dir, name), text);
      return join(dir, name);
    };
    expect(() => readLock(at("conflict.lock", '<<<<<<< HEAD\n{ "0001": "a" }\n=======\n{ "0001": "b" }\n>>>>>>> other\n'))).toThrow();
    expect(() => readLock(at("list.lock", "[]\n"))).toThrow();
    expect(() => readLock(at("null.lock", "null\n"))).toThrow();
    expect(() => readLock(at("number.lock", '{ "0001": 7 }\n'))).toThrow();
    expect(readLock(at("good.lock", '{ "0001": "a" }\n'))).toEqual({ "0001": "a" });
    expect(readLock(join(dir, "missing.lock"))).toEqual({});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
