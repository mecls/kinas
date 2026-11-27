import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The session hook runs outside the sandbox, on the Mac and on the Linux machine (slice 5.3). The captain's rule: in a
// worker it exits at once and reads nothing; everywhere its input is data, never run through the shell.

const SCRIPT = join(import.meta.dir, "kinas-context.sh");
const dir = realpathSync(mkdtempSync(join(tmpdir(), "kinas-hook-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in kinas that records its arguments, one per line, and prints a packet; or fails, noisily. */
function fakeKinas(name: string, fail = false): { bin: string; args: () => string[] | null } {
  const bin = join(dir, name);
  const record = join(dir, `${name}.args`);
  writeFileSync(
    bin,
    fail ? `#!/bin/sh\necho broken >&2\nexit 3\n` : `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > '${record}'\nprintf '# Kinas context\\n'\n`,
  );
  chmodSync(bin, 0o755);
  return { bin, args: () => (existsSync(record) ? readFileSync(record, "utf8").split("\n").slice(0, -1) : null) };
}

function run(env: Record<string, string>, stdin: string, cwd = dir) {
  const r = Bun.spawnSync(["/bin/sh", SCRIPT], { env: { PATH: "/usr/bin:/bin", HOME: dir, ...env }, cwd, stdin: Buffer.from(stdin) });
  return { exit: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

const HOSTILE = `$(touch ${dir}/planted1) \`touch ${dir}/planted2\`; touch ${dir}/planted3 "q" 'q' && rm -rf ${dir} #`;
const planted = () => readdirSync(dir).filter((f) => f.startsWith("planted"));

describe("the session hook", () => {
  test("in a worker it exits at once: it doesn't wait for its input, runs nothing and prints nothing", async () => {
    const k = fakeKinas("kinas-worker");
    const proc = Bun.spawn(["/bin/sh", SCRIPT], {
      env: { PATH: "/usr/bin:/bin", HOME: dir, FM_TASK_ID: "t-9c2e", KINAS_BIN: k.bin, CLAUDE_PROJECT_DIR: dir },
      cwd: dir,
      stdin: "pipe",
      stdout: "pipe",
    });
    // The input is never closed: a hook that read it would still be waiting.
    const exit = await Promise.race([proc.exited, Bun.sleep(3000).then(() => "still running")]);
    if (exit === "still running") proc.kill();
    expect(exit).toBe(0);
    expect(await new Response(proc.stdout).text()).toBe("");
    expect(k.args()).toBeNull();
  });

  test("the project folder reaches kinas as one argument, verbatim; the input's JSON is dropped; nothing it carries runs", () => {
    const k = fakeKinas("kinas-data");
    const project = `/tmp/${HOSTILE}`;
    const input = JSON.stringify({ session_id: HOSTILE, cwd: HOSTILE, hook_event_name: "SessionStart", source: `startup; ${HOSTILE}` });
    const r = run({ KINAS_BIN: k.bin, CLAUDE_PROJECT_DIR: project }, input);
    expect(r).toEqual({ exit: 0, out: "# Kinas context\n", err: "" });
    expect(k.args()).toEqual(["context", "--agent", "--cwd", project]);
    expect(planted()).toEqual([]);
    expect(existsSync(dir)).toBe(true);
  });

  test("a project folder that isn't an absolute path runs nothing; with none, the session's own folder is used", () => {
    const k = fakeKinas("kinas-paths");
    expect(run({ KINAS_BIN: k.bin, CLAUDE_PROJECT_DIR: "-rf" }, "{}")).toEqual({ exit: 0, out: "", err: "" });
    expect(run({ KINAS_BIN: k.bin, CLAUDE_PROJECT_DIR: `relative/${HOSTILE}` }, "{}")).toEqual({ exit: 0, out: "", err: "" });
    expect(k.args()).toBeNull();
    expect(run({ KINAS_BIN: k.bin }, "{}").out).toBe("# Kinas context\n");
    expect(k.args()).toEqual(["context", "--agent", "--cwd", dir]);
    expect(planted()).toEqual([]);
  });

  test("a missing or failing kinas never fails the session and prints nothing", () => {
    expect(run({ KINAS_BIN: join(dir, "no-such-kinas"), CLAUDE_PROJECT_DIR: dir }, "{}")).toEqual({ exit: 0, out: "", err: "" });
    expect(run({ KINAS_BIN: fakeKinas("kinas-broken", true).bin, CLAUDE_PROJECT_DIR: dir }, "{}")).toEqual({ exit: 0, out: "", err: "" });
  });
});
