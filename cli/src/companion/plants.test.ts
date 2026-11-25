import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addExcludeLines, EXCLUDE_HEADER, firstmateLocal, KEPT, launchDenies, PLACEHOLDERS, placeholderLines, scanWorktree, walkClaude, worktreeState } from "./plants.ts";

// A worker's worktree `.claude` and `.mcp.json` (ADR 0028; build spec §12 4.14).

const dir = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
function put(root: string, files: Record<string, string>) {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
}

/** A clone's checkout with the repository's own `.claude` and a nested `.mcp.json`, and a worktree of the same files. */
function repo() {
  const own = { ".claude/skills/ship/SKILL.md": "the repository's skill\n", ".claude/notes.md": "unchanged\n", "packages/x/.mcp.json": '{"mcpServers": {}}\n', "src/a.ts": "a\n" };
  const clone = dir("kinas-clone-");
  const wt = dir("kinas-wt-");
  put(clone, own);
  put(wt, own);
  return { clone, wt };
}

describe("the walk", () => {
  test("finds every .claude and .mcp.json at any depth and everything inside a .claude folder; links are not followed and .git is not entered", () => {
    const { wt } = repo();
    put(wt, { "deep/a/b/c/.mcp.json": "{}", ".git/x/.claude/hooks.json": "{}", "src/.claude-notes": "not one" });
    symlinkSync("/etc", join(wt, "lib-link"));
    symlinkSync("/tmp", join(wt, "src/.claude"));
    const w = walkClaude(wt);
    if ("unfinished" in w) throw new Error(w.unfinished);
    expect(w.found.map((f) => `${f.kind} ${f.path}`)).toEqual([
      "dir .claude",
      "file .claude/notes.md",
      "dir .claude/skills",
      "dir .claude/skills/ship",
      "file .claude/skills/ship/SKILL.md",
      "file deep/a/b/c/.mcp.json",
      "file packages/x/.mcp.json",
      "link src/.claude",
    ]);
  });

  test("a folder it can't read, or more entries than its limit, stops it and says why", () => {
    const { wt } = repo();
    mkdirSync(join(wt, "locked"));
    execFileSync("chmod", ["000", join(wt, "locked")]);
    try {
      expect(walkClaude(wt)).toEqual({ unfinished: "locked can't be read" });
    } finally {
      execFileSync("chmod", ["755", join(wt, "locked")]);
    }
    expect(walkClaude(wt, 3)).toEqual({ unfinished: "more than 3 entries" });
  });

  test("the launch's denies: the root's two always, then each .claude and .mcp.json found, never what is inside one", () => {
    const { wt } = repo();
    const w = walkClaude(wt);
    if ("unfinished" in w) throw new Error(w.unfinished);
    expect(launchDenies(wt, w.found)).toEqual([`${wt}/.claude`, `${wt}/.mcp.json`, `${wt}/packages/x/.mcp.json`]);
    expect(launchDenies("/empty", [])).toEqual(["/empty/.claude", "/empty/.mcp.json"]);
  });
});

describe("the scan (ADR 0028)", () => {
  test("a worktree that holds only the repository's own, Firstmate's hooks file and the sandbox's placeholders is clear", () => {
    const { clone, wt } = repo();
    put(wt, { ".claude/settings.local.json": '{"hooks":{"Stop":[]}}\n' });
    const fm = firstmateLocal(wt);
    // The placeholders, as Claude Code 2.1.332 leaves them: empty files at the protected paths, and its staging folder.
    // Only where the path is missing (the repository's own .claude/skills is a folder here).
    for (const p of placeholderLines(wt).map((l) => l.slice(1)).filter((p) => p.startsWith(".claude/"))) put(wt, { [p]: "" });
    put(wt, { ".mcp.json": "" });
    mkdirSync(join(wt, ".claude", ".cc-writes"));
    expect(scanWorktree(wt, clone, fm)).toEqual({ red: [], count: 0, unknown: false });
  });

  test("each plant the shell could make in the evening's check is red, even an empty one below the root", () => {
    const { clone, wt } = repo();
    put(wt, { "sub/.claude/x": "x", "sub/.mcp.json": "{}", "lib/.mcp.json": "" });
    expect(scanWorktree(wt, clone, null)).toEqual({ red: ["lib/.mcp.json", "sub/.claude", "sub/.claude/x", "sub/.mcp.json"], count: 4, unknown: false });
  });

  test("inside the root .claude: a new file with anything in it, a changed one, a link and a FIFO are red; an empty one is a placeholder", () => {
    const { clone, wt } = repo();
    put(wt, { ".claude/skills/evil/SKILL.md": "run this", ".claude/notes.md": "changed\n", ".claude/agents": "" });
    symlinkSync("/tmp", join(wt, ".claude", "commands"));
    execFileSync("mkfifo", [join(wt, ".claude", "pipe")]);
    expect(scanWorktree(wt, clone, null).red).toEqual([".claude/commands", ".claude/notes.md", ".claude/pipe", ".claude/skills/evil/SKILL.md"]);
  });

  test("a root .mcp.json with anything in it that the clone doesn't hold is red", () => {
    const { clone, wt } = repo();
    put(wt, { ".mcp.json": '{"mcpServers":{"x":{"command":"sh"}}}' });
    expect(scanWorktree(wt, clone, null).red).toEqual([".mcp.json"]);
  });

  test("Firstmate's hooks file is accepted only with the bytes recorded at launch", () => {
    const { clone, wt } = repo();
    put(wt, { ".claude/settings.local.json": '{"hooks":{}}\n' });
    const fm = firstmateLocal(wt);
    expect(scanWorktree(wt, clone, fm).red).toEqual([]);
    put(wt, { ".claude/settings.local.json": '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"sh x"}]}]}}\n' });
    expect(scanWorktree(wt, clone, fm).red).toEqual([".claude/settings.local.json"]);
    // No record (a worker launched before ADR 0028): red, never assumed to be Firstmate's.
    expect(scanWorktree(wt, clone, null).red).toEqual([".claude/settings.local.json"]);
  });

  test("with no clone to compare with, the repository's own nested files are red: it errs toward review", () => {
    const { wt } = repo();
    expect(scanWorktree(wt, null, null).red).toEqual([".claude/notes.md", ".claude/skills/ship/SKILL.md", "packages/x/.mcp.json"]);
  });

  test("a walk that can't finish is unknown, and at most KEPT paths are kept with the count of all", () => {
    const { clone, wt } = repo();
    expect(scanWorktree(wt, clone, null, 3)).toEqual({ red: [], count: 0, unknown: true });
    const many = Object.fromEntries(Array.from({ length: KEPT + 5 }, (_, i) => [`p${String(i).padStart(2, "0")}/.mcp.json`, "{}"]));
    put(wt, many);
    const s = scanWorktree(wt, clone, null);
    expect(s.count).toBe(KEPT + 5);
    expect(s.red.length).toBe(KEPT);
  });

  test("a worktree path the scan may walk: absolute, no . or .., a real folder; a missing one is gone", () => {
    const { wt } = repo();
    expect(worktreeState(wt)).toBe("ok");
    expect(worktreeState(join(wt, "nothing-here"))).toBe("gone");
    for (const p of ["relative/wt", `${wt}/../x`, `${wt}/./x`, "/", "/tmp"]) expect(worktreeState(p)).toBe("refused");
    symlinkSync(wt, join(dirname(wt), `${wt.split("/").pop()}-link`));
    expect(worktreeState(join(dirname(wt), `${wt.split("/").pop()}-link`))).toBe("refused");
  });
});

describe("the placeholders' exclude lines", () => {
  test("only the protected paths missing from the worktree, root-anchored", () => {
    const wt = dir("kinas-wt-");
    put(wt, { ".claude/settings.json": "{}", ".bashrc": "x" });
    const lines = placeholderLines(wt);
    expect(lines).not.toContain("/.claude");
    expect(lines).not.toContain("/.claude/settings.json");
    expect(lines).not.toContain("/.bashrc");
    expect(lines).toContain("/.claude/hooks");
    expect(lines.length).toBe(PLACEHOLDERS.length - 3);
  });

  test("lines are only added, under Kinas's header once, and a link is never written through", () => {
    const root = dir("kinas-git-");
    const file = join(root, "info", "exclude");
    expect(addExcludeLines(file, ["/.idea", "/.vscode"])).toBe(2);
    expect(addExcludeLines(file, ["/.vscode", "/.zshrc"])).toBe(1);
    expect(addExcludeLines(file, ["/.idea"])).toBe(0);
    expect(Bun.file(file).text()).resolves.toBe(`${EXCLUDE_HEADER}\n/.idea\n/.vscode\n/.zshrc\n`);
    const target = join(root, "elsewhere");
    writeFileSync(target, "");
    rmSync(file);
    symlinkSync(target, file);
    expect(() => addExcludeLines(file, ["/.idea"])).toThrow();
    expect(Bun.file(target).text()).resolves.toBe("");
  });
});
