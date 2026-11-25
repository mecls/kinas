// What Kinas wrote on the machine (the captain, 2026-11-25; build spec §17): the only test of whether a file is Kinas's
// to replace. A file is Kinas's when this record names its path and the file still has the SHA-256 Kinas wrote there.
// A copy the captain put there is not in it — even one byte for byte the release Kinas pins, as the home lab's own
// Herdr is — and a file Kinas wrote that has since changed no longer matches; both are left as they are. A pinned
// SHA-256 says only that a download is the release; for an archive it is not even the installed file's.
//
// One JSON file in the companion's state folder, `{ v: 1, files: { <absolute path>: { item, version, sha256, at } } }`,
// replaced whole (a temporary file, then a rename), mode 0600. A record that does not read as one owns nothing; before a
// new one is written it is kept beside it as `written.json.unreadable-<ms>`, never written over.

import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Paths } from "./paths.ts";

export const WRITTEN_FILE = "written.json";

export interface WrittenFile {
  /** What wrote it: the release's name (`herdr`, `treehouse`, `no-mistakes`). */
  item: string;
  version: string;
  /** The SHA-256 of the bytes Kinas put at the path. */
  sha256: string;
  /** When, in ms since the epoch. */
  at: number;
}

type State = Pick<Paths, "state">;

const SHA256 = /^[0-9a-f]{64}$/;

function entryOf(value: unknown): WrittenFile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { item, version, sha256, at } = value as Record<string, unknown>;
  if (typeof item !== "string" || typeof version !== "string" || typeof sha256 !== "string" || !SHA256.test(sha256)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { item, version, sha256, at };
}

/** The record's files, or null when the text is not a record: then nothing is Kinas's. */
function parse(text: string): Record<string, WrittenFile> | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const { v, files } = doc as Record<string, unknown>;
  if (v !== 1 || typeof files !== "object" || files === null || Array.isArray(files)) return null;
  const out: Record<string, WrittenFile> = {};
  for (const [path, value] of Object.entries(files)) {
    const entry = entryOf(value);
    if (entry === null || !path.startsWith("/")) return null;
    out[path] = entry;
  }
  return out;
}

/** Every file the record names; an absent or unreadable record names none. */
export function readWritten(paths: State): Record<string, WrittenFile> {
  try {
    return parse(readFileSync(join(paths.state, WRITTEN_FILE), "utf8")) ?? {};
  } catch {
    return {};
  }
}

export async function sha256Of(path: string): Promise<string | null> {
  try {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(path).arrayBuffer());
    return hasher.digest("hex");
  } catch {
    return null;
  }
}

/** Whether Kinas wrote `path` and it still holds what Kinas wrote. */
export async function isKinasCopy(paths: State, path: string): Promise<boolean> {
  const entry = readWritten(paths)[path];
  if (entry === undefined) return false;
  return (await sha256Of(path)) === entry.sha256;
}

/** Adds or replaces `path`'s entry; every other entry is kept. */
export function recordWritten(paths: State, path: string, entry: WrittenFile, now: number): void {
  mkdirSync(paths.state, { recursive: true, mode: 0o700 });
  const file = join(paths.state, WRITTEN_FILE);
  let files: Record<string, WrittenFile> = {};
  if (existsSync(file)) {
    const parsed = parse(readFileSync(file, "utf8"));
    if (parsed === null) renameSync(file, `${file}.unreadable-${now}`);
    else files = parsed;
  }
  files[path] = entry;
  writeWhole(file, `${JSON.stringify({ v: 1, files }, null, 2)}\n`, 0o600);
}

/** Writes `text` to a new temporary file beside `file` (never through a link), then renames it over `file`. */
export function writeWhole(file: string, text: string, mode = 0o644): void {
  const next = `${file}.kinas-new`;
  rmSync(next, { force: true });
  const fd = openSync(next, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    writeFileSync(fd, text);
  } finally {
    closeSync(fd);
  }
  renameSync(next, file);
}
