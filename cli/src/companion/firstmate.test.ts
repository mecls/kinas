import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALL, firstmate, installed, laneConfigOf, scriptEnv } from "./firstmate.ts";

// The companion's fixed Firstmate list (build spec §6.6, slice 2.5; ADRs 0020, 0022).

const here = import.meta.dir;
/** Every `fm-<name>.sh` named in the companion's code, outside comments and tests. */
const ALLOWED = new Set(["fm-fleet-snapshot.sh", "fm-capacity.sh", "fm-afk-contract.sh", "fm-project-mode.sh", "fm-captain-hold.sh", "fm-inbox.sh"]);

function scriptsNamed(text: string): string[] {
  const code = text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
    .map((l) => l.split(" // ")[0] ?? "")
    .join("\n");
  return [...code.matchAll(/fm-[a-z0-9-]+\.sh/g)].map((m) => m[0]);
}

/**
 * ADRs 0025–0026's one exception: setup.ts writes the relay rule and the first mate's relay instruction. Their entries
 * name Firstmate's scripts as permission text and as words the first mate's Claude Code reads; the companion never
 * runs them. Only these are set aside, in setup.ts alone: the `Bash(...)` template literals, and the one template
 * literal `relayInstruction` returns. Any other mention of a script there is judged as everywhere else.
 */
const RELAY_SCRIPTS = /(?:\$\{home\}\/)?bin\/fm-(?:send|inbox|wake-drain|captain-hold)\.sh/g;
const RELAY_ENTRY = /`Bash\((?:FM_HOME=\$\{home\} )?(?:\$\{home\}\/)?bin\/fm-(?:send|inbox|wake-drain|captain-hold)\.sh[^`\n]*\)`/g;
const RELAY_INSTRUCTION = /export function relayInstruction\(home: string\): string \{\n  return `[^`]*`;\n\}/;

function violations(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [file, raw] of Object.entries(files)) {
    // The instruction keeps its text but for the four relay scripts' names: any other script in it is still found.
    const text = file === "setup.ts" ? raw.replace(RELAY_INSTRUCTION, (m) => m.replace(RELAY_SCRIPTS, "")).replace(RELAY_ENTRY, "``") : raw;
    for (const s of scriptsNamed(text)) {
      if (!ALLOWED.has(s)) out.push(`${file}: names ${s}, which the companion never runs`);
      else if (file !== "firstmate.ts") out.push(`${file}: names ${s} outside firstmate.ts`);
    }
  }
  return out;
}

describe("the companion's Firstmate list", () => {
  test("the guard: only firstmate.ts names a script, and only the six of ADR 0020 and 0022", () => {
    const files: Record<string, string> = {};
    for (const f of readdirSync(here)) if (f.endsWith(".ts") && !f.endsWith(".test.ts")) files[f] = readFileSync(join(here, f), "utf8");
    expect(Object.keys(files)).toContain("firstmate.ts");
    expect(violations(files)).toEqual([]);
  });

  test("the guard finds what is planted (negative control)", () => {
    expect(violations({ "answer.ts": 'run("fm-send.sh", task, words);' })).toEqual(["answer.ts: names fm-send.sh, which the companion never runs"]);
    expect(violations({ "firstmate.ts": '{ script: "fm-park.sh" }' })).toHaveLength(1);
    expect(violations({ "run.ts": 'const s = "fm-fleet-snapshot.sh";' })).toHaveLength(1);
    expect(violations({ "firstmate.ts": '// never fm-send.sh\nconst a = "fm-inbox.sh";' })).toEqual([]);
    // The relay rule's entries and the instruction are text setup.ts writes, not runs; anything else there is judged as anywhere.
    const rule = "return [`Bash(bin/fm-send.sh *)`, `Bash(FM_HOME=${home} bin/fm-wake-drain.sh --ack-through * --recovery-generation *)`];";
    expect(violations({ "setup.ts": rule })).toEqual([]);
    expect(violations({ "install.ts": rule })).toHaveLength(2);
    const instruction = "export function relayInstruction(home: string): string {\n  return `run bin/fm-send.sh, then bin/fm-wake-drain.sh`;\n}";
    expect(violations({ "setup.ts": instruction })).toEqual([]);
    expect(violations({ "setup.ts": instruction.replace("relayInstruction", "otherText") })).toHaveLength(2);
    expect(violations({ "setup.ts": instruction.replace("bin/fm-send.sh", "bin/fm-park.sh") })).toEqual(["setup.ts: names fm-park.sh, which the companion never runs"]);
    expect(violations({ "setup.ts": 'run(["bash", join(home, "bin/fm-send.sh"), task]);' })).toEqual(["setup.ts: names fm-send.sh, which the companion never runs"]);
    expect(violations({ "setup.ts": "const r = `Bash(bin/fm-park.sh *)`;" })).toEqual(["setup.ts: names fm-park.sh, which the companion never runs"]);
  });

  test("a script runs with Kinas's environment: FM_HOME, the given PATH, no Herdr identity, stdin only when given", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "kinas-fm-")));
    mkdirSync(join(home, "bin"));
    const probe = join(home, "bin", "fm-inbox.sh");
    writeFileSync(probe, '#!/usr/bin/env bash\necho "home=$FM_HOME path=$PATH herdr=${HERDR_PANE_ID:-none} pwd=$PWD args=$*"\ncat\necho oops >&2\nexit 3\n');
    chmodSync(probe, 0o755);
    const fm = firstmate(home, "/usr/bin:/bin", { HERDR_PANE_ID: "w1:p1", KEEP: "1" });
    const out = await fm.run(CALL.note("kinas-1", "the words\n"), 5000);
    expect(out).toEqual({
      exit: 3,
      timed_out: false,
      stdout: `home=${home} path=/usr/bin:/bin herdr=none pwd=${home} args=note --request-id kinas-1 --json -\nthe words\n`,
      stderr_first: "oops",
    });
    const quiet = await fm.run(CALL.receipts, 5000);
    expect(quiet.stdout.endsWith("args=receipts\n")).toBe(true);
    expect(scriptEnv({ HERDR_SESSION: "x", herdr_env: "y", KEEP: "1" }, "/h", "/p")).toEqual({ KEEP: "1", PATH: "/p", FM_HOME: "/h" });
  });

  test("a script past its limit is reported as timed out", async () => {
    const home = mkdtempSync(join(tmpdir(), "kinas-fm-"));
    mkdirSync(join(home, "bin"));
    writeFileSync(join(home, "bin", "fm-capacity.sh"), "#!/usr/bin/env bash\nsleep 5\n");
    const out = await firstmate(home, "/usr/bin:/bin").run({ script: "fm-capacity.sh", args: ["--json"] }, 200);
    expect(out).toMatchObject({ exit: null, timed_out: true });
  });

  test("installed means the snapshot script is there", () => {
    const home = mkdtempSync(join(tmpdir(), "kinas-fm-"));
    expect(installed(home)).toBe(false);
    mkdirSync(join(home, "bin"));
    writeFileSync(join(home, "bin", "fm-fleet-snapshot.sh"), "");
    expect(installed(home)).toBe(true);
  });

  test("the lane gate reads config/lane-capacity as the Mac does (config.rs lane_config_cases)", () => {
    const cases: [string, ReturnType<typeof laneConfigOf>][] = [
      ["4\n", { kind: "cap", cap: 4 }],
      ["auto\n", { kind: "auto" }],
      ["4\nquota-provider claude\n", { kind: "quota" }],
      ["4 # cap\n  quota-provider x # c\n", { kind: "quota" }],
      ["# a note first\n\n12\nmin-avail-gb 5\n", { kind: "cap", cap: 12 }],
      ["4\n# quota-provider claude\n", { kind: "cap", cap: 4 }],
      ["4\nquota-providers x\n", { kind: "cap", cap: 4 }],
      ["abc\n", { kind: "invalid" }],
      ["1234567890\n", { kind: "invalid" }],
      ["", { kind: "invalid" }],
    ];
    for (const [text, want] of cases) expect([text, laneConfigOf(text)]).toEqual([text, want]);
  });
});
