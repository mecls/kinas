import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask, launchAndAsk, OPEN_EXIT, outcome, resolveTarget, type Answer } from "./open.ts";

// `kinas open`'s resolution (PRD R2–R7) on a temporary tree, and its socket client against fake listeners.

const base = realpathSync.native(mkdtempSync(join(tmpdir(), "kinas-open-")));
const root = join(base, "root");
for (const d of ["root/docs", "root-old", "outside"]) mkdirSync(join(base, d), { recursive: true });
for (const f of ["root/a.md", "root/UPPER.MD", "root/notes.txt", "root-old/x.md", "outside/b.md", "root/docs/README.md"]) writeFileSync(join(base, f), "# x\n");
symlinkSync(join(base, "outside/b.md"), join(root, "link.md"));
symlinkSync(join(root, "notes.txt"), join(root, "plan.md"));
writeFileSync(join(base, "notasocket.sock"), "");

afterAll(() => rmSync(base, { recursive: true, force: true }));

const at = (arg: string, anywhere = false) => resolveTarget(arg, { cwd: root, root, anywhere });

describe("resolving from any folder (R1b)", () => {
  // Miguel's shell is somewhere else entirely; the projects folder is `root`.
  const elsewhere = (arg: string) => resolveTarget(arg, { cwd: base, root, anywhere: false });

  test("a path is tried in the shell's folder, then under the projects folder", () => {
    expect(elsewhere("root/a.md")).toEqual({ ok: true, path: join(root, "a.md"), kind: "file" });
    expect(elsewhere("docs")).toEqual({ ok: true, path: join(root, "docs"), kind: "dir" });
  });

  test("a bare name is searched for under the projects folder", () => {
    expect(elsewhere("a.md")).toEqual({ ok: true, path: join(root, "a.md"), kind: "file" });
    expect(elsewhere("a")).toEqual({ ok: true, path: join(root, "a.md"), kind: "file" });
    expect(elsewhere("README.md")).toEqual({ ok: true, path: join(root, "docs/README.md"), kind: "file" });
  });

  test("a name that is also a path under the projects folder is taken as that path", () => {
    // `a.md` sits at the top of the projects folder, so step 2 finds it and the search never runs.
    expect(elsewhere("a.md")).toEqual({ ok: true, path: join(root, "a.md"), kind: "file" });
  });

  test("several matches are handed over as a picker, newest first", () => {
    mkdirSync(join(root, "one"), { recursive: true });
    mkdirSync(join(root, "two"), { recursive: true });
    writeFileSync(join(root, "one/dup.md"), "# older\n");
    writeFileSync(join(root, "two/dup.md"), "# newer\n");
    // Distinct times, so "newest first" is being tested rather than the order the folders were walked in.
    utimesSync(join(root, "one/dup.md"), new Date(1_000_000), new Date(1_000_000));
    utimesSync(join(root, "two/dup.md"), new Date(2_000_000), new Date(2_000_000));
    expect(elsewhere("dup.md")).toEqual({ ok: true, pick: [join(root, "two/dup.md"), join(root, "one/dup.md")] });
    // Without the extension too, and the picker survives `--anywhere`.
    expect(resolveTarget("dup", { cwd: base, root, anywhere: true })).toMatchObject({ ok: true, pick: [join(root, "two/dup.md"), join(root, "one/dup.md")] });
    rmSync(join(root, "one"), { recursive: true });
    rmSync(join(root, "two"), { recursive: true });
  });

  test("a name with no match says so and exits 66; a real path is judged as a path", () => {
    expect(elsewhere("nothing.md")).toEqual({ ok: false, exit: OPEN_EXIT.noInput, message: `kinas open: no markdown file named nothing.md under ${root}` });
    // `notes.txt` exists under the projects folder, so it is a path, and a path that is not markdown is 65.
    expect(elsewhere("notes.txt")).toMatchObject({ ok: false, exit: OPEN_EXIT.notMarkdown });
  });
});

describe("resolving a path", () => {
  test("a markdown file inside the root resolves to its real path", () => {
    expect(at("a.md")).toEqual({ ok: true, path: join(root, "a.md"), kind: "file" });
    expect(at("UPPER.MD")).toMatchObject({ ok: true, kind: "file" });
    expect(at("docs")).toEqual({ ok: true, path: join(root, "docs"), kind: "dir" });
  });

  test("a symlink out of the root is outside (77), and a .md link to a .txt is not markdown (65)", () => {
    expect(at("link.md")).toMatchObject({ ok: false, exit: OPEN_EXIT.outside });
    expect(at("plan.md")).toEqual({ ok: false, exit: OPEN_EXIT.notMarkdown, message: `kinas open: ${join(root, "notes.txt")} is not a .md or .mdx file` });
    expect(at("notes.txt")).toMatchObject({ ok: false, exit: OPEN_EXIT.notMarkdown });
  });

  test("a sibling that starts with the root's name is outside, in one line naming the root", () => {
    expect(at("../root-old/x.md")).toEqual({
      ok: false,
      exit: OPEN_EXIT.outside,
      message: `kinas open: ${join(base, "root-old/x.md")} is outside ${root}; add --anywhere to ask Kinas to open it`,
    });
  });

  test("a missing file is 66 and is never created", () => {
    // A bare name that is nowhere is reported as a name, not as one path that was tried (R1b).
    expect(at("new.md")).toEqual({ ok: false, exit: OPEN_EXIT.noInput, message: `kinas open: no markdown file named new.md under ${root}` });
    expect(at("./missing/new.md")).toEqual({ ok: false, exit: OPEN_EXIT.noInput, message: `kinas open: no such file: ${join(root, "missing/new.md")}` });
    expect(at("a.md/child.md")).toMatchObject({ ok: false, exit: OPEN_EXIT.noInput });
    expect(existsSync(join(root, "new.md"))).toBe(false);
  });

  test("--anywhere lets the CLI pass a path outside the root on to the app", () => {
    expect(at("../outside/b.md", true)).toEqual({ ok: true, path: join(base, "outside/b.md"), kind: "file" });
  });
});

function server(name: string, reply: string | null): Promise<{ path: string; close: () => void }> {
  const path = join(base, name);
  const srv = net.createServer((c) => {
    c.on("data", () => {
      if (reply !== null) c.end(`${reply}\n`);
    });
  });
  return new Promise((ok) => srv.listen(path, () => ok({ path, close: () => srv.close() })));
}

describe("asking the app", () => {
  const request = { v: 1, op: "open", path: "/x.md", anywhere: false } as const;

  test("an answer line comes back parsed", async () => {
    const s = await server("answer.sock", '{"ok":true,"result":"opened","path":"/x.md"}');
    expect(await ask(s.path, request)).toEqual({ kind: "answer", body: { ok: true, result: "opened", path: "/x.md" } });
    s.close();
  });

  test("a listener that never answers is silent after the timeout", async () => {
    const s = await server("silent.sock", null);
    const started = Date.now();
    expect(await ask(s.path, request, 300)).toEqual({ kind: "silent" });
    expect(Date.now() - started).toBeLessThan(2500);
    s.close();
  });

  test("no socket, or a file that is not one, means the app is down", async () => {
    expect(await ask(join(base, "missing.sock"), request)).toEqual({ kind: "down" });
    expect(await ask(join(base, "notasocket.sock"), request)).toEqual({ kind: "down" });
  });

  test("--launch sends the request once the socket comes up, and gives up when nothing starts", async () => {
    const path = join(base, "late.sock");
    let close = () => {};
    const start = () => {
      setTimeout(() => void server("late.sock", '{"ok":true,"result":"opened","path":"/x.md"}').then((s) => (close = s.close)), 300);
      return true;
    };
    expect(await launchAndAsk(path, request, { start, timeoutMs: 5000 })).toMatchObject({ kind: "answer" });
    close();
    expect(await launchAndAsk(join(base, "never.sock"), request, { start: () => true, timeoutMs: 300 })).toBeNull();
    expect(await launchAndAsk(join(base, "never.sock"), request, { start: () => false })).toBeNull();
  });
});

describe("what kinas open prints", () => {
  const answer = (body: object): Answer => ({ kind: "answer", body: body as never });

  test("opened prints the path; confirm adds one stderr line; both exit 0", () => {
    expect(outcome(answer({ ok: true, result: "opened", path: "/r/a.md" }), { path: "/r/a.md", tty: true })).toEqual({ exit: 0, stdout: "/r/a.md", stderr: null });
    expect(outcome(answer({ ok: true, result: "confirm", path: "/o/b.md" }), { path: "/o/b.md", tty: false })).toEqual({
      exit: 0,
      stdout: "/o/b.md",
      stderr: "Kinas is asking whether to open it",
    });
  });

  test("the app's refusals map to R12's exit codes with its line on stderr", () => {
    const codes: [string, number][] = [
      ["missing", 66],
      ["empty_history", 66],
      ["not_markdown", 65],
      ["outside", 77],
      ["too_large", 1],
      ["bad_request", 1],
    ];
    for (const [code, exit] of codes) {
      expect(outcome(answer({ ok: false, code, error: `line for ${code}` }), { path: "/a.md", tty: true })).toEqual({ exit, stdout: null, stderr: `line for ${code}` });
    }
  });

  test("with the app down, a path is printed (exit 0) and a reopen is 66", () => {
    expect(outcome({ kind: "down" }, { path: "/r/a.md", tty: true })).toEqual({ exit: 0, stdout: "/r/a.md", stderr: "Kinas is not running; add --launch to start it" });
    expect(outcome({ kind: "down" }, { path: "/r/a.md", tty: false })).toEqual({ exit: 0, stdout: "/r/a.md", stderr: null });
    expect(outcome({ kind: "down" }, { path: null, tty: true })).toEqual({ exit: 66, stdout: null, stderr: "kinas open: Kinas is not running, so there is no last file" });
    expect(outcome({ kind: "silent" }, { path: "/r/a.md", tty: true })).toEqual({ exit: 1, stdout: null, stderr: "kinas open: Kinas did not answer" });
  });
});
