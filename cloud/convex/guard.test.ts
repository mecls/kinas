import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Source guards (build spec §6.11, §6.12): the rules the store keeps no matter who edits a function. They read the
// files as text, so a function that drops its check, or a delete that creeps in, fails here and not in production.

const dir = import.meta.dir;
const source = (name: string) => readFileSync(join(dir, name), "utf8");

/** `export const name = mutation|query({ … });` blocks, by name. */
function publicFunctions(file: string): Map<string, string> {
  const text = source(file);
  const out = new Map<string, string>();
  const starts = [...text.matchAll(/^export const (\w+) = (mutation|query)\(/gm)];
  starts.forEach((m, i) => out.set(m[1]!, text.slice(m.index!, starts[i + 1]?.index ?? text.length)));
  return out;
}

test("every function the companion may call checks its secret before it touches a table", () => {
  const fns = publicFunctions("companion.ts");
  expect([...fns.keys()].sort()).toEqual(["heartbeat", "phones", "replaceReading", "settleAnswer", "startPairing", "takeAnswers", "unpair"]);
  for (const [name, body] of fns) {
    expect(body, name).toMatch(/args: \{\s*secret: v\.string\(\)/);
    const check = body.indexOf("await requireCompanion(secret)");
    const first = body.indexOf("ctx.db");
    expect(check, `${name} never checks the secret`).toBeGreaterThan(-1);
    expect(check, `${name} touches a table before it checks the secret`).toBeLessThan(first);
  }
});

test("every function a phone may call but `pair` checks its token before it touches a table", () => {
  const fns = publicFunctions("phone.ts");
  expect([...fns.keys()].sort()).toEqual(["inbox", "pair", "reading", "submitAnswer", "subscribe"]);
  for (const [name, body] of fns) {
    if (name === "pair") continue;
    expect(body, name).toMatch(/args: \{\s*token: v\.string\(\)/);
    const check = body.indexOf("await deviceOf(ctx, token)");
    const first = body.indexOf("ctx.db");
    expect(check, `${name} never checks the token`).toBeGreaterThan(-1);
    expect(check, `${name} touches a table before it checks the token`).toBeLessThan(first);
  }
});

test("a phone can't pair another phone, and the companion's functions aren't in the phone's file", () => {
  expect(source("phone.ts")).not.toMatch(/startPairing|requireCompanion|COMPANION_SECRET/);
  expect(source("companion.ts")).not.toMatch(/deviceOf|tokenHash/);
});

test("the only deletes are a removed phone and what closed thirty days ago; no event is ever deleted", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const deletes: string[] = [];
  for (const f of files) {
    for (const m of source(f).matchAll(/ctx\.db\.delete\(([^)]*)\)/g)) deletes.push(`${f}: ${m[1]}`);
  }
  expect(deletes.sort()).toEqual(["companion.ts: id", "crons.ts: a._id", "crons.ts: w._id"]);
  // A factory event is immutable: no code line that names the table also deletes, patches or replaces.
  for (const f of files.filter((x) => x !== "schema.ts")) {
    for (const line of source(f).split("\n")) {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      if (line.includes("factory_events")) expect(line, `${f} changes an event`).not.toMatch(/\.(delete|patch|replace)\(/);
    }
  }
});

test("no function reads or writes anything the summary list doesn't name: the schema holds no path, branch or log field", () => {
  const schema = source("schema.ts");
  for (const word of ["path", "branch", "diff", "transcript", "log", "brief", "report", "cwd", "worktree"]) {
    expect(schema, word).not.toMatch(new RegExp(`^\\s+${word}\\s*:`, "m"));
  }
});
