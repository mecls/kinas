import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_VERSION } from "./schema-version.ts";

test("SCHEMA_VERSION matches the newest migration file", () => {
  const dir = join(import.meta.dir, "../../../migrations");
  const versions = readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .map((f) => Number(f.slice(0, 4)))
    .sort((a, b) => a - b);
  expect(versions.at(-1)).toBe(SCHEMA_VERSION);
  // Migrations are numbered 1..n with no gaps, so "newest" and "count" agree.
  expect(versions).toEqual(versions.map((_, i) => i + 1));
});
