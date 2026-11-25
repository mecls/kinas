import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeHome, writeConfig } from "../../../e2e/fake-firstmate/make.ts";
import { firstmate, type ScriptOut } from "./firstmate.ts";
import { companionPaths } from "./paths.ts";
import { cloneOrigin, duePrs, originUrl, prUrlOk, readOnce, tasksOf, type Deps } from "./run.ts";

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

  test("tasksOf merges a record and a row as parse_fleet does; duePrs keeps done work's PR only while it was open", () => {
    const tasks = tasksOf(readFileSync(join(FIXTURES, "firstmate-fleet-snapshot.current.synthetic.json"), "utf8"));
    expect(tasks.filter((t) => t.pr)).toEqual([
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

