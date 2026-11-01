// The architecture decision records in this folder, parsed and hashed. Shared by adr.test.ts (which
// holds every record to decisions.lock) and lock.ts (which writes the lock for a new record).
//
// A record is `NNNN-<slug>.md` with the shape of tasks/_templates/adr.md. Its `## Decision` section is
// hashed, so the test can tell an edited decision from a new one: a decision is never edited, it is
// superseded by a later record.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ADR_DIR = import.meta.dir;
export const LOCK_PATH = join(ADR_DIR, "decisions.lock");

export interface Record {
  number: string;
  file: string;
  title: string | null;
  date: string | null;
  supersededBy: string | null;
  headings: string[];
  decision: string | null;
  hash: string | null;
}

const FILE = /^(\d{4})-[a-z0-9-]+\.md$/;

export function listRecordFiles(dir = ADR_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => FILE.test(f))
    .sort();
}

/** The text between `## Decision` and the next `## ` heading, trimmed; null when the heading is missing. */
export function decisionSection(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Decision");
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

export function readRecord(file: string, dir = ADR_DIR): Record {
  const text = readFileSync(join(dir, file), "utf8");
  const number = FILE.exec(file)![1]!;
  const title = /^# (\d{4}) · (.+)$/m.exec(text);
  const date = /^Date: (\d{4}-\d{2}-\d{2})$/m.exec(text);
  const status = /^Status: (accepted|superseded by (\d{4}))$/m.exec(text);
  const decision = decisionSection(text);
  return {
    number,
    file,
    title: title && title[1] === number ? title[2]! : null,
    date: date ? date[1]! : null,
    supersededBy: status?.[2] ?? null,
    headings: text.split("\n").filter((l) => /^## /.test(l)),
    decision,
    hash: decision === null ? null : sha256(decision),
  };
}

/**
 * The lock, record number → hash; empty only when there is no lock yet. A lock that is there and cannot be read — a
 * merge left its conflict markers in, it was cut short, it is not an object of hashes — throws: read as empty, it would
 * know no record, and lock.ts would lock every decision as it stands now, an edited one included.
 */
export function readLock(path = LOCK_PATH): { [number: string]: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
  const lock: unknown = JSON.parse(text);
  if (lock === null || typeof lock !== "object" || Array.isArray(lock) || !Object.values(lock).every((h) => typeof h === "string")) {
    throw new Error(`${path} is not an object of record hashes`);
  }
  return lock as { [number: string]: string };
}
