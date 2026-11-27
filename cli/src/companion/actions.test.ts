import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { existing, firstMateCommand, focusWorkspace, launchFirstMate, openWorkspace, paneCommand, STARTING_MS, twinOf, viewNow, WORKSPACE_LABEL, type ActionDeps } from "./actions.ts";
import { relayInstruction } from "./setup.ts";
import { recordWritten } from "./written.ts";
import type { HerdrCall, HerdrOut } from "./herdr.ts";
import { companionPaths } from "./paths.ts";

// The Herdr actions on the VPS (build spec §11.2, slice 3.2): the Mac's launcher rules (crew/launch.rs), focus, and Open
// in the terminal's twin under the projects folder, against a Herdr that keeps one session in memory.

const FIXTURES = join(import.meta.dir, "..", "..", "..", "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

interface Ws {
  id: string;
  label: string;
  focused: boolean;
  pane: string;
  /** The pane's foreground argv0s; null when `process-info` fails. */
  fg: string[] | null;
}

/** A Herdr session in memory: answers the five calls as Herdr 0.9 does, and records each argv. */
function fakeHerdr(workspaces: Ws[], opts: { down?: boolean } = {}) {
  const calls: string[][] = [];
  const herdr = async (call: HerdrCall): Promise<HerdrOut> => {
    const a = [...call.args];
    calls.push(a);
    if (opts.down) return { ok: false, stdout: "" };
    const json = (v: unknown) => ({ ok: true, stdout: JSON.stringify(v) });
    if (a[0] === "api") {
      return json({
        result: {
          snapshot: {
            focused_pane_id: workspaces.find((w) => w.focused)?.pane ?? null,
            workspaces: workspaces.map((w, i) => ({ workspace_id: w.id, label: w.label, number: i + 1, focused: w.focused })),
            panes: workspaces.map((w) => ({ pane_id: w.pane, workspace_id: w.id, focused: true })),
          },
        },
      });
    }
    if (a[0] === "pane" && a[1] === "process-info") {
      const w = workspaces.find((x) => x.pane === a[3]);
      if (!w || w.fg === null) return { ok: false, stdout: "" };
      return json({ result: { process_info: { foreground_processes: w.fg.map((argv0) => ({ argv0, name: "2.1.0" })) } } });
    }
    if (a[0] === "workspace" && a[1] === "focus") {
      const w = workspaces.find((x) => x.id === a[2]);
      if (!w) return { ok: false, stdout: "" };
      for (const x of workspaces) x.focused = x === w;
      return { ok: true, stdout: "" };
    }
    if (a[0] === "workspace" && a[1] === "create") {
      const n = workspaces.length + 1;
      for (const x of workspaces) x.focused = false;
      workspaces.push({ id: `w${n}`, label: a[5]!, focused: true, pane: `w${n}:p1`, fg: ["-zsh"] });
      return json({ result: { root_pane: { pane_id: `w${n}:p1` } } });
    }
    if (a[0] === "pane" && a[1] === "run") return { ok: true, stdout: "" };
    return { ok: false, stdout: "" };
  };
  return { herdr, calls, workspaces };
}

function world(workspaces: Ws[], opts: { down?: boolean; installed?: boolean; instruction?: "kinas" | "foreign" | "none" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kinas-actions-")));
  const paths = companionPaths({ KINAS_COMPANION_ROOT: root });
  if (opts.installed ?? true) {
    mkdirSync(join(paths.home, "bin"), { recursive: true });
    writeFileSync(join(paths.home, "bin", "fm-fleet-snapshot.sh"), "#!/bin/sh\n");
  }
  const instruction = opts.instruction ?? "kinas";
  if (instruction !== "none") {
    mkdirSync(dirname(paths.relayInstruction), { recursive: true });
    writeFileSync(paths.relayInstruction, relayInstruction(paths.home));
    if (instruction === "kinas") {
      const sha256 = new Bun.CryptoHasher("sha256").update(relayInstruction(paths.home)).digest("hex");
      recordWritten(paths, paths.relayInstruction, { item: "relay-instruction", version: "1", sha256, at: 1 }, 1);
    }
  }
  mkdirSync(paths.projectRoots[0]!, { recursive: true });
  const fake = fakeHerdr(workspaces, opts);
  let now = 1_794_834_000_000;
  const deps: ActionDeps = { paths, herdr: fake.herdr, now: () => now };
  return { deps, paths, ...fake, tick: (ms: number) => (now += ms) };
}

const firstMate = (fg: string[] | null, focused = false): Ws => ({ id: "w1", label: WORKSPACE_LABEL, focused, pane: "w1:p1", fg });
const other = (): Ws => ({ id: "w2", label: "elsewhere", focused: true, pane: "w2:p1", fg: ["-zsh"] });

describe("launch-first-mate: the Mac's launcher, on the VPS", () => {
  test("no Firstmate home: nothing is asked of Herdr", async () => {
    const w = world([], { installed: false });
    expect(await launchFirstMate(w.deps)).toEqual({ cannot: "not-installed" });
    expect(w.calls).toEqual([]);
  });

  test("no-instruction: without Kinas's own copy of the relay instruction, nothing is asked of Herdr", async () => {
    for (const instruction of ["none", "foreign"] as const) {
      const w = world([other()], { instruction });
      expect(await launchFirstMate(w.deps)).toEqual({ cannot: "no-instruction" });
      expect(w.calls).toEqual([]);
    }
  });

  test("the first mate's command: the program and the one flag, quoted where needed", () => {
    expect(firstMateCommand("claude", "/home/c/.local/share/kinas/first-mate-relay.md")).toBe(
      "claude --append-system-prompt-file /home/c/.local/share/kinas/first-mate-relay.md",
    );
    expect(firstMateCommand("claude", "/a b/x.md")).toBe("claude --append-system-prompt-file '/a b/x.md'");
  });

  test("Herdr not answering is said, and nothing else is tried", async () => {
    const w = world([], { down: true });
    expect(await launchFirstMate(w.deps)).toEqual({ cannot: "herdr-not-running" });
    expect(w.calls).toEqual([["api", "snapshot"]]);
  });

  test("no `firstmate` workspace: one is made in Firstmate's home and the program typed there, exactly", async () => {
    const w = world([other()]);
    expect(await launchFirstMate(w.deps)).toEqual({ done: "created" });
    expect(w.calls).toEqual([
      ["api", "snapshot"],
      ["workspace", "create", "--cwd", w.paths.home, "--label", "firstmate", "--focus"],
      ["pane", "run", "w2:p1", firstMateCommand(w.paths.claude, w.paths.relayInstruction)],
    ]);
    expect(JSON.parse(readFileSync(join(w.paths.state, "launcher-typed.json"), "utf8"))).toEqual({ pane: "w2:p1", at: 1_794_834_000_000 });
  });

  test("the first mate running: its workspace is focused and its pane never typed into", async () => {
    const w = world([firstMate(["claude"]), other()]);
    expect(await launchFirstMate(w.deps)).toEqual({ done: "focused" });
    expect(w.calls).toEqual([["api", "snapshot"], ["pane", "process-info", "--pane", "w1:p1"], ["workspace", "focus", "w1"]]);
    expect(w.workspaces[0]!.focused).toBe(true);
  });

  test("an idle shell is typed into once; a second launch within 30 s leaves it, and after 30 s types again", async () => {
    const w = world([firstMate(["-zsh"]), other()]);
    expect(await launchFirstMate(w.deps)).toEqual({ done: "run" });
    expect(w.calls.at(-1)).toEqual(["pane", "run", "w1:p1", firstMateCommand(w.paths.claude, w.paths.relayInstruction)]);
    w.calls.length = 0;
    w.tick(STARTING_MS - 1);
    expect(await launchFirstMate(w.deps)).toEqual({ done: "focused" });
    expect(w.calls.some((c) => c[1] === "run")).toBe(false);
    w.tick(1);
    expect(await launchFirstMate(w.deps)).toEqual({ done: "run" });
  });

  test("a pane Herdr cannot describe, or running something else, is focused and left alone", async () => {
    for (const fg of [null, ["vim"], ["-zsh", "node"], []]) {
      const w = world([firstMate(fg), other()]);
      expect(await launchFirstMate(w.deps)).toEqual({ done: "focused" });
      expect(w.calls.some((c) => c[1] === "run")).toBe(false);
    }
  });

  test("the decision and the command are the Mac's (launch::existing, launch::pane_command)", () => {
    expect(existing(["/usr/local/bin/claude"], false)).toBe("running");
    expect(existing(["-bash"], false)).toBe("type");
    expect(existing(["-bash"], true)).toBe("leave");
    expect(existing(null, false)).toBe("leave");
    expect(paneCommand("claude")).toBe("claude");
    expect(paneCommand("/tmp/a b/claude")).toBe("'/tmp/a b/claude'");
    expect(paneCommand("/tmp/it's/claude")).toBe(`'/tmp/it'\\''s/claude'`);
  });

  test("Herdr's captured shapes read as the Mac reads them", async () => {
    const { foregroundOf, parseView, rootPane } = await import("./herdr.ts");
    expect(foregroundOf(fixture("herdr-process-info.shell.captured.json"))).toEqual(["zsh"]);
    expect(rootPane(fixture("herdr-workspace-create.captured.json"))).toBe("w1:p1");
    const v = parseView(fixture("herdr-api-snapshot.captured.json"))!;
    expect(v.focusedPane).toBe("w1:p1");
    expect(v.workspaces[0]).toEqual({ id: "w1", label: "firstmate", number: 1, focused: true });
    expect(parseView("not json")).toBeNull();
  });
});

describe("view, focus and open-workspace", () => {
  test("view: the session and its focused pane's foreground, read now and verbatim; nulls when Herdr is down", async () => {
    const w = world([firstMate(["claude"], true), other()].map((x, i) => ({ ...x, focused: i === 0 })));
    const v = await viewNow(w.deps);
    expect(JSON.parse(v.herdr_view!).result.snapshot.focused_pane_id).toBe("w1:p1");
    expect(JSON.parse(v.herdr_foreground!).result.process_info.foreground_processes[0].argv0).toBe("claude");
    expect(w.calls).toEqual([["api", "snapshot"], ["pane", "process-info", "--pane", "w1:p1"]]);
    expect(await viewNow(world([], { down: true }).deps)).toEqual({ herdr_view: null, herdr_foreground: null });
  });

  test("focus: a workspace Herdr has, or says it is gone", async () => {
    const w = world([firstMate(["claude"]), other()]);
    expect(await focusWorkspace(w.deps, "w1")).toEqual({ done: "focused" });
    expect(await focusWorkspace(w.deps, "w9")).toEqual({ cannot: "no-workspace" });
    expect(w.calls.filter((c) => c[1] === "focus")).toEqual([["workspace", "focus", "w1"]]);
    expect(await focusWorkspace(world([], { down: true }).deps, "w1")).toEqual({ cannot: "herdr-not-running" });
  });

  test("open-workspace: the twin is made once with its label, then found again by it", async () => {
    const w = world([other()]);
    mkdirSync(join(w.paths.projectRoots[0]!, "kinas", "docs"), { recursive: true });
    expect(await openWorkspace(w.deps, "kinas/docs", "kinas/docs")).toEqual({ done: "created" });
    expect(w.calls.at(-1)).toEqual(["workspace", "create", "--cwd", join(w.paths.projectRoots[0]!, "kinas", "docs"), "--label", "kinas/docs", "--focus"]);
    expect(await openWorkspace(w.deps, "kinas/docs", "kinas/docs")).toEqual({ done: "focused" });
    expect(w.workspaces.filter((x) => x.label === "kinas/docs")).toHaveLength(1);
  });

  test("with two projects folders, the twin is found in the first that has it (slice 5.3)", async () => {
    const w = world([other()]);
    const second = realpathSync(mkdtempSync(join(tmpdir(), "kinas-second-")));
    w.paths.projectRoots.push(second);
    mkdirSync(join(second, "notes"));
    expect(await openWorkspace(w.deps, "notes", "notes")).toEqual({ done: "created" });
    expect(w.calls.at(-1)).toEqual(["workspace", "create", "--cwd", join(second, "notes"), "--label", "notes", "--focus"]);
    mkdirSync(join(w.paths.projectRoots[0]!, "notes"));
    expect(await openWorkspace(w.deps, "notes", "notes-2")).toEqual({ done: "created" });
    expect(w.calls.at(-1)).toEqual(["workspace", "create", "--cwd", join(w.paths.projectRoots[0]!, "notes"), "--label", "notes-2", "--focus"]);
  });

  test("a folder not under the projects folder is not there, and Herdr is never asked", async () => {
    const w = world([other()]);
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "kinas-outside-")));
    symlinkSync(outside, join(w.paths.projectRoots[0]!, "escape"));
    writeFileSync(join(w.paths.projectRoots[0]!, "a-file"), "");
    for (const folder of ["missing", "escape", "a-file"]) expect(await openWorkspace(w.deps, folder, folder)).toEqual({ cannot: "not-there" });
    expect(w.calls).toEqual([]);
    expect(twinOf(w.paths.projectRoots[0]!, "")).toBe(w.paths.projectRoots[0]!);
    mkdirSync(join(outside, "x"));
    expect(twinOf(w.paths.projectRoots[0]!, "escape/x")).toBeNull();
  });
});
