import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HERDR, herdrEnv } from "./herdr.ts";

// The companion's fixed Herdr list (build spec §11.2, slice 3; ADR 0024): the guard, with its negative control.

const here = import.meta.dir;
/** `[verb, subverb]` pairs the companion may run: read the session, focus or make a workspace, type the launcher's command. */
const ALLOWED = new Set(["api snapshot", "pane process-info", "workspace focus", "workspace create", "pane run"]);

const code = (text: string) =>
  text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
    .map((l) => l.split(" // ")[0] ?? "")
    .join("\n");

function violations(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    const c = code(text);
    // Herdr is addressed by its session: only herdr.ts may say `--session`.
    if (file !== "herdr.ts" && c.includes('"--session"')) out.push(`${file}: addresses Herdr outside herdr.ts`);
    if (file !== "herdr.ts") continue;
    for (const m of c.matchAll(/args: (?:readonly )?\["([a-z-]+)", "([a-z-]+)"/g)) {
      if (!ALLOWED.has(`${m[1]} ${m[2]}`)) out.push(`herdr.ts: runs herdr ${m[1]} ${m[2]}, which the companion never runs`);
    }
  }
  return out;
}

describe("the companion's Herdr list", () => {
  test("the guard: only herdr.ts addresses Herdr, and only with the five calls", () => {
    const files: Record<string, string> = {};
    for (const f of readdirSync(here)) if (f.endsWith(".ts") && !f.endsWith(".test.ts")) files[f] = readFileSync(join(here, f), "utf8");
    expect(violations(files)).toEqual([]);
    // Every constructor is one of the five.
    const made = [HERDR.snapshot(), HERDR.processInfo("p"), HERDR.focus("w"), HERDR.create("/c", "l"), HERDR.run("p", "claude")].map((c) => c.args.slice(0, 2).join(" "));
    expect(new Set(made)).toEqual(ALLOWED);
  });

  test("the guard finds what is planted (negative control)", () => {
    expect(violations({ "actions.ts": 'run([herdr, "--session", "default", "pane", "close"])' })).toEqual(["actions.ts: addresses Herdr outside herdr.ts"]);
    expect(violations({ "herdr.ts": '| { args: readonly ["server", "stop"] }' })).toEqual(["herdr.ts: runs herdr server stop, which the companion never runs"]);
    expect(violations({ "herdr.ts": 'close: (p: string): HerdrCall => ({ args: ["pane", "close", p] }),' })).toHaveLength(1);
    expect(violations({ "herdr.ts": '// never ["pane", "close"]\nconst a = { args: ["api", "snapshot"] };' })).toEqual([]);
  });

  test("Herdr runs with the companion's PATH and HOME, and no Herdr pane identity", () => {
    expect(herdrEnv({ HOME: "/home/c", HERDR_PANE_ID: "w1:p1", herdr_socket: "x", KEEP: "1", PATH: "/x" }, "/home/c/.local/bin:/usr/bin")).toEqual({
      HOME: "/home/c",
      KEEP: "1",
      PATH: "/home/c/.local/bin:/usr/bin",
    });
  });
});
