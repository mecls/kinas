import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeFakeHome, writeConfig } from "../../../e2e/fake-firstmate/make.ts";
import { firstmate, type ScriptOut } from "./firstmate.ts";
import { companionPaths } from "./paths.ts";
import { branchArgs, branchExistsArgs, cloneOrigin, duePrs, originUrl, prUrlOk, readOnce, tasksOf, type Deps } from "./run.ts";
import { firstmateLocal, launchRecordFile } from "./plants.ts";

// The companion's reading (build spec §11.3 B, slice 2.1): the integration half runs the fake Firstmate's scripts for
// real (e2e/fake-firstmate), each logging its argv, so the tests prove which ran and that nothing else did.

const FIXTURES = join(import.meta.dir, "..", "..", "..", "fixtures");
const PR_91 = "https://github.com/acme-9c2e/shop-9c2e/pull/91";
const PR_90 = "https://github.com/acme-9c2e/harbor-api-9c2e/pull/90";

interface World {
  deps: Deps;
  home: string;
  calls: () => string[];
  gh: string[];
  herdr: string[][];
  lines: string[];
  now: { t: number };
}

function world(opts: { clones?: boolean; snapshot?: string } = {}): World {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kinas-run-")));
  const paths = companionPaths({ KINAS_COMPANION_ROOT: root });
  const home = makeFakeHome(root, opts.snapshot ?? "firstmate-fleet-snapshot.current.synthetic.json", { clones: opts.clones ?? true });
  const gh: string[] = [];
  const herdr: string[][] = [];
  const lines: string[] = [];
  const now = { t: 1_794_834_000_000 };
  const deps: Deps = {
    paths,
    version: "0.1.0",
    fm: firstmate(home, process.env.PATH ?? "/usr/bin:/bin"),
    path: "/usr/bin:/bin",
    session: "default",
    clock: () => now.t,
    log: (l) => lines.push(l),
    gh: async (url): Promise<ScriptOut> => {
      gh.push(url);
      return { exit: 0, timed_out: false, stdout: JSON.stringify({ number: Number(url.split("/").pop()), state: "OPEN" }), stderr_first: null };
    },
    herdr: async (call) => {
      herdr.push([...call.args]);
      if (call.args[0] === "api") return { ok: true, stdout: readFileSync(join(FIXTURES, "herdr-api-snapshot.captured.json"), "utf8") };
      return { ok: true, stdout: readFileSync(join(FIXTURES, "herdr-process-info.claude.captured.json"), "utf8") };
    },
  };
  const calls = () => {
    try {
      return readFileSync(join(home, "state", "calls.log"), "utf8").trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  return { deps, home, calls, gh, herdr, lines, now };
}

describe("the companion's reading", () => {
  test("readOnce runs the fixed scripts with Kinas's argv, reads Herdr and the due PRs, and writes reading.json whole", async () => {
    const w = world();
    const r = await readOnce(w.deps, null, 1_794_830_400_000);
    expect(w.calls()).toEqual([
      "fm-fleet-snapshot.sh --json",
      "fm-afk-contract.sh field entered",
      "fm-afk-contract.sh field expected_return",
      "fm-project-mode.sh alpha-9c2e",
      "fm-project-mode.sh beta-9c2e",
      "fm-project-mode.sh delta-9c2e",
      "fm-project-mode.sh gamma-9c2e",
      "fm-project-mode.sh shop-9c2e",
    ]);
    const local = readFileSync(join(FIXTURES, "firstmate-fleet-snapshot.current.synthetic.json"), "utf8").replaceAll("__FM_HOME__", w.home);
    expect(r.snapshot).toEqual({ exit: 0, timed_out: false, stdout: local, stderr_first: null });
    expect(r).toMatchObject({ v: 1, at: w.now.t, installed: true, home: w.home, companion: { version: "0.1.0", since: 1_794_830_400_000, heartbeat_at: w.now.t } });
    expect(r.capacity).toBeNull();
    expect(r.afk).toEqual({ entered: null, expected_return: null });
    expect(r.modes).toEqual({ "alpha-9c2e": "no-mistakes off", "beta-9c2e": "no-mistakes off", "delta-9c2e": "no-mistakes off", "gamma-9c2e": "no-mistakes off", "shop-9c2e": "no-mistakes off" });
    expect(r.origins[join(w.home, "projects", "shop-9c2e")]).toBe("git@github.com:acme-9c2e/shop-9c2e.git");
    expect(r.origins[join(w.home, "projects", "delta-9c2e")]).toBeNull();
    expect(w.herdr).toEqual([["api", "snapshot"], ["pane", "process-info", "--pane", "w1:p1"]]);
    expect(r.herdr_view).toContain('"focused_pane_id"');
    expect(r.herdr_foreground).toContain("foreground_processes");
    expect(w.gh).toEqual([PR_90, PR_91]);
    expect(r.prs.map((p) => p.url)).toEqual([PR_90, PR_91]);
    expect(JSON.parse(readFileSync(w.deps.paths.reading, "utf8"))).toEqual(r);
  });

  test("slice 6: the open questions, each opening carried; a failed snapshot keeps them; a delivered answer's receipts looked at", async () => {
    const w = world({ clones: false });
    const first = await readOnce(w.deps, null, 0);
    expect(first.questions).toEqual([{ task: "stock-webhook-9c2e", key: "stock-webhook-9c2e", hold: true, opened_at: w.now.t }]);
    w.now.t += 15_000;
    const second = await readOnce(w.deps, first, 0);
    expect(second.questions).toEqual(first.questions);
    const failing: Deps = { ...w.deps, fm: { run: async (c, l) => (c.script === "fm-fleet-snapshot.sh" ? { exit: 1, timed_out: false, stdout: "", stderr_first: null } : w.deps.fm.run(c, l)) } };
    w.now.t += 15_000;
    expect((await readOnce(failing, second, 0)).questions).toEqual(first.questions);
    expect(w.calls().filter((c) => c.startsWith("fm-inbox.sh"))).toEqual([]);
    // A delivered answer not yet read: the reading asks the receipts (the fake inbox has no note of it, so it stays
    // unread); and when receipts can't be read, the reading says so and goes on.
    writeFileSync(join(w.deps.paths.state, "answers.jsonl"), `${JSON.stringify({ v: 1, t: "outcome", request_id: "r1", item: "i", task: "stock-webhook-9c2e", key: "stock-webhook-9c2e", from: "mac", at: w.now.t, outcome: "delivered" })}\n`);
    await readOnce(w.deps, second, 0);
    expect(w.calls().filter((c) => c.startsWith("fm-inbox.sh"))).toEqual(["fm-inbox.sh receipts"]);
    expect(w.lines).not.toContain("companion: receipts unread");
    const noReceipts: Deps = { ...w.deps, fm: { run: async (c, l) => (c.script === "fm-inbox.sh" ? { exit: 2, timed_out: false, stdout: "", stderr_first: null } : w.deps.fm.run(c, l)) } };
    await readOnce(noReceipts, second, 0);
    expect(w.lines).toContain("companion: receipts unread");
  });

  test("a second reading within the gap asks gh nothing and keeps the last answers", async () => {
    const w = world({ clones: false });
    const first = await readOnce(w.deps, null, 0);
    w.now.t += 20_000;
    const second = await readOnce(w.deps, first, 0);
    expect(w.gh).toEqual([PR_90, PR_91]);
    expect(second.prs).toEqual(first.prs);
    w.now.t += 45_000;
    await readOnce(w.deps, second, 0);
    expect(w.gh).toEqual([PR_90, PR_91, PR_90, PR_91]);
  });

  test("capacity runs only behind the gate, at most every 30 s, and never with a quota-provider", async () => {
    const w = world({ clones: false });
    const count = () => w.calls().filter((c) => c.startsWith("fm-capacity.sh")).length;
    writeConfig(w.home, "lane-capacity", "4\n");
    const a = await readOnce(w.deps, null, 0);
    expect(count()).toBe(1);
    expect(w.calls()).toContain("fm-capacity.sh --json");
    w.now.t += 10_000;
    const b = await readOnce(w.deps, a, 0);
    expect(count()).toBe(1);
    expect(b.capacity).toEqual(a.capacity);
    w.now.t += 30_000;
    const c = await readOnce(w.deps, b, 0);
    expect(count()).toBe(2);
    writeConfig(w.home, "lane-capacity", "4\nquota-provider claude\n");
    w.now.t += 60_000;
    const d = await readOnce(w.deps, c, 0);
    expect(count()).toBe(2);
    expect(d.capacity).toBeNull();
  });

  test("with no Firstmate home nothing of Firstmate runs, and the reading says so", async () => {
    const root = mkdtempSync(join(tmpdir(), "kinas-run-"));
    const w = world({ clones: false });
    const deps = { ...w.deps, paths: companionPaths({ KINAS_COMPANION_ROOT: root }) };
    const r = await readOnce(deps, null, 0);
    expect(r).toMatchObject({ installed: false, snapshot: null, prs: [] });
    expect(w.calls()).toEqual([]);
    expect(w.gh).toEqual([]);
  });

  test("the review flag's git argv is the Mac's touches.rs, argv for argv; a name that is not a branch is never passed", () => {
    expect(branchArgs("/h/fm/projects/shop/.git", "fm/fix-login")).toEqual([
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "--git-dir=/h/fm/projects/shop/.git",
      "log",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "--name-only",
      "--format=",
      "-z",
      "refs/heads/fm/fix-login",
      "--not",
      "refs/remotes/origin/HEAD",
      "--",
    ]);
    expect(branchExistsArgs("/g/.git", "fm/x")).toEqual(["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "--git-dir=/g/.git", "rev-parse", "--verify", "--quiet", "refs/heads/fm/x^{commit}"]);
    for (const bad of ["", "-x", "--output=/tmp/x", "a..b", "/abs", "a//b", "a b", "a;b", "fm/x.", "fm/x/"]) expect(branchArgs("/g", bad)).toBeNull();
    expect(branchArgs("relative/.git", "fm/x")).toBeNull();
    // ADR 0029: on the VPS the base is the commit origin/HEAD named at launch, from Kinas's record; only a full commit.
    expect(branchArgs("/g/.git", "fm/x", "c".repeat(40))?.slice(-3)).toEqual(["--not", "c".repeat(40), "--"]);
    for (const bad of ["HEAD", "--all", "c".repeat(39), "C".repeat(40)]) expect(branchArgs("/g/.git", "fm/x", bad)).toBeNull();
  });

  test("ADR 0029: a local-only task's clone whose local default branch moved since launch is listed, until it lands", async () => {
    const w = world();
    const clone = join(w.home, "projects", "shop");
    const git = join(clone, ".git");
    mkdirSync(join(git, "refs", "heads"), { recursive: true });
    const at = (sha: string) => writeFileSync(join(git, "refs", "heads", "main"), `${sha}\n`);
    at("b".repeat(40));
    mkdirSync(w.deps.paths.workers, { recursive: true });
    const record = (id: string) =>
      writeFileSync(launchRecordFile(w.deps.paths.workers, id), JSON.stringify({ v: 1, worktree: "/wt", deny: [], firstmate_local: null, base: "a".repeat(40), local_branch: "main", local_commit: "b".repeat(40) }));
    for (const id of ["solo-9c2e", "pr-9c2e", "early-9c2e"]) record(id);
    const row = (id: string, mode: string, state: string) => ({ id, project: clone, mode, current_state: { state } });
    const fleet = (landed: boolean) =>
      JSON.stringify({
        backlog: { records: landed ? [{ structured: true, id: "solo-9c2e", state: "done" }] : [] },
        tasks: [row("solo-9c2e", "local-only", "done"), row("pr-9c2e", "direct-PR", "done"), row("early-9c2e", "local-only", "working")],
      });
    let snap = fleet(false);
    w.deps.fm = { run: async (call) => (call.script === "fm-fleet-snapshot.sh" ? { exit: 0, timed_out: false, stdout: snap, stderr_first: null } : { exit: 1, timed_out: false, stdout: "", stderr_first: null }) };
    expect((await readOnce(w.deps, null, 0)).local_moved).toEqual([]);
    // Something moved local main (another landing, or a worker): the done local-only task is listed; the PR one and the
    // one still working are not.
    at("d".repeat(40));
    expect((await readOnce(w.deps, null, 0)).local_moved).toEqual([{ task: "solo-9c2e", branch: "main", was: "b".repeat(40), now: "d".repeat(40) }]);
    snap = fleet(true);
    expect((await readOnce(w.deps, null, 0)).local_moved).toEqual([]);
  });

  test("a task's branch is read from its clone's git folder: once a gap, kept while not done, and not while not made", async () => {
    const w = world();
    const clone = join(w.home, "projects", "shop-9c2e");
    mkdirSync(join(clone, ".git"), { recursive: true });
    const snap = JSON.stringify({
      backlog: { records: [] },
      tasks: [
        { id: "hook-9c2e", branch: "fm/hook", project: clone, current_state: { state: "working" } },
        { id: "later-9c2e", branch: "fm/later", project: clone, current_state: { state: "working" } },
        { id: "away-9c2e", branch: "fm/away", project: "/elsewhere/shop", current_state: { state: "working" } },
        { id: "bad-9c2e", branch: "--all", project: clone, current_state: { state: "working" } },
      ],
    });
    writeFileSync(join(w.home, "state", "snapshot.json"), snap);
    const git: string[][] = [];
    w.deps.fm = { run: async (call) => (call.script === "fm-fleet-snapshot.sh" ? { exit: 0, timed_out: false, stdout: snap, stderr_first: null } : { exit: 1, timed_out: false, stdout: "", stderr_first: null }) };
    w.deps.git = async (args) => {
      git.push(args);
      const hook = args.some((a) => a.startsWith("refs/heads/fm/hook"));
      return hook ? { exit: 0, timed_out: false, stdout: "\0.claude/settings.json\0", stderr_first: null } : { exit: 128, timed_out: false, stdout: "", stderr_first: "fatal" };
    };
    const r = await readOnce(w.deps, null, 0);
    expect(r.branches).toEqual([{ task: "hook-9c2e", checked_at: w.now.t, out: { exit: 0, timed_out: false, stdout: "\0.claude/settings.json\0", stderr_first: null } }]);
    // The clone's git folder, never the worktree; only the two names that are branches under the projects folder.
    expect(git.map((a) => a[4])).toEqual([`--git-dir=${join(clone, ".git")}`, `--git-dir=${join(clone, ".git")}`, `--git-dir=${join(clone, ".git")}`]);
    git.length = 0;
    w.now.t += 1_000;
    expect((await readOnce(w.deps, r, 0)).branches).toEqual(r.branches);
    expect(git.filter((a) => a.includes("log"))).toEqual([branchArgs(join(clone, ".git"), "fm/later")!]);
  });

  test("ADR 0028: a reported task's worktree is scanned as files until it lands, once a gap, against its clone's checkout and Kinas's launch record", async () => {
    const w = world();
    const clone = join(w.home, "projects", "shop-9c2e");
    mkdirSync(join(clone, ".git"), { recursive: true });
    mkdirSync(join(clone, ".claude"), { recursive: true });
    writeFileSync(join(clone, ".claude", "notes.md"), "the repository's own\n");
    const root = realpathSync(mkdtempSync(join(tmpdir(), "kinas-th-")));
    const wt = join(root, "treehouse", "shop-9c2e", "1", "shop-9c2e");
    mkdirSync(join(wt, ".claude"), { recursive: true });
    mkdirSync(join(wt, "sub"), { recursive: true });
    writeFileSync(join(wt, ".claude", "notes.md"), "the repository's own\n");
    writeFileSync(join(wt, ".claude", "settings.local.json"), '{"hooks":{}}\n');
    writeFileSync(join(wt, "sub", ".mcp.json"), "{}");
    // Kinas's launch record names the folder and Firstmate's file as the launch saw them.
    mkdirSync(w.deps.paths.workers, { recursive: true });
    writeFileSync(launchRecordFile(w.deps.paths.workers, "planted-9c2e"), JSON.stringify({ v: 1, worktree: wt, deny: [], firstmate_local: firstmateLocal(wt) }));
    const row = (id: string, state: string, worktree: string) => ({ id, project: clone, current_state: { state }, paths: { worktree: { path: worktree, present: true } } });
    // As measured: the worker's own report is the status log's last event while the row still reads the pane as busy.
    const reportedBusy = (id: string, worktree: string) => ({
      id,
      project: clone,
      current_state: { state: "working", source: "pane", detail: "harness busy (fm-spawn)" },
      paths: { worktree: { path: worktree, present: true }, status_log: { present: true, kind: "event_history", last_event: { state: "done", note: "ready in branch fm/x" } } },
    });
    const fleet = (planted: string, landed = false) =>
      JSON.stringify({
        backlog: { records: [{ structured: true, id: "landed-9c2e", state: "done" }, ...(landed ? [{ structured: true, id: "planted-9c2e", state: "done" }] : [])] },
        tasks: [
          row("planted-9c2e", planted, "/the/row/says/elsewhere"),
          row("working-9c2e", "working", wt),
          row("landed-9c2e", "done", wt),
          row("gone-9c2e", "done", join(root, "torn-down")),
          row("odd-9c2e", "done", "relative/wt"),
          reportedBusy("busy-9c2e", join(root, "torn-down")),
        ],
      });
    let snap = fleet("done");
    w.deps.fm = { run: async (call) => (call.script === "fm-fleet-snapshot.sh" ? { exit: 0, timed_out: false, stdout: snap, stderr_first: null } : { exit: 1, timed_out: false, stdout: "", stderr_first: null }) };
    const r = await readOnce(w.deps, null, 0);
    expect(r.worktrees).toEqual([
      { task: "busy-9c2e", checked_at: w.now.t, red: [], count: 0, unknown: false },
      { task: "gone-9c2e", checked_at: w.now.t, red: [], count: 0, unknown: false },
      { task: "odd-9c2e", checked_at: w.now.t, red: [], count: 0, unknown: true },
      { task: "planted-9c2e", checked_at: w.now.t, red: ["sub/.mcp.json"], count: 1, unknown: false },
    ]);
    // Within the gap the last answer stands; after it, scanned again even once the row has moved on from done.
    writeFileSync(join(wt, ".claude", "skills.md"), "planted after the report");
    w.now.t += 1_000;
    expect((await readOnce(w.deps, r, 0)).worktrees).toEqual(r.worktrees);
    snap = fleet("paused");
    w.now.t += 60_000;
    const later = await readOnce(w.deps, r, 0);
    expect(later.worktrees?.find((x) => x.task === "planted-9c2e")?.red).toEqual([".claude/skills.md", "sub/.mcp.json"]);
    // Landed: no longer scanned, and gone from the reading.
    snap = fleet("paused", true);
    w.now.t += 60_000;
    expect((await readOnce(w.deps, later, 0)).worktrees?.map((x) => x.task)).toEqual(["busy-9c2e", "gone-9c2e", "odd-9c2e"]);
  });

  test("tasksOf merges a record and a row as parse_fleet does; duePrs keeps done work's PR only while it was open", () => {
    const tasks = tasksOf(readFileSync(join(FIXTURES, "firstmate-fleet-snapshot.current.synthetic.json"), "utf8"));
    expect(tasks.filter((t) => t.pr).map(({ id, pr, done }) => ({ id, pr, done }))).toEqual([
      { id: "stock-webhook-9c2e", pr: PR_91, done: false },
      { id: "harbor-review-9c2e", pr: PR_90, done: false },
    ]);
    expect(tasksOf("not json")).toEqual([]);
    const out = (state: string) => ({ exit: 0, timed_out: false, stdout: JSON.stringify({ state }), stderr_first: null });
    const done = [{ id: "t", pr: PR_91, done: true }];
    expect(duePrs(done, [], 100)).toEqual([]);
    expect(duePrs(done, [{ url: PR_91, checked_at: 0, out: out("OPEN") }], 100_000)).toEqual([PR_91]);
    expect(duePrs(done, [{ url: PR_91, checked_at: 0, out: out("MERGED") }], 100_000)).toEqual([]);
    // A stamp in what is now the future (the clock stepped back) has had its gap.
    expect(duePrs([{ id: "t", pr: PR_91, done: false }], [{ url: PR_91, checked_at: 200_000, out: out("OPEN") }], 100_000)).toEqual([PR_91]);
    expect(duePrs([{ id: "t", pr: "https://github.com/o/r/issues/3", done: false }], [], 0)).toEqual([]);
  });

  test("prUrlOk and originUrl read as the Mac's snapshot::pr_url_ok and repo::origin_url", () => {
    expect(prUrlOk(PR_91)).toBe(true);
    for (const bad of ["https://github.com/o/r/pull/", "https://github.com/o/r/pull/1/files", "http://github.com/o/r/pull/1", "https://github.com//r/pull/1"]) expect(prUrlOk(bad)).toBe(false);
    expect(originUrl('[core]\n\tbare = false\n[Remote "origin"]\n\turl = "https://github.com/o/r.git"\n')).toBe("https://github.com/o/r.git");
    expect(originUrl('[remote "upstream"]\n\turl = x\n')).toBeNull();
    expect(originUrl('[remote "origin"]\n\tfetch = +refs/heads/*\n')).toBeNull();
  });

  test("a worktree's .git file is followed to the repository's shared config", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "kinas-wt-")));
    mkdirSync(join(root, "repo", ".git", "worktrees", "w1"), { recursive: true });
    writeFileSync(join(root, "repo", ".git", "config"), '[remote "origin"]\n\turl = git@github.com:o/r.git\n');
    writeFileSync(join(root, "repo", ".git", "worktrees", "w1", "commondir"), "../..\n");
    mkdirSync(join(root, "w1"));
    writeFileSync(join(root, "w1", ".git"), `gitdir: ${join(root, "repo", ".git", "worktrees", "w1")}\n`);
    expect(cloneOrigin(join(root, "w1"))).toBe("git@github.com:o/r.git");
    expect(cloneOrigin(join(root, "nothing"))).toBeNull();
  });
});


describe("this machine's own readings (slice 5.1)", () => {
  test("the plan hand-off, the host and the token counts ride in the reading, with Firstmate there or not", async () => {
    const w = world();
    const { paths } = w.deps;
    const put = (path: string, text: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    };
    const session = "0f3a9c2e-1b2c-4d5e-8f90-123456789abc";
    const handoff = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12 } }, session_id: session, captured_at: w.now.t });
    put(join(paths.state, "claude-rate-limits.json"), handoff);
    const line = (ts: string) =>
      JSON.stringify({ type: "assistant", timestamp: ts, message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 2 } } });
    put(join(paths.claudeHome, "projects", "-home-claude-projects-shop", `${session}.jsonl`), `${line(new Date(w.now.t - 60_000).toISOString())}\n`);
    put(join(paths.proc, "stat"), "cpu  100 0 100 700 100 0 0 0 0 0\n");
    put(join(paths.proc, "meminfo"), "MemTotal:       8192000 kB\nMemAvailable:   2048000 kB\n");

    const first = await readOnce(w.deps, null, 0);
    expect(first.plan).toEqual({ text: handoff, file_at: expect.any(Number), last_assistant_at: w.now.t - 60_000 });
    expect(first.host?.cpu_pct).toBeNull();
    expect(first.host?.mem_total_gb).toBeCloseTo(8192000 / 1024 / 1024, 6);
    expect(first.usage?.rows.map((r) => [r.model, r.messages])).toEqual([["claude-opus-5-5", 1]]);
    expect(w.lines.some((l) => /^companion: recount 1 rows in \d+ ms$/.test(l))).toBe(true);

    // The next reading compares CPU counters with this one's, and keeps the count within its gap.
    put(join(paths.proc, "stat"), "cpu  150 0 150 750 100 0 0 0 0 0\n");
    w.now.t += 15_000;
    const second = await readOnce(w.deps, first, 0);
    expect(second.host?.cpu_pct).toBe(66.7);
    expect(second.usage).toEqual(first.usage);

    // Without Firstmate the readings are still there.
    rmSync(join(w.home, "bin"), { recursive: true, force: true });
    const bare = await readOnce(w.deps, second, 0);
    expect(bare.installed).toBe(false);
    expect(bare.plan?.text).toBe(handoff);
    expect(bare.usage).toEqual(first.usage);
  });
});
