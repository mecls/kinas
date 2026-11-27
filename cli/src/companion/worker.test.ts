import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fakeMachine } from "./fake-machine.ts";
import { fakeProc, HOST_NS, SANDBOX_NS, type FakeProc } from "./fake-proc.ts";
import { install } from "./install.ts";
import { companionPaths, type Paths } from "./paths.ts";
import { checks, HERDR_UNIT, UNIT_HEADER, type Check, type SetupDeps } from "./setup.ts";
import {
  answersMayFlow,
  crewHarness,
  HELPER,
  helperText,
  isToolCommand,
  launchedByWrapper,
  looseningKeys,
  MARKER,
  mergeSettings,
  ownFolder,
  REFUSED_EXIT,
  RESERVED_READS,
  settingsArg,
  settingsFile,
  settingsText,
  sha256,
  tokenDir,
  workerCheck,
  workerLaunch,
  workerPolicy,
  wrapperText,
  type WorkerDeps,
} from "./worker.ts";
import { launchRecordFile, readLaunchRecord, EXCLUDE_HEADER } from "./plants.ts";
import { readWritten } from "./written.ts";

// Firstmate's workers in Claude Code's sandbox (ADR 0027; build spec §12 slices 4.9–4.10).

/** Firstmate 427056c's worker settings, as fm-spawn.sh writes them inline (bin/fm-spawn.sh:7567). */
const FM_SETTINGS = '{"feedbackDrafts":"off","attribution":{"commit":"","pr":"","sessionUrl":false}}';
/** A worker's argv as Firstmate types it after `claude` (the launch template, bin/fm-spawn.sh:2927). */
const FM_ARGV = ["--dangerously-skip-permissions", "--add-dir", "/h/fm/state/operational-inbox", "--settings", FM_SETTINGS, "--append-system-prompt", "You are task t1.\nReport with 'fm-…'.", "the brief"];

describe("the policy (as approved, with the captain's conditions)", () => {
  const DENY = ["/wt/.claude", "/wt/.mcp.json", "/wt/packages/x/.mcp.json"];
  const policy = workerPolicy({ home: "/home/claude/.local/share/kinas/firstmate", id: "t1", uid: 1001, tmp: "/tmp", deny: DENY, workers: "/home/claude/.local/state/kinas/workers", wrapperDir: "/home/claude/.local/share/kinas/bin" }) as {
    permissions: { blockWritesOutsideWorkingDirectories: boolean; deny: string[] };
    sandbox: {
      enabled: boolean;
      failIfUnavailable: boolean;
      allowUnsandboxedCommands: boolean;
      filesystem: { allowWrite: string[]; denyWrite: string[]; denyRead: string[]; allowRead: string[] };
      network: { allowedDomains: string[]; strictAllowlist: boolean };
    };
    env: Record<string, string>;
  };

  test("the sandbox is required, nothing runs outside it, and the one extra write is the task's own status file", () => {
    expect(policy.sandbox.enabled).toBe(true);
    expect(policy.sandbox.failIfUnavailable).toBe(true);
    expect(policy.sandbox.allowUnsandboxedCommands).toBe(false);
    // ADR 0029: and its own temp folder, eight hex of its task id's sha256 under /tmp/kw.
    expect(policy.sandbox.filesystem.allowWrite).toEqual(["/home/claude/.local/share/kinas/firstmate/state/t1.status", "/tmp/kw/628b49d9"]);
    // ADR 0028: the launch's `.claude` and `.mcp.json` paths, denied to every command the worker runs, by exact path.
    expect(policy.sandbox.filesystem.denyWrite).toEqual(DENY);
    expect(policy.permissions.blockWritesOutsideWorkingDirectories).toBe(true);
  });

  test("the hosts are GitHub and the npm, crates and PyPI registries, and nothing else is asked about", () => {
    expect(policy.sandbox.network).toEqual({
      allowedDomains: ["github.com", "api.github.com", "registry.npmjs.org", "index.crates.io", "static.crates.io", "crates.io", "pypi.org", "files.pythonhosted.org"],
      strictAllowlist: true,
    });
  });

  test("the denies: Claude Code's records, the first mate's temp folder, the captain's reserved paths, Firstmate's shared folders, .claude and .mcp.json", () => {
    const deny = policy.permissions.deny;
    for (const p of ["~/.claude/projects/**", "~/.claude/history.jsonl", "~/.claude/.credentials.json", "~/.claude.json", "~/.config/herdr/**"]) expect(deny).toContain(`Read(${p})`);
    expect(deny).toContain("Read(//tmp/claude-1001/-home-claude--local-share-kinas-firstmate/**)");
    expect(deny).toContain("Edit(//tmp/claude-1001/-home-claude--local-share-kinas-firstmate/**)");
    // The captain's list, always in full: ~/vault, ~/.config/last30days/ and ~/.config/brain/ among it.
    for (const p of RESERVED_READS) expect(deny).toContain(`Read(${p})`);
    for (const p of ["~/vault/**", "~/.config/last30days/**", "~/.config/brain/**", "~/.local/share/com.vercel.cli/**", "~/.config/obsidian-headless/**", "~/.local/state/kinas/**", "~/backups/**"]) {
      expect(deny).toContain(`Read(${p})`);
    }
    expect(deny).toContain("Edit(//home/claude/.local/share/kinas/firstmate/.agents/**)");
    expect(deny).toContain("Edit(//home/claude/.local/share/kinas/firstmate/state/operational-inbox/**)");
    expect(deny).toContain("Edit(**/.mcp.json)");
    expect(deny).toContain("Edit(**/.claude/**)");
    // ADR 0029 (superseding "the git key and gh stay readable"): the key, gh's login, git's other stores, the App's key.
    for (const p of ["~/.ssh/**", "~/.config/gh/**", "~/.git-credentials", "~/.config/git/credentials", "~/.netrc", "~/.local/state/kinas/github-app/**"]) expect(deny).toContain(`Read(${p})`);
  });

  test("ADR 0029: every worker's temp folder and the shared one hidden; its own temp folder and token folder given back", () => {
    expect(policy.sandbox.filesystem.denyRead).toEqual(["/tmp/kw", "/tmp/claude-1001"]);
    expect(policy.sandbox.filesystem.allowRead).toEqual(["/home/claude/.local/state/kinas/workers/t1", "/tmp/kw/628b49d9"]);
  });

  test("each package manager's cache is the worker's own; git and gh use its token only (ADR 0029)", () => {
    expect(policy.env).toEqual({
      npm_config_cache: "/tmp/kw/628b49d9/cache/npm",
      BUN_INSTALL_CACHE_DIR: "/tmp/kw/628b49d9/cache/bun",
      PIP_CACHE_DIR: "/tmp/kw/628b49d9/cache/pip",
      UV_CACHE_DIR: "/tmp/kw/628b49d9/cache/uv",
      CARGO_HOME: "/tmp/kw/628b49d9/cache/cargo",
      GIT_CONFIG_COUNT: "5",
      GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf",
      GIT_CONFIG_VALUE_0: "git@github.com:",
      GIT_CONFIG_KEY_1: "url.https://github.com/.insteadOf",
      GIT_CONFIG_VALUE_1: "ssh://git@github.com/",
      GIT_CONFIG_KEY_2: "credential.helper",
      GIT_CONFIG_VALUE_2: "",
      GIT_CONFIG_KEY_3: "credential.https://github.com.helper",
      GIT_CONFIG_VALUE_3: "",
      GIT_CONFIG_KEY_4: "credential.https://github.com.helper",
      GIT_CONFIG_VALUE_4: "!'/home/claude/.local/share/kinas/bin/kinas-git-credential' '/home/claude/.local/state/kinas/workers/t1/token'",
      GIT_TERMINAL_PROMPT: "0",
      GH_CONFIG_DIR: "/home/claude/.local/state/kinas/workers/t1/gh",
      GH_PROMPT_DISABLED: "1",
    });
  });
});

describe("Firstmate's arguments and settings", () => {
  test("mergeSettings keeps Firstmate's own keys and puts the policy over them", () => {
    const policy = { sandbox: { enabled: true } };
    expect(mergeSettings(FM_SETTINGS, policy)).toEqual({ settings: { feedbackDrafts: "off", attribution: { commit: "", pr: "", sessionUrl: false }, sandbox: { enabled: true } } });
    expect(mergeSettings('{"model":"opus","effortLevel":"high"}', policy)).toEqual({ settings: { model: "opus", effortLevel: "high", sandbox: { enabled: true } } });
  });

  test("mergeSettings refuses any other key, and anything that is not an inline JSON object", () => {
    for (const key of ["permissions", "hooks", "sandbox", "env", "enabledPlugins", "mcpServers"]) {
      expect(mergeSettings(JSON.stringify({ feedbackDrafts: "off", [key]: {} }), {})).toEqual({ refused: `Firstmate's --settings carries ${key}, which Kinas does not pass to a sandboxed worker` });
    }
    expect(mergeSettings("/h/fm/state/t1.claude-settings.json", {})).toEqual({ refused: "Firstmate's --settings is not inline JSON" });
    expect(mergeSettings("[]", {})).toEqual({ refused: "Firstmate's --settings is not a JSON object" });
  });

  test("settingsArg: exactly one --settings with its value apart; no flag that loads more", () => {
    expect(settingsArg(FM_ARGV)).toEqual({ value: FM_SETTINGS });
    expect(settingsArg(["--settings", "a", "--settings", "b"])).toEqual({ refused: "Firstmate passed --settings 2 times, not once" });
    expect(settingsArg(["x"])).toEqual({ refused: "Firstmate passed --settings 0 times, not once" });
    expect(settingsArg(["--settings={}"])).toEqual({ refused: "--settings is joined to its value" });
    expect(settingsArg(["--settings"])).toEqual({ refused: "--settings has no value" });
    for (const f of ["--setting-sources", "--mcp-config", "--strict-mcp-config", "--plugin-dir", "--mcp-config=x.json"]) {
      expect(settingsArg([...FM_ARGV, f, "x"])).toEqual({ refused: `Firstmate passed ${f.split("=")[0]}` });
    }
  });
});

/** A test root as worker-launch sees it: Firstmate's home with its state folder, Node with the seccomp helper. */
function world(opts: { helper?: boolean; tools?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kinas-worker-")));
  const paths = companionPaths({ KINAS_COMPANION_ROOT: root });
  mkdirSync(join(paths.home, ".git"), { recursive: true });
  mkdirSync(join(paths.home, "state"), { recursive: true });
  const node = join(root, "node", "bin");
  mkdirSync(node, { recursive: true });
  if (opts.helper ?? true) {
    const dir = join(node, "..", "lib", "node_modules", "@anthropic-ai", "sandbox-runtime", "vendor", "seccomp", "x64");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "apply-seccomp"), "");
  }
  const tools = opts.tools ?? true;
  mkdirSync(paths.tmp, { recursive: true });
  const d: WorkerDeps = { paths, uid: 1001, home: join(root, "user"), node, arch: "x64", which: (n) => (tools ? `/usr/bin/${n}` : null) };
  let n = 0;
  /**
   * A worktree of a clone under <home>/projects/, as Treehouse makes them: the worktree's `.git` is a file. The clone's
   * origin/HEAD names origin/main (packed), and its local main is one commit behind.
   */
  const worktree = (name = "shop") => {
    const git = join(paths.home, "projects", name, ".git");
    n += 1;
    mkdirSync(join(git, "worktrees", String(n)), { recursive: true });
    mkdirSync(join(git, "refs", "remotes", "origin"), { recursive: true });
    mkdirSync(join(git, "refs", "heads"), { recursive: true });
    writeFileSync(join(git, "config"), '[remote "origin"]\n\turl = git@github.com:mecls/shop.git\n');
    writeFileSync(join(git, "refs", "remotes", "origin", "HEAD"), "ref: refs/remotes/origin/main\n");
    writeFileSync(join(git, "packed-refs"), `# pack-refs with: peeled fully-peeled sorted\n${"a".repeat(40)} refs/remotes/origin/main\n`);
    writeFileSync(join(git, "refs", "heads", "main"), `${"b".repeat(40)}\n`);
    writeFileSync(join(git, "worktrees", String(n), "commondir"), "../..\n");
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "kinas-wt-")));
    writeFileSync(join(cwd, ".git"), `gitdir: ${git}/worktrees/${n}\n`);
    return cwd;
  };
  return { root, paths, d, worktree };
}

describe("worker-launch", () => {
  test("writes the worker's settings (0600, policy over Firstmate's keys), makes its status file, and answers the file and its SHA-256", () => {
    const { paths, d, worktree } = world();
    const cwd = worktree();
    const out = workerLaunch(d, {}, "t1", cwd, FM_ARGV);
    if ("refused" in out) throw new Error(out.refused);
    expect(out.file).toBe(settingsFile(paths, "t1"));
    // ADR 0029: its own temp folder, made 700 under <tmp>/kw (700), answered for the wrapper's CLAUDE_CODE_TMPDIR.
    expect(out.tmp).toBe(join(paths.tmp, "kw", "628b49d9"));
    expect(statSync(out.tmp).mode & 0o777).toBe(0o700);
    expect(statSync(join(paths.tmp, "kw")).mode & 0o777).toBe(0o700);
    const text = readFileSync(out.file, "utf8");
    expect(out.sha256).toBe(sha256(text));
    expect(statSync(out.file).mode & 0o777).toBe(0o600);
    const doc = JSON.parse(text);
    expect(doc.feedbackDrafts).toBe("off");
    const deny = [`${cwd}/.claude`, `${cwd}/.mcp.json`];
    const of = { home: paths.home, id: "t1", uid: 1001, tmp: paths.tmp, deny, workers: paths.workers, wrapperDir: paths.wrapperDir };
    expect(doc.sandbox).toEqual(workerPolicy(of).sandbox);
    expect(text).toBe(settingsText({ feedbackDrafts: "off", attribution: { commit: "", pr: "", sessionUrl: false }, ...workerPolicy(of) }));
    // The launch record, Kinas's own and out of the worker's reach: the folder, the denies, Firstmate's file (none here);
    // ADR 0029: its temp folder, origin/HEAD's commit (the review flag's base), the local default branch and its commit.
    expect(readLaunchRecord(launchRecordFile(paths.workers, "t1"))).toEqual({
      v: 1,
      worktree: cwd,
      deny,
      firstmate_local: null,
      tmp: out.tmp,
      base: "a".repeat(40),
      local_branch: "main",
      local_commit: "b".repeat(40),
    });
    expect(statSync(launchRecordFile(paths.workers, "t1")).mode & 0o777).toBe(0o600);
    expect(statSync(join(paths.home, "state", "t1.status")).isFile()).toBe(true);
    // A status file Firstmate already wrote is appended to, never emptied.
    writeFileSync(join(paths.home, "state", "t1.status"), "working\n");
    // A respawn under the same task id keeps its own temp folder (build spec §12 5b, for the captain).
    writeFileSync(join(out.tmp, "kept"), "x");
    expect("refused" in workerLaunch(d, {}, "t1", cwd, FM_ARGV)).toBe(false);
    expect(readFileSync(join(out.tmp, "kept"), "utf8")).toBe("x");
    expect(readFileSync(join(paths.home, "state", "t1.status"), "utf8")).toBe("working\n");
  });

  test("ADR 0029, run by real git: the policy's credential config answers github.com with the worker's own token, and nothing else", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "kinas-cred- '")));
    const wrapperDir = join(base, "bin dir");
    const tokens = join(base, "workers", "t1");
    mkdirSync(wrapperDir, { recursive: true });
    mkdirSync(tokens, { recursive: true });
    writeFileSync(join(wrapperDir, HELPER), helperText(), { mode: 0o755 });
    writeFileSync(join(tokens, "token"), "ghs_abcdefghijklmnop0123", { mode: 0o600 });
    const env = (workerPolicy({ home: join(base, "fm"), id: "t1", uid: 1001, tmp: "/tmp", deny: [], wrapperDir, workers: join(base, "workers") }) as { env: Record<string, string> }).env;
    // An inherited helper (the shared login's) is emptied first; git reads no global or system config here.
    const run = (url: string, extra: Record<string, string> = {}) =>
      spawnSync("git", ["-c", "credential.helper=!echo password=leaked", "credential", "fill"], {
        input: `url=${url}\n\n`,
        env: { PATH: process.env.PATH, HOME: base, GIT_CONFIG_NOSYSTEM: "1", ...env, ...extra },
        encoding: "utf8",
      });
    const gh = run("https://github.com/mecls/shop.git");
    expect(gh.stdout).toContain("username=x-access-token\npassword=ghs_abcdefghijklmnop0123\n");
    expect(gh.stdout).not.toContain("leaked");
    // Another host gets nothing from Kinas, and no prompt: git fails rather than ask.
    const other = run("https://gitlab.com/mecls/shop.git");
    expect(other.status).not.toBe(0);
    expect(other.stdout).not.toContain("ghs_");
    // GitHub's ssh remotes are rewritten to https.
    const rewritten = spawnSync("git", ["ls-remote", "--get-url", "git@github.com:mecls/shop.git"], { env: { PATH: process.env.PATH, HOME: base, GIT_CONFIG_NOSYSTEM: "1", ...env }, encoding: "utf8" });
    expect(rewritten.stdout.trim()).toBe("https://github.com/mecls/shop.git");
  });

  test("ADR 0030: a respawn keeps a real folder of this user's, mode 700; anything else at the name refuses, untouched", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "kinas-own-")));
    const at = (n: string) => join(base, n);
    expect(ownFolder(at("new"))).toBe("made");
    expect(statSync(at("new")).mode & 0o777).toBe(0o700);
    expect(ownFolder(at("new"))).toBe("kept");
    mkdirSync(at("open"), { mode: 0o755 });
    chmodSync(at("open"), 0o755);
    expect(ownFolder(at("open"))).toEqual({ refused: `${at("open")} isn't this user's alone` });
    expect(statSync(at("open")).mode & 0o777).toBe(0o755);
    writeFileSync(at("file"), "x");
    expect(ownFolder(at("file"))).toEqual({ refused: `${at("file")} isn't a plain folder` });
    symlinkSync(at("new"), at("link"));
    expect(ownFolder(at("link"))).toEqual({ refused: `${at("link")} isn't a plain folder` });
    // Another user's folder, as this user reads it.
    expect(ownFolder(at("new"), process.getuid!() + 1)).toEqual({ refused: `${at("new")} isn't this user's alone` });
  });

  test("ADR 0028: every .claude and .mcp.json in the folder, at any depth, is denied by path, the root's always", () => {
    const { paths, d, worktree } = world();
    const cwd = worktree();
    for (const dir of [".claude", "packages/x/.claude/skills", "node_modules/y", "deep/a/b"]) mkdirSync(join(cwd, dir), { recursive: true });
    writeFileSync(join(cwd, ".claude", "settings.local.json"), '{"hooks":{}}\n');
    writeFileSync(join(cwd, "packages/x/.claude/skills/SKILL.md"), "x");
    writeFileSync(join(cwd, "node_modules/y/.mcp.json"), "{}");
    writeFileSync(join(cwd, "deep/a/b/.mcp.json"), "{}");
    symlinkSync("/tmp", join(cwd, "deep/a/.claude"));
    const out = workerLaunch(d, {}, "t1", cwd, FM_ARGV);
    if ("refused" in out) throw new Error(out.refused);
    const doc = JSON.parse(readFileSync(out.file, "utf8"));
    const want = [".claude", ".mcp.json", "deep/a/.claude", "deep/a/b/.mcp.json", "node_modules/y/.mcp.json", "packages/x/.claude"].map((p) => `${cwd}/${p}`);
    expect(doc.sandbox.filesystem.denyWrite).toEqual(want);
    const record = readLaunchRecord(launchRecordFile(paths.workers, "t1"));
    expect(record?.deny).toEqual(want);
    // Firstmate's hooks file, as it was when the worker started: the scan accepts exactly that file there later.
    expect(record?.firstmate_local).toBe(sha256('{"hooks":{}}\n'));
  });

  test("ADR 0028: a folder the walk can't finish refuses the worker", () => {
    const { d } = world();
    const cwd = mkdtempSync(join(tmpdir(), "kinas-wt-"));
    mkdirSync(join(cwd, "locked"));
    chmodSync(join(cwd, "locked"), 0o000);
    try {
      expect(workerLaunch(d, {}, "t1", cwd, FM_ARGV)).toEqual({ refused: "the worker's folder can't be checked for .claude and .mcp.json (locked can't be read)" });
    } finally {
      chmodSync(join(cwd, "locked"), 0o755);
    }
  });

  test("ADR 0028: the sandbox's placeholders missing from the worktree go into the clone's info/exclude, once, beside Firstmate's own line", () => {
    const { paths, d } = world();
    // A clone under <home>/projects/ and a worktree of it, as Treehouse makes them: the worktree's `.git` is a file.
    const git = join(paths.home, "projects", "shop", ".git");
    mkdirSync(join(git, "worktrees", "1"), { recursive: true });
    mkdirSync(join(git, "info"), { recursive: true });
    writeFileSync(join(git, "info", "exclude"), "# git's own\n.claude/settings.local.json\n");
    writeFileSync(join(git, "worktrees", "1", "commondir"), "../..\n");
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "kinas-wt-")));
    writeFileSync(join(cwd, ".git"), `gitdir: ${git}/worktrees/1\n`);
    mkdirSync(join(cwd, ".claude"));
    writeFileSync(join(cwd, ".claude", "settings.json"), "{}");
    writeFileSync(join(cwd, ".bashrc"), "# the repository's own");
    expect("refused" in workerLaunch(d, {}, "t1", cwd, FM_ARGV)).toBe(false);
    const text = readFileSync(join(git, "info", "exclude"), "utf8");
    const lines = text.split("\n");
    expect(lines.slice(0, 3)).toEqual(["# git's own", ".claude/settings.local.json", EXCLUDE_HEADER]);
    // The paths present are left alone: .claude itself, its settings.json, the repository's .bashrc.
    for (const l of ["/.claude", "/.claude/settings.json", "/.bashrc"]) expect(lines).not.toContain(l);
    for (const l of ["/.claude/hooks", "/.claude/skills", "/.mcp.json", "/.zshrc", "/.idea", "/.vscode", "/.gitmodules"]) expect(lines).toContain(l);
    // Again: nothing added twice.
    expect("refused" in workerLaunch(d, {}, "t1", cwd, FM_ARGV)).toBe(false);
    expect(readFileSync(join(git, "info", "exclude"), "utf8")).toBe(text);
    // A `.git` that points outside <home>/projects/ is not followed; since ADR 0029 that worker has no repository to be
    // given a token for, and doesn't start.
    const other = realpathSync(mkdtempSync(join(tmpdir(), "kinas-wt-")));
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "kinas-git-")));
    writeFileSync(join(other, ".git"), `gitdir: ${elsewhere}\n`);
    expect(workerLaunch(d, {}, "t2", other, FM_ARGV)).toEqual({ refused: "the worker's folder isn't a worktree of a Firstmate project" });
    expect(existsSync(join(elsewhere, "info", "exclude"))).toBe(false);
  });

  test("refuses, and writes nothing, for each thing that would not hold", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kinas-wt-"));
    const cases: [string, () => ReturnType<typeof workerLaunch>][] = [
      ["FM_TASK_ID is not a task id", () => workerLaunch(world().d, {}, "../x", cwd, FM_ARGV)],
      ["FM_TASK_ID is not a task id", () => workerLaunch(world().d, {}, "", cwd, FM_ARGV)],
      ["the worker's folder is not there", () => workerLaunch(world().d, {}, "t1", "/no/such/folder", FM_ARGV)],
      ["FM_HOME is not Kinas's Firstmate home", () => workerLaunch(world().d, { FM_HOME: "/elsewhere" }, "t1", cwd, FM_ARGV)],
      ["Firstmate passed --settings 0 times, not once", () => workerLaunch(world().d, {}, "t1", cwd, ["the brief"])],
      ["bwrap, socat missing: the sandbox would not hold", () => workerLaunch(world({ tools: false }).d, {}, "t1", cwd, FM_ARGV)],
      ["the seccomp helper missing: the sandbox would not hold", () => workerLaunch(world({ helper: false }).d, {}, "t1", cwd, FM_ARGV)],
      ["the worker's folder isn't a worktree of a Firstmate project", () => workerLaunch(world().d, {}, "t1", cwd, FM_ARGV)],
      [
        "Firstmate's --settings carries hooks, which Kinas does not pass to a sandboxed worker",
        () => {
          const f = world();
          return workerLaunch(f.d, {}, "t1", f.worktree(), ["--settings", '{"hooks":{}}']);
        },
      ],
      [
        "the worker's temp folder: a temp folder that is a link",
        () => {
          const f = world();
          const at = join(f.paths.tmp, "kw");
          symlinkSync(f.paths.tmp, at);
          const out = workerLaunch(f.d, {}, "t1", f.worktree(), FM_ARGV);
          return "refused" in out ? { refused: out.refused.replace(`${at} isn't a plain folder`, "a temp folder that is a link") } : out;
        },
      ],
    ];
    for (const [why, run] of cases) expect(run()).toEqual({ refused: why });
    const w = world();
    rmSync(join(w.paths.home, "state"), { recursive: true });
    expect(workerLaunch(w.d, {}, "t1", w.worktree(), FM_ARGV)).toEqual({ refused: "Firstmate's home has no state folder" });
    expect(existsSync(w.paths.workers)).toBe(false);
    // A status file that is a link is not followed.
    const v = world();
    symlinkSync("/etc/passwd", join(v.paths.home, "state", "t1.status"));
    expect(workerLaunch(v.d, {}, "t1", v.worktree(), FM_ARGV)).toEqual({ refused: "the task's status file can't be made" });
    expect(lstatSync(join(v.paths.home, "state", "t1.status")).isSymbolicLink()).toBe(true);
  });
});

describe("the wrapper, run by /bin/sh with stand-ins for Claude Code and Kinas", () => {
  /** Runs the real wrapper text; the stand-in Claude Code writes its argv and environment, NUL-separated. */
  async function runWrapper(argv: string[], env: Record<string, string>, kinasSays = "abc123\n/state/workers/t1.settings.json\n/tmp/kw/628b49d9\n", kinasExit = 0) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "kinas-wrap-")));
    const real = join(dir, "real-claude");
    const kinas = join(dir, "kinas");
    writeFileSync(real, `#!/bin/sh\nprintf '%s\\0' "$@" > '${dir}/real-args'\nenv -0 > '${dir}/real-env' 2>/dev/null || env > '${dir}/real-env'\n`);
    writeFileSync(kinas, `#!/bin/sh\nprintf '%s\\0' "$@" > '${dir}/kinas-args'\nprintf '${kinasSays.replace(/\n/g, "\\n")}'\nexit ${kinasExit}\n`);
    const wrapper = join(dir, "claude");
    writeFileSync(wrapper, wrapperText(real, kinas));
    for (const f of [real, kinas, wrapper]) chmodSync(f, 0o755);
    const wt = join(dir, "wt");
    mkdirSync(wt);
    const p = Bun.spawn(["/bin/sh", wrapper, ...argv], { cwd: wt, env: { PATH: "/usr/bin:/bin", ...env }, stdout: "pipe", stderr: "pipe" });
    const code = await p.exited;
    const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").split("\0").slice(0, -1) : null);
    const envOut = existsSync(join(dir, "real-env")) ? readFileSync(join(dir, "real-env"), "utf8") : null;
    return { code, stderr: await new Response(p.stderr).text(), realArgs: read("real-args"), kinasArgs: read("kinas-args"), env: envOut, wt };
  }

  test("without FM_TASK_ID it is Claude Code itself: the same argv, the same environment, Kinas not asked", async () => {
    const r = await runWrapper(["--resume", "a b"], { VERCEL_TOKEN: "kept" });
    expect(r.code).toBe(0);
    expect(r.realArgs).toEqual(["--resume", "a b"]);
    expect(r.kinasArgs).toBeNull();
    expect(r.env).toContain("VERCEL_TOKEN=kept");
    expect(r.env).not.toContain(MARKER);
  });

  test("a worker: Kinas's flags first, Firstmate's --settings value replaced by the file, every other argument as given", async () => {
    const r = await runWrapper(FM_ARGV, { FM_TASK_ID: "t1", VERCEL_TOKEN: "x", ANTHROPIC_API_KEY: "x", PARALLEL_API_KEY: "x", GH_TOKEN: "x", GITHUB_TOKEN: "x", SSH_AUTH_SOCK: "/tmp/agent.1", KEEP_ME: "1" });
    expect(r.code).toBe(0);
    expect(r.kinasArgs).toEqual(["companion", "worker-launch", "t1", r.wt, ...FM_ARGV]);
    expect(r.realArgs).toEqual([
      "--setting-sources",
      "user",
      "--strict-mcp-config",
      "--add-dir",
      r.wt,
      "--dangerously-skip-permissions",
      "--add-dir",
      "/h/fm/state/operational-inbox",
      "--settings",
      "/state/workers/t1.settings.json",
      "--append-system-prompt",
      "You are task t1.\nReport with 'fm-…'.",
      "the brief",
    ]);
    expect(launchedByWrapper(["claude", ...r.realArgs!], "/state/workers/t1.settings.json")).toBe(true);
    expect(r.env).toContain(`${MARKER}=abc123`);
    expect(r.env).toContain("CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1");
    expect(r.env).toContain("FM_TASK_ID=t1");
    expect(r.env).toContain("KEEP_ME=1");
    for (const k of ["VERCEL_TOKEN", "ANTHROPIC_API_KEY", "PARALLEL_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "SSH_AUTH_SOCK"]) expect(r.env).not.toContain(`${k}=`);
    // ADR 0029: Claude Code's temp folder is the worker's own, as Kinas answered it.
    expect(r.env).toContain("CLAUDE_CODE_TMPDIR=/tmp/kw/628b49d9");
  });

  test("FM_TASK_ID set but empty is still a worker: Kinas is asked, never skipped", async () => {
    const r = await runWrapper(FM_ARGV, { FM_TASK_ID: "" }, "", 78);
    expect(r.kinasArgs?.slice(0, 3)).toEqual(["companion", "worker-launch", ""]);
    expect(r.code).toBe(REFUSED_EXIT);
    expect(r.realArgs).toBeNull();
  });

  test("fails closed: Kinas refusing, or an answer that does not read, and Claude Code never starts", async () => {
    const refused = await runWrapper(FM_ARGV, { FM_TASK_ID: "t1" }, "", 78);
    expect(refused.code).toBe(REFUSED_EXIT);
    expect(refused.realArgs).toBeNull();
    expect(refused.stderr).toContain("it would run outside Kinas's sandbox");
    for (const says of ["abc123", "", "\n/state/x", "abc123\n/state/x", "abc123\n/state/x\n"]) {
      const bad = await runWrapper(FM_ARGV, { FM_TASK_ID: "t1" }, says);
      expect(bad.code).toBe(REFUSED_EXIT);
      expect(bad.realArgs).toBeNull();
    }
  });
});

describe("the runtime check (the captain's condition 1), on a fake /proc", () => {
  /** A machine with Claude Code installed as its installer does, Kinas's wrapper path, and one worker launched by Kinas. */
  function machine() {
    const w = world();
    const { paths, d } = w;
    const versions = join(w.root, "claude-versions");
    mkdirSync(versions, { recursive: true });
    writeFileSync(join(versions, "2.1.332"), "");
    mkdirSync(dirname(paths.realClaude), { recursive: true });
    rmSync(paths.realClaude, { force: true });
    symlinkSync(join(versions, "2.1.332"), paths.realClaude);
    const exe = join(versions, "2.1.332");
    const wt = w.worktree();
    const out = workerLaunch(d, {}, "t1", wt, FM_ARGV);
    if ("refused" in out) throw new Error(out.refused);
    // ADR 0029: the token step makes its folder (tokens.ts); the wrapper exports its temp folder.
    mkdirSync(tokenDir(paths.workers, "t1"), { mode: 0o700 });
    const wrapper = join(paths.wrapperDir, "claude");
    const worker: FakeProc = {
      pid: 100,
      ppid: 90,
      exe,
      cwd: wt,
      cmdline: [paths.realClaude, "--setting-sources", "user", "--strict-mcp-config", "--add-dir", wt, ...FM_ARGV.map((a) => (a === FM_SETTINGS ? out.file : a))],
      env: { FM_TASK_ID: "t1", [MARKER]: out.sha256, PATH: "/usr/bin", CLAUDE_CODE_TMPDIR: out.tmp },
    };
    const pane: FakeProc = { pid: 90, ppid: 50, exe: "/usr/bin/bash", cmdline: ["/bin/bash"], env: { PATH: `${paths.wrapperDir}:/usr/bin` } };
    const server: FakeProc = { pid: 50, ppid: 1, exe: paths.herdr, cmdline: [paths.herdr, "server", "--session", "default"], env: { PATH: `${paths.wrapperDir}:/usr/bin` } };
    const tool: FakeProc = {
      pid: 102,
      ppid: 107,
      exe: "/usr/bin/bash",
      cmdline: ["/usr/bin/bash", "-c", "exec 3<&- || exit 126; source /home/claude/.claude/shell-snapshots/snapshot-bash-1.sh 2>/dev/null || true && eval 'npm test'"],
      env: { FM_TASK_ID: "t1" },
      ns: SANDBOX_NS,
      seccomp: 2,
      noNewPrivs: 1,
    };
    // The sandbox's launch chain as measured on the home lab (2026-11-25, the acceptance run): a `/bin/sh -c { … }`
    // launcher and `bwrap`, both in the host's namespace, each carrying the tool command's script among its arguments.
    const script = tool.cmdline[2]!;
    const launcher: FakeProc = {
      pid: 104,
      ppid: 100,
      exe: "/usr/bin/dash",
      cmdline: ["/bin/sh", "-c", '{\n  set +euvx\n  unset TMOUT\n  read -r line <&7\n} 2>/dev/null &\nif eval "$1"; then set -- "$2" 0; fi', "/bin/sh", `bwrap --new-session --die-with-parent -- /bin/bash -c '${script}'`],
      env: { FM_TASK_ID: "t1" },
    };
    const bwrap: FakeProc = { pid: 101, ppid: 104, exe: "/usr/bin/bwrap", cmdline: ["bwrap", "--new-session", "--die-with-parent", "--", "/bin/bash", "-c", script], env: { FM_TASK_ID: "t1" }, noNewPrivs: 1 };
    // Inside: the network bridge, with no seccomp filter by design, then Claude Code's own seccomp stage, then the tool.
    const bridge: FakeProc = {
      pid: 106,
      ppid: 101,
      exe: "/usr/bin/bash",
      cmdline: ["/bin/bash", "-c", `{ socat TCP6-LISTEN:3128,fork UNIX-CONNECT:/tmp/claude-http-1.sock; } >/dev/null 2>&1 &\nexec /proc/self/fd/3 /bin/bash -c '${script}'`],
      env: { FM_TASK_ID: "t1" },
      ns: SANDBOX_NS,
      noNewPrivs: 1,
    };
    const stage: FakeProc = { pid: 107, ppid: 106, exe, cmdline: ["/proc/self/fd/3", "/bin/bash", "-c", script], env: { FM_TASK_ID: "t1" }, ns: SANDBOX_NS, noNewPrivs: 1 };
    const helper: FakeProc = { pid: 103, ppid: 100, exe: "/usr/bin/gh", cmdline: ["gh", "auth", "token"], env: { FM_TASK_ID: "t1" } };
    // Herdr's server binary must be there for its path to resolve as itself.
    mkdirSync(dirname(paths.herdr), { recursive: true });
    writeFileSync(paths.herdr, "");
    const all = { worker, pane, server, launcher, tool, bwrap, bridge, stage, helper };
    const check = (procs: FakeProc[]) => {
      fakeProc(paths.proc, procs);
      return workerCheck(d);
    };
    return { ...w, exe, wt, out, wrapper, all, check };
  }

  test("a worker Kinas launched, its tool command sandboxed, its helpers and the captain's hooks beside it: every answer may flow", () => {
    const m = machine();
    const v = m.check(Object.values(m.all));
    expect(v).toEqual({ problems: [], workers: 1, servers: [{ pid: 50, wrapped: true }] });
    fakeProc(m.paths.proc, Object.values(m.all));
    expect(answersMayFlow(m.d)).toEqual({ ok: true });
  });

  test("the sandbox's own launcher and bwrap, which carry the tool command's script in the host's namespace, are not tool commands", () => {
    expect(isToolCommand(["/usr/bin/bash", "-c", "source /h/.claude/shell-snapshots/snapshot-bash-1.sh && eval x"])).toBe(true);
    expect(isToolCommand(["/bin/sh", "-c", "{ read -r line <&7; }", "/bin/sh", "bwrap -- /bin/bash -c 'source /h/.claude/shell-snapshots/snapshot-bash-1.sh'"])).toBe(false);
    expect(isToolCommand(["bwrap", "--new-session", "/bin/bash", "-c", "source /h/.claude/shell-snapshots/snapshot-bash-1.sh"])).toBe(false);
    expect(isToolCommand(["bash", "/h/fm/bin/fm-captain-hold.sh", "complete", "t1", "--none"])).toBe(false);
    // The bridge inside the sandbox carries the script nested in its own `-c '…'`: not a tool command.
    expect(isToolCommand(["/bin/bash", "-c", "{ socat TCP6-LISTEN:3128 UNIX-CONNECT:/tmp/x.sock; } &\nexec /proc/self/fd/3 /bin/bash -c 'exec 3<&- || exit 126; source /h/.claude/shell-snapshots/snapshot-bash-1.sh'"])).toBe(false);
    expect(isToolCommand(["/bin/bash", "-c", "exec 3<&- || exit 126; source /h/.claude/shell-snapshots/snapshot-bash-1.sh 2>/dev/null || true && eval 'bash -c x'"])).toBe(true);
    expect(isToolCommand(null)).toBe(false);
    // A long-running command, its whole launch chain alive: answers still flow.
    const m = machine();
    expect(m.check(Object.values(m.all)).problems).toEqual([]);
  });

  test("a process with no FM_TASK_ID (the first mate, the captain's own panes) is not a worker; another user's is not read", () => {
    const m = machine();
    const mate: FakeProc = { pid: 300, ppid: 50, exe: m.exe, cmdline: ["claude", "--append-system-prompt-file", "/x.md"], env: {} };
    const theirs: FakeProc = { ...m.all.worker, pid: 301, uid: 1002, env: { FM_TASK_ID: "t9" } };
    expect(m.check([m.all.server, mate, theirs]).problems).toEqual([]);
  });

  test("each way a worker is not proven sandboxed turns the check red with the task and the reason", () => {
    const m = machine();
    const { worker, server, tool, bwrap, launcher, bridge, stage } = m.all;
    const red = (procs: FakeProc[]) => m.check(procs).problems;
    expect(red([server, { ...worker, env: { FM_TASK_ID: "t1" } }])).toEqual(["t1: started outside Kinas's sandbox"]);
    expect(red([server, { ...worker, cmdline: [m.paths.realClaude, ...FM_ARGV.map((a) => (a === FM_SETTINGS ? m.out.file : a))] }])).toEqual(["t1: started outside Kinas's sandbox"]);
    expect(red([server, { ...worker, cmdline: [...worker.cmdline, "--settings", m.out.file] }])).toEqual(["t1: started outside Kinas's sandbox"]);
    expect(red([server, { ...worker, cmdline: [...worker.cmdline, "--mcp-config", "x.json"] }])).toEqual(["t1: started outside Kinas's sandbox"]);
    expect(red([server, { ...worker, env: { FM_TASK_ID: "t1", [MARKER]: "0".repeat(64) } }])).toEqual(["t1: its settings file changed since it started"]);
    // The tool command in the host's namespace, or without the seccomp filter.
    expect(red([server, worker, launcher, bwrap, bridge, stage, { ...tool, ns: HOST_NS }])).toEqual(["t1: a tool command ran outside the sandbox"]);
    expect(red([server, worker, launcher, bwrap, bridge, stage, { ...tool, seccomp: 0 }])).toEqual(["t1: a tool command ran outside the sandbox"]);
    expect(red([server, worker, launcher, bwrap, bridge, stage, { ...tool, noNewPrivs: 0 }])).toEqual(["t1: a tool command ran outside the sandbox"]);
    // Unsandboxed, Claude Code starts the tool shell itself, straight under the worker in the host's namespace.
    expect(red([server, worker, { ...tool, ppid: 100, ns: HOST_NS, seccomp: 0, noNewPrivs: 0 }])).toEqual(["t1: a tool command ran outside the sandbox"]);
    // The bridge exec'ing the tool's script itself (no seccomp stage): that process is the tool command, and red.
    const unfiltered = { ...bridge, cmdline: tool.cmdline };
    expect(red([server, worker, launcher, bwrap, unfiltered])).toEqual(["t1: a tool command ran outside the sandbox"]);
    expect(red([server, worker, launcher, bwrap, bridge, stage, tool])).toEqual([]);
    // A worker's other processes are its own even after one of them fails: no second line for the same worker.
    expect(red([server, worker, launcher, bwrap, bridge, stage, { ...tool, ns: HOST_NS }, { ...tool, pid: 105, ns: HOST_NS }])).toEqual(["t1: a tool command ran outside the sandbox"]);
    // A Claude Code process that can't be read is not taken on trust.
    expect(red([server, { ...worker, noEnviron: true }])).toEqual(["a Claude Code process (pid 100) can't be read"]);
  });

  test("ADR 0029: a GitHub token or the ssh agent in its environment, no temp folder of its own, or its token folder gone: red", () => {
    const m = machine();
    const { worker, pane, server } = m.all;
    const problems = (w: FakeProc) => m.check([w, pane, server]).problems;
    expect(problems(worker)).toEqual([]);
    expect(problems({ ...worker, env: { ...worker.env, GH_TOKEN: "x" } })).toEqual(["t1: its environment carries GH_TOKEN"]);
    expect(problems({ ...worker, env: { ...worker.env, SSH_AUTH_SOCK: "/tmp/agent.1" } })).toEqual(["t1: its environment carries SSH_AUTH_SOCK"]);
    const { CLAUDE_CODE_TMPDIR: _own, ...shared } = worker.env!;
    expect(problems({ ...worker, env: shared })).toEqual(["t1: it started without its own temp folder"]);
    expect(problems({ ...worker, env: { ...worker.env, CLAUDE_CODE_TMPDIR: "/tmp" } })).toEqual(["t1: it started without its own temp folder"]);
    rmSync(tokenDir(m.paths.workers, "t1"), { recursive: true });
    expect(problems(worker)).toEqual(["t1: its token folder is gone"]);
  });

  test("a settings file edited since, or one that is not today's policy, is red even with a matching marker", () => {
    const m = machine();
    const { worker, server } = m.all;
    writeFileSync(m.out.file, readFileSync(m.out.file, "utf8").replace('"strictAllowlist": true', '"strictAllowlist": false'));
    expect(m.check([server, worker]).problems).toEqual(["t1: its settings file changed since it started"]);
    // The marker made to match the edited file: still not Kinas's policy.
    const edited = readFileSync(m.out.file, "utf8");
    expect(m.check([server, { ...worker, env: { FM_TASK_ID: "t1", [MARKER]: sha256(edited) } }]).problems).toEqual(["t1: its settings aren't Kinas's policy today"]);
    const extra = settingsText({ ...JSON.parse(edited), hooks: {} });
    writeFileSync(m.out.file, extra);
    expect(m.check([server, { ...worker, env: { FM_TASK_ID: "t1", [MARKER]: sha256(extra) } }]).problems).toEqual(["t1: its settings carry hooks"]);
    rmSync(m.out.file);
    expect(m.check([server, worker]).problems).toEqual(["t1: its settings file is gone"]);
  });

  test("ADR 0028: the denies come from Kinas's launch record, which must be there and match how the worker started", () => {
    const m = machine();
    const { worker, server } = m.all;
    expect(m.check([server, worker]).problems).toEqual([]);
    const file = launchRecordFile(m.paths.workers, "t1");
    const record = readLaunchRecord(file)!;
    // Another folder than the one the wrapper passed as --add-dir.
    writeFileSync(file, JSON.stringify({ ...record, worktree: "/elsewhere" }));
    expect(m.check([server, worker]).problems).toEqual(["t1: its launch record doesn't match how it started"]);
    // Without the root's two denies, or with a path outside the folder.
    writeFileSync(file, JSON.stringify({ ...record, deny: [`${m.wt}/.claude`] }));
    expect(m.check([server, worker]).problems).toEqual(["t1: its launch record doesn't match how it started"]);
    writeFileSync(file, JSON.stringify({ ...record, deny: [...record.deny, `${m.wt}/../x`] }));
    expect(m.check([server, worker]).problems).toEqual(["t1: its launch record doesn't match how it started"]);
    // A record with one more deny than the settings file holds: the file is not the policy for that record.
    writeFileSync(file, JSON.stringify({ ...record, deny: [...record.deny, `${m.wt}/pkg/.mcp.json`] }));
    expect(m.check([server, worker]).problems).toEqual(["t1: its settings aren't Kinas's policy today"]);
    rmSync(file);
    expect(m.check([server, worker]).problems).toEqual(["t1: its launch record is gone"]);
  });

  test("any other process with FM_TASK_ID in the host's namespace is a worker Kinas can't see the sandbox of — but not a launch step", () => {
    const m = machine();
    const { server } = m.all;
    const codex: FakeProc = { pid: 200, ppid: 90, exe: "/usr/bin/node", cmdline: ["node", "/usr/lib/codex/cli.js"], env: { FM_TASK_ID: "t2" } };
    expect(m.check([server, codex]).problems).toEqual(["t2: node runs outside Kinas's sandbox"]);
    // Inside a sandbox it is not the host's: not this check's to judge.
    expect(m.check([server, { ...codex, ns: SANDBOX_NS }]).problems).toEqual([]);
    const steps: FakeProc[] = [
      { pid: 210, ppid: 90, exe: "/usr/bin/dash", cmdline: ["/bin/sh", m.wrapper, "--settings", "{}"], env: { FM_TASK_ID: "t3" } },
      { pid: 211, ppid: 210, exe: join(m.paths.bin, "kinas"), cmdline: [join(m.paths.bin, "kinas"), "companion", "worker-launch", "t3", "/wt"], env: { FM_TASK_ID: "t3" } },
      { pid: 212, ppid: 90, exe: "/usr/bin/env", cmdline: ["/usr/bin/env", "-i", "claude"], env: { FM_TASK_ID: "t4" } },
    ];
    mkdirSync(m.paths.bin, { recursive: true });
    writeFileSync(join(m.paths.bin, "kinas"), "");
    expect(m.check([server, ...steps]).problems).toEqual([]);
    // A shell that is not the wrapper is not a launch step.
    expect(m.check([server, { ...steps[0]!, cmdline: ["/bin/sh", "-c", "claude"] }]).problems).toEqual(["t3: dash runs outside Kinas's sandbox"]);
  });

  test("the machine: the sandbox's pieces, the captain's and the managed settings, the crew harness, Herdr's server", () => {
    const m = machine();
    const { worker, server } = m.all;
    m.d.which = () => null;
    expect(m.check([server, worker]).problems).toEqual(["bwrap, socat missing: workers can't be sandboxed"]);
    m.d.which = (n) => `/usr/bin/${n}`;
    mkdirSync(m.paths.claudeHome, { recursive: true });
    writeFileSync(join(m.paths.claudeHome, "settings.json"), JSON.stringify({ hooks: {}, sandbox: { excludedCommands: ["docker"] } }));
    expect(m.check([server, worker]).problems).toEqual(["your ~/.claude/settings.json sets sandbox.excludedCommands, which reaches every worker's sandbox"]);
    writeFileSync(join(m.paths.claudeHome, "settings.json"), JSON.stringify({ hooks: {}, sandbox: { enabled: true } }));
    mkdirSync(dirname(m.paths.managedSettings), { recursive: true });
    writeFileSync(m.paths.managedSettings, JSON.stringify({ sandbox: { network: { allowAllUnixSockets: true } } }));
    expect(m.check([server, worker]).problems).toEqual(["the machine's managed settings set sandbox.network, which reaches every worker's sandbox"]);
    rmSync(m.paths.managedSettings);
    mkdirSync(join(m.paths.home, "config"), { recursive: true });
    writeFileSync(join(m.paths.home, "config", "crew-harness"), "codex\n");
    expect(m.check([server, worker]).problems).toEqual(["Firstmate's crew harness is codex: only Claude Code workers run in Kinas's sandbox"]);
    writeFileSync(join(m.paths.home, "config", "crew-harness"), "default\n");
    expect(m.check([{ ...server, env: { PATH: "/usr/bin" } }, worker]).problems).toEqual(["Herdr's server started without Kinas's wrapper: a new worker would run outside the sandbox"]);
    fakeProc(m.paths.proc, [{ ...server, env: { PATH: "/usr/bin" } }]);
    expect(answersMayFlow(m.d)).toEqual({ refused: "Herdr's server started without Kinas's wrapper: a new worker would run outside the sandbox — no answers are sent until it ends" });
  });

  test("looseningKeys and crewHarness read as fm-harness.sh and the sandbox docs say", () => {
    expect(looseningKeys(null)).toEqual([]);
    expect(looseningKeys('{"theme":"dark"}')).toEqual([]);
    expect(looseningKeys('{"sandbox":{"enabled":true,"failIfUnavailable":true,"autoAllowBashIfSandboxed":false}}')).toEqual([]);
    expect(looseningKeys('{"sandbox":{"enabled":false}}')).toEqual(["sandbox.enabled"]);
    expect(looseningKeys('{"sandbox":{"allowUnsandboxedCommands":true,"filesystem":{"allowWrite":["/"]}}}')).toEqual(["sandbox.allowUnsandboxedCommands", "sandbox.filesystem"]);
    expect(looseningKeys("{ not json")).toEqual(["(not JSON)"]);
    const home = mkdtempSync(join(tmpdir(), "kinas-fm-"));
    expect(crewHarness(home)).toBe("claude");
    mkdirSync(join(home, "config"));
    writeFileSync(join(home, "config", "crew-harness"), " claude \n");
    expect(crewHarness(home)).toBe("claude");
  });
});

describe("the row and its install (ADR 0027)", () => {
  /** The fake machine with Firstmate cloned, Herdr under Kinas's unit, bwrap and socat, and Node's folder. */
  function ready(): { m: ReturnType<typeof fakeMachine>; deps: SetupDeps; paths: Paths } {
    const m = fakeMachine({ server: { running: true, startsWithUnit: true, stops: true }, units: { [HERDR_UNIT]: "active" } });
    const paths = m.deps.paths;
    mkdirSync(join(paths.home, ".git"), { recursive: true });
    mkdirSync(join(paths.home, "state"), { recursive: true });
    mkdirSync(paths.units, { recursive: true });
    writeFileSync(join(paths.units, HERDR_UNIT), `${UNIT_HEADER}\n[Service]\nEnvironment=PATH=/home/c/.local/bin:/usr/bin:/bin\n`);
    const node = join(m.root, "node", "bin");
    mkdirSync(node, { recursive: true });
    const deps: SetupDeps = { ...m.deps, node, which: (n) => `/usr/bin/${n}` };
    fakeProc(paths.proc, []);
    return { m, deps, paths };
  }
  const rowOf = async (deps: SetupDeps): Promise<Check | undefined> => (await checks(deps)).find((r) => r.id === "worker-sandbox");

  test("Install: the seccomp helper, the wrapper (recorded), then the unit's PATH with the wrapper first — reloaded, never restarted", async () => {
    const { m, deps, paths } = ready();
    expect(await rowOf(deps)).toMatchObject({ state: "bad", detail: "the seccomp helper missing: workers can't be sandboxed", install: "worker-sandbox" });
    expect(await install({ item: "worker-sandbox" }, deps)).toEqual({ done: true });
    expect(m.state.npm).toEqual(["@anthropic-ai/sandbox-runtime@0.0.83"]);
    const wrapper = join(paths.wrapperDir, "claude");
    expect(readFileSync(wrapper, "utf8")).toBe(wrapperText(paths.realClaude, join(paths.bin, "kinas")));
    expect(statSync(wrapper).mode & 0o111).not.toBe(0);
    expect(readWritten(paths)[wrapper]?.item).toBe("worker-sandbox");
    // ADR 0029: the credential helper beside it, executable and recorded as Kinas's.
    const helper = join(paths.wrapperDir, HELPER);
    expect(readFileSync(helper, "utf8")).toBe(helperText());
    expect(statSync(helper).mode & 0o777).toBe(0o755);
    expect(readWritten(paths)[helper]?.item).toBe("worker-sandbox");
    expect(readFileSync(join(paths.units, HERDR_UNIT), "utf8")).toContain(`Environment=PATH=${paths.wrapperDir}:`);
    expect(m.ran.some((a) => a.includes("daemon-reload"))).toBe(true);
    expect(m.ran.some((a) => a.includes("restart"))).toBe(false);
    // The running server still has the old PATH: the row asks for the restart, a second click.
    fakeProc(paths.proc, [{ pid: 50, ppid: 1, exe: paths.herdr, cmdline: [paths.herdr, "server"], env: { PATH: "/usr/bin" } }]);
    mkdirSync(dirname(paths.herdr), { recursive: true });
    writeFileSync(paths.herdr, "");
    expect(await rowOf(deps)).toMatchObject({ state: "bad", install: "worker-sandbox", restart: true });
    expect(await install({ item: "worker-sandbox", restart: true }, deps)).toEqual({ done: true });
    expect(m.ran.at(-1)).toEqual([paths.systemctl, "--user", "restart", HERDR_UNIT]);
    // Started again under the unit with the wrapper first: green.
    fakeProc(paths.proc, [{ pid: 51, ppid: 1, exe: paths.herdr, cmdline: [paths.herdr, "server"], env: { PATH: `${paths.wrapperDir}:/usr/bin` } }]);
    expect(await rowOf(deps)).toEqual({ id: "worker-sandbox", state: "ok", detail: "no workers now: new workers start in Kinas's sandbox" });
  });

  test("the restart waits for the wrapper and the unit; a wrapper Kinas did not write is left; no unit, no install", async () => {
    const { deps, paths } = ready();
    expect(await install({ item: "worker-sandbox", restart: true }, deps)).toEqual({ cannot: "not-ready" });
    mkdirSync(paths.wrapperDir, { recursive: true });
    writeFileSync(join(paths.wrapperDir, "claude"), "#!/bin/sh\nexec claude \"$@\"\n");
    expect(await install({ item: "worker-sandbox" }, deps)).toEqual({ cannot: "foreign" });
    expect(readFileSync(join(paths.wrapperDir, "claude"), "utf8")).toBe("#!/bin/sh\nexec claude \"$@\"\n");
    expect((await rowOf(deps))?.detail).toBe("a file Kinas didn't write is at ~/.local/share/kinas/bin/claude: Kinas leaves it as it is");
    const other = ready();
    rmSync(join(other.paths.units, HERDR_UNIT));
    expect(await install({ item: "worker-sandbox" }, other.deps)).toEqual({ cannot: "no-unit" });
    expect(await install({ item: "worker-sandbox" }, { ...other.deps, which: () => null })).toEqual({ cannot: "sandbox-tools" });
    expect(await rowOf({ ...other.deps, which: () => null })).toMatchObject({ state: "bad" });
  });

  test("without bwrap and socat the row gives the captain's own command", async () => {
    const { deps } = ready();
    expect(await rowOf({ ...deps, which: () => null })).toMatchObject({ state: "bad", run: "sudo apt install bubblewrap socat" });
  });

  test("Herdr's unit written again (Run Herdr under systemd) keeps the wrapper first once Kinas's wrapper is there", async () => {
    const { deps, paths } = ready();
    expect(await install({ item: "worker-sandbox" }, deps)).toEqual({ done: true });
    const text = readFileSync(join(paths.units, HERDR_UNIT), "utf8");
    expect(text.split("\n").filter((l) => l.startsWith("Environment=PATH="))).toEqual([expect.stringMatching(new RegExp(`^Environment=PATH=${paths.wrapperDir}:`))]);
  });
});
