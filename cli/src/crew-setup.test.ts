import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIRSTMATE_PIN, TOOLS } from "@kinas/commands/crew-tools";
import type { Io } from "./confirm.ts";
import { setup } from "./crew-setup.ts";

// `kinas crew setup` (build spec AC-1's CLI half, §11.4) over a stub world: git, npm, curl, shasum and gh are scripts
// that log every call to calls.log, the releases are real tarballs holding a stub binary, and nothing leaves the
// temporary folder. No real tool, network or Firstmate clone is touched.

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function script(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

interface World {
  root: string;
  home: string;
  user: string;
  env: Record<string, string>;
  calls: () => string[];
}

function world(opts: { shaOf?: (asset: string, pinned: string) => string; signedOut?: boolean } = {}): World {
  const root = mkdtempSync(join(tmpdir(), "kinas-setup-"));
  roots.push(root);
  const stub = join(root, "stub");
  const prefix = join(root, "npm");
  const assets = join(root, "assets");
  const user = join(root, "user");
  for (const d of [stub, join(prefix, "bin"), join(prefix, "lib", "node_modules"), assets, user]) mkdirSync(d, { recursive: true });
  const calls = join(root, "calls.log");

  script(
    join(stub, "git"),
    `echo "git $*" >> "$CALLS"
if [ "$1" = clone ]; then if [ -f "$CALLS.slow-clone" ]; then sleep 1; echo cloned >> "$CALLS.slow-clone"; fi; mkdir -p "$4/.git" "$4/bin"; echo stub > "$4/bin/fm-fleet-snapshot.sh"; exit 0; fi
if [ "$1" = -C ]; then
  dir=$2; shift 2
  case "$1" in
    checkout) if [ -s "$CALLS.no-checkout" ]; then cat "$CALLS.no-checkout" >&2; exit 128; fi; if [ -f "$CALLS.no-checkout" ]; then echo "fatal: reference is not a tree: $5" >&2; exit 128; fi; echo "$5" > "$dir/.git/STUB_HEAD"; echo "$4" > "$dir/.git/STUB_BRANCH" ;;
    rev-parse) cat "$dir/.git/STUB_HEAD" 2>/dev/null || exit 128 ;;
    symbolic-ref) cat "$dir/.git/STUB_BRANCH" 2>/dev/null || exit 1 ;;
    status) echo "git-env GIT_OPTIONAL_LOCKS=\${GIT_OPTIONAL_LOCKS:-unset}" >> "$CALLS"; cat "$dir/.git/STUB_DIRTY" 2>/dev/null ;;
  esac
fi
exit 0`,
  );
  script(
    join(stub, "npm"),
    `echo "npm $*" >> "$CALLS"
spec=$3; name=\${spec%@*}; version=\${spec##*@}
d="$PREFIX/lib/node_modules/$name"; mkdir -p "$d/dist/bin"
printf '{"name":"%s","version":"%s"}' "$name" "$version" > "$d/package.json"
printf '#!/bin/sh\\necho "ran %s" >> "$CALLS"\\necho %s\\n' "$name" "$version" > "$d/dist/bin/$name.js"
chmod +x "$d/dist/bin/$name.js"
ln -sf "$d/dist/bin/$name.js" "$PREFIX/bin/$name"`,
  );
  // curl -fsSL --max-time 300 -o <file> <url>
  script(join(stub, "curl"), `echo "curl $*" >> "$CALLS"\nurl=$6; cp "$ASSETS/\${url##*/}" "$5"`);
  script(join(stub, "shasum"), `echo "shasum $*" >> "$CALLS"\necho "$(cat "$3.sha" 2>/dev/null || cat "$ASSETS/\${3##*/}.sha")  $3"`);
  script(join(stub, "gh"), `echo "gh $*" >> "$CALLS"\n${opts.signedOut ? "exit 1" : "exit 0"}`);
  for (const name of ["node", "jq", "python3", "perl", "herdr", "claude"]) script(join(stub, name), "exit 0");

  // The two releases: a tarball each, holding the tool's stub binary, and the SHA-256 the stub shasum reports for it.
  for (const tool of TOOLS) {
    if (tool.source === "npm") continue;
    const dir = join(root, `release-${tool.name}`);
    mkdirSync(join(dir, "bin"), { recursive: true });
    script(
      join(dir, "bin", tool.name),
      `echo "ran ${tool.name} $*" >> "$CALLS"\nif [ "$1" = get ]; then echo "  --lease  hold a worktree"; else echo "${tool.name} version v${tool.version}"; fi`,
    );
    Bun.spawnSync(["tar", "-czf", join(assets, tool.source.asset), "-C", dir, "."]);
    writeFileSync(join(assets, `${tool.source.asset}.sha`), opts.shaOf ? opts.shaOf(tool.source.asset, tool.source.sha256) : tool.source.sha256);
  }

  const env = {
    PATH: `${stub}:${join(prefix, "bin")}:${join(user, ".local", "bin")}:/usr/bin:/bin`,
    HOME: user,
    CALLS: calls,
    PREFIX: prefix,
    ASSETS: assets,
  };
  return {
    root,
    home: join(root, "data", "firstmate"),
    user,
    env,
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []),
  };
}

/** An Io that answers from a list (null is the end of input) and keeps everything written. */
function io(answers: (string | null)[] = []): Io & { text: () => string } {
  let written = "";
  return {
    write: (t) => void (written += t),
    readLine: async () => (answers.length > 0 ? answers.shift()! : null),
    text: () => written,
  };
}

const run = (w: World, opts: { yes?: boolean; dryRun?: boolean; answers?: (string | null)[] } = {}) => {
  const out = io(opts.answers);
  return setup({ dryRun: opts.dryRun ?? false, yes: opts.yes ?? false, home: w.home, io: out, env: w.env, tmp: w.root }).then((code) => ({ code, out: out.text() }));
};

describe("kinas crew setup", () => {
  test("the seven steps in order; --dry-run prints would: for each and runs nothing", async () => {
    const w = world();
    const { code, out } = await run(w, { dryRun: true });
    expect(code).toBe(0);
    const would = out.split("\n").filter((l) => l.startsWith("would: "));
    const starts = [
      "would: check the prerequisites",
      "would: check that gh is signed in",
      "would: clone Firstmate at 427056c",
      "would: set Firstmate's backend to herdr",
      "would: install the tools at their pinned versions",
      "would: print the setup hooks lines",
      "would: print the table",
    ];
    expect(would.length).toBe(7);
    would.forEach((line, i) => expect(line.startsWith(starts[i]!), line).toBe(true));
    expect(out).toContain(`Firstmate's home: ${w.home}`);
    expect(w.calls()).toEqual([]);
    expect(existsSync(w.home)).toBe(false);
  });

  test("--yes clones the pin, sets the backend, installs every tool and prints the setup hooks lines without running them", async () => {
    const w = world();
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(0);
    expect(readFileSync(join(w.home, ".git", "STUB_HEAD"), "utf8").trim()).toBe(FIRSTMATE_PIN);
    expect(w.calls()).toContain(`git -C ${w.home} checkout --quiet -B main ${FIRSTMATE_PIN}`);
    expect(readFileSync(join(w.home, "config", "backend"), "utf8")).toBe("herdr\n");
    for (const tool of TOOLS) {
      if (tool.source === "npm") expect(w.calls()).toContain(`npm install -g ${tool.name}@${tool.version}`);
      else expect(existsSync(join(w.user, ".local", "bin", tool.name))).toBe(true);
      expect(out).toMatch(new RegExp(`\\n  ${tool.name} +ok ${tool.version.replaceAll(".", "\\.")}`));
    }
    for (const hook of ["gh-axi setup hooks", "chrome-devtools-axi setup hooks", "lavish-axi setup hooks"]) expect(out).toContain(hook);
    expect(w.calls().some((c) => c.includes("setup hooks"))).toBe(false);
    // An npm tool is never run, quota-axi above all: its version comes from its package.json.
    expect(w.calls().filter((c) => c.startsWith("ran ") && !c.startsWith("ran treehouse") && !c.startsWith("ran no-mistakes"))).toEqual([]);
    expect(out).toContain("gh auth");
    expect(out).not.toContain("setup leaves it");
  });

  test("a second run finds everything done and changes nothing", async () => {
    const w = world();
    await run(w, { yes: true });
    const before = w.calls().length;
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(0);
    const again = w.calls().slice(before);
    expect(again.filter((c) => /^(npm install|curl|git clone|git -C \S+ checkout)/.test(c))).toEqual([]);
    expect(out).toContain(`already at ${FIRSTMATE_PIN.slice(0, 7)}`);
    expect(out).toContain("already herdr");
    expect(out).toContain("tasks-axi: already 0.2.6");
  });

  test("a home with local changes is refused and left alone", async () => {
    const w = world();
    mkdirSync(join(w.home, ".git"), { recursive: true });
    writeFileSync(join(w.home, ".git", "STUB_HEAD"), `${FIRSTMATE_PIN}\n`);
    writeFileSync(join(w.home, ".git", "STUB_DIRTY"), " M bin/fm-fleet-snapshot.sh\n");
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(1);
    expect(out).toContain("Firstmate's home has local changes — setup leaves it alone");
    expect(w.calls().filter((c) => c.includes("checkout") || c.startsWith("git clone"))).toEqual([]);
  });

  test("a home setup leaves alone is left alone whole: its config/backend is neither written nor changed", async () => {
    // ADR 0018: config/backend is written once, before any first mate exists. A home with local changes, or on another
    // branch, is one a first mate is using; the clone step says "setup leaves it", and the backend step must not then
    // write into it — with --yes it would switch a running first mate's backend without a word.
    const dirty = world();
    mkdirSync(join(dirty.home, ".git"), { recursive: true });
    writeFileSync(join(dirty.home, ".git", "STUB_HEAD"), `${FIRSTMATE_PIN}\n`);
    writeFileSync(join(dirty.home, ".git", "STUB_DIRTY"), " M bin/fm-fleet-snapshot.sh\n");
    const left = await run(dirty, { yes: true });
    expect(left.code).toBe(1);
    expect(existsSync(join(dirty.home, "config", "backend"))).toBe(false);
    expect(left.out).toContain("skipped: setup leaves Firstmate's home alone");

    const tangle = world();
    mkdirSync(join(tangle.home, ".git"), { recursive: true });
    mkdirSync(join(tangle.home, "config"), { recursive: true });
    writeFileSync(join(tangle.home, ".git", "STUB_HEAD"), `${FIRSTMATE_PIN}\n`);
    writeFileSync(join(tangle.home, ".git", "STUB_BRANCH"), "fix-9c2e\n");
    writeFileSync(join(tangle.home, "config", "backend"), "tmux\n");
    await run(tangle, { yes: true });
    expect(readFileSync(join(tangle.home, "config", "backend"), "utf8")).toBe("tmux\n");
  });

  test("looking at an existing home takes no optional lock: git status must not refresh the index (ADR 0018)", async () => {
    const w = world();
    mkdirSync(join(w.home, ".git"), { recursive: true });
    writeFileSync(join(w.home, ".git", "STUB_HEAD"), `${FIRSTMATE_PIN}\n`);
    writeFileSync(join(w.home, ".git", "STUB_BRANCH"), "main\n");
    await run(w, { yes: true });
    expect(w.calls().filter((c) => c.startsWith("git-env "))).toEqual(["git-env GIT_OPTIONAL_LOCKS=0"]);
  });

  test("a home on another branch is a tangle, as Settings → Crew says: reported, left alone, exit 1", async () => {
    const w = world();
    mkdirSync(join(w.home, ".git"), { recursive: true });
    writeFileSync(join(w.home, ".git", "STUB_HEAD"), `${FIRSTMATE_PIN}\n`);
    writeFileSync(join(w.home, ".git", "STUB_BRANCH"), "fix-9c2e\n");
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(1);
    expect(out).toContain("Firstmate's home is on branch fix-9c2e, not main — setup leaves it; ask the first mate");
    expect(out).not.toContain("already at");
    expect(w.calls().filter((c) => c.includes("checkout") || c.startsWith("git clone"))).toEqual([]);
  });

  test("a home detached at the pin is at the pin", async () => {
    const w = world();
    mkdirSync(join(w.home, ".git"), { recursive: true });
    writeFileSync(join(w.home, ".git", "STUB_HEAD"), `${FIRSTMATE_PIN}\n`);
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(0);
    expect(out).toContain(`already at ${FIRSTMATE_PIN.slice(0, 7)}`);
  });

  test("a clone whose checkout to the pin fails says which step failed, with git's own last line", async () => {
    const w = world();
    writeFileSync(`${w.env.CALLS}.no-checkout`, "");
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(1);
    expect(out).toContain(`the checkout of ${FIRSTMATE_PIN.slice(0, 7)} failed: fatal: reference is not a tree: ${FIRSTMATE_PIN}`);
    expect(out).not.toContain("the clone failed");
  });

  test("what a file in the home or a tool says is shown on the terminal, never obeyed", async () => {
    // Setup printed config/backend's first line in its question, and git's or npm's own last line in a failure, as they
    // came: an `ESC ] 52` there set the clipboard of the terminal the captain runs setup in, as a commit subject did in
    // `kinas context` (2e664d2) and a path in `kinas open` (2504ba2).
    const home = world();
    mkdirSync(join(home.home, ".git"), { recursive: true });
    mkdirSync(join(home.home, "config"), { recursive: true });
    writeFileSync(join(home.home, ".git", "STUB_HEAD"), `${FIRSTMATE_PIN}\n`);
    writeFileSync(join(home.home, ".git", "STUB_BRANCH"), "main\n");
    writeFileSync(join(home.home, "config", "backend"), "tmux\x1b]52;c;aGk=\x07\n");
    const asked = await run(home, { answers: ["n"] });
    expect(asked.out).toContain("config/backend says tmux\uFFFD]52;c;aGk=\uFFFD; set it to herdr? [y/N] ");
    expect(asked.out).toContain("left as tmux\uFFFD]52;c;aGk=\uFFFD");
    expect(asked.out).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);

    const tool = world();
    writeFileSync(`${tool.env.CALLS}.no-checkout`, "fatal: \x1b]52;c;aGk=\x07\x1b[8mnot a tree\n");
    const failed = await run(tool, { yes: true });
    expect(failed.out).toContain(`the checkout of ${FIRSTMATE_PIN.slice(0, 7)} failed: fatal: \uFFFD]52;c;aGk=\uFFFD\uFFFD[8mnot a tree`);
    expect(failed.out).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
    // Two whole setups over stub processes: seconds on a loaded Mac.
  }, 30_000);

  test("config/backend is read and written only as a plain file of the home: never through a link, never a FIFO", async () => {
    // The home is Firstmate's, and a first mate can leave anything at config/backend. A link there — or a config folder
    // that is a link — took setup's `herdr` over the file it named, a file of the captain's outside the home, with no
    // question asked under --yes; and a FIFO there blocked setup at the backend step for good.
    const atPin = (w: World) => {
      mkdirSync(join(w.home, ".git"), { recursive: true });
      writeFileSync(join(w.home, ".git", "STUB_HEAD"), `${FIRSTMATE_PIN}\n`);
      writeFileSync(join(w.home, ".git", "STUB_BRANCH"), "main\n");
    };
    const linked = world();
    atPin(linked);
    mkdirSync(join(linked.home, "config"), { recursive: true });
    const precious = join(linked.user, "precious-9c2e.txt");
    writeFileSync(precious, "export PATH=/opt/9c2e\n");
    symlinkSync(precious, join(linked.home, "config", "backend"));
    const viaFile = await run(linked, { yes: true });
    expect(readFileSync(precious, "utf8")).toBe("export PATH=/opt/9c2e\n");
    expect(lstatSync(join(linked.home, "config", "backend")).isSymbolicLink()).toBe(true);
    expect(viaFile.out).toContain("skipped: config/backend is not a plain file of Firstmate's home — setup leaves it");
    expect(viaFile.out).not.toContain("export PATH");

    const folder = world();
    atPin(folder);
    const elsewhere = join(folder.user, "elsewhere-9c2e");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "backend"), "tmux\n");
    symlinkSync(elsewhere, join(folder.home, "config"));
    const viaFolder = await run(folder, { yes: true });
    expect(readFileSync(join(elsewhere, "backend"), "utf8")).toBe("tmux\n");
    expect(viaFolder.out).toContain("skipped: config/backend is not a plain file of Firstmate's home — setup leaves it");

    // A FIFO blocks the read, synchronously: in a child, so the failure is a timeout and not this test process stuck.
    const fifo = world();
    atPin(fifo);
    mkdirSync(join(fifo.home, "config"), { recursive: true });
    expect(Bun.spawnSync(["mkfifo", join(fifo.home, "config", "backend")]).exitCode).toBe(0);
    const code = `const { setup } = await import(${JSON.stringify(join(import.meta.dir, "crew-setup.ts"))});
      let out = "";
      const io = { write: (t) => void (out += t), readLine: async () => null };
      const code = await setup({ dryRun: false, yes: true, home: ${JSON.stringify(fifo.home)}, io, env: ${JSON.stringify(fifo.env)}, tmp: ${JSON.stringify(fifo.root)} });
      process.stdout.write(JSON.stringify({ code, out }));`;
    const child = Bun.spawnSync([process.execPath, "-e", code], { timeout: 20_000, killSignal: "SIGKILL" });
    expect(child.exitCode).toBe(0);
    expect(JSON.parse(child.stdout.toString()).out).toContain("skipped: config/backend is not a plain file of Firstmate's home — setup leaves it");
    expect(lstatSync(join(fifo.home, "config", "backend")).isFIFO()).toBe(true);
    // Three whole setups over stub processes: seconds on a loaded Mac.
  }, 60_000);

  test("Ctrl+C stops the step that is running too: a clone or an install never finishes behind the captain's back", async () => {
    // Each step runs in a process group of its own, so its limit can kill it whole; but Ctrl+C reaches only the
    // terminal's foreground group. Setup died and its `git clone` went on, finishing a clone at origin's head that never
    // reached the pin (and that the next setup reads as moved on), as an `npm install -g` would go on installing.
    const w = world();
    writeFileSync(`${w.env.CALLS}.slow-clone`, "");
    const code = `const { setup } = await import(${JSON.stringify(join(import.meta.dir, "crew-setup.ts"))});
      const io = { write: () => {}, readLine: async () => null };
      await setup({ dryRun: false, yes: true, home: ${JSON.stringify(w.home)}, io, env: ${JSON.stringify(w.env)}, tmp: ${JSON.stringify(w.root)} });`;
    // Its own group, as a terminal's foreground job is: Ctrl+C is SIGINT to that group.
    const child = spawn(process.execPath, ["-e", code], { detached: true, stdio: "ignore" });
    const exited = new Promise<void>((done) => (child as unknown as NodeJS.EventEmitter).on("exit", () => done()));
    const until = Date.now() + 15_000;
    while (!w.calls().some((c) => c.startsWith("git clone")) && Date.now() < until) await Bun.sleep(50);
    expect(w.calls().some((c) => c.startsWith("git clone"))).toBe(true);
    process.kill(-child.pid!, "SIGINT");
    await exited;
    // The stub clone sleeps a second before it writes; three is ample for one left running to finish.
    await Bun.sleep(3_000);
    expect(readFileSync(`${w.env.CALLS}.slow-clone`, "utf8")).toBe("");
    expect(existsSync(join(w.home, ".git"))).toBe(false);
  }, 30_000);

  test("a clean clone that moved on by itself is reported, not reset", async () => {
    const w = world();
    mkdirSync(join(w.home, ".git"), { recursive: true });
    writeFileSync(join(w.home, ".git", "STUB_HEAD"), "9296f9b0000000000000000000000000000000ff\n");
    writeFileSync(join(w.home, ".git", "STUB_BRANCH"), "main\n");
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(0);
    expect(out).toContain("at 9296f9b, moved from the pin 427056c — setup leaves it");
    expect(w.calls().filter((c) => c.includes("checkout"))).toEqual([]);
  });

  test("a checksum mismatch refuses the release", async () => {
    const w = world({ shaOf: (asset, pinned) => (asset.startsWith("treehouse") ? "0".repeat(64) : pinned) });
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(1);
    expect(out).toContain("treehouse: the download's SHA-256 is not the pinned one — not installed");
    expect(existsSync(join(w.user, ".local", "bin", "treehouse"))).toBe(false);
    expect(existsSync(join(w.user, ".local", "bin", "no-mistakes"))).toBe(true);
    expect(out).toMatch(/\n  treehouse +missing/);
  });

  test("asks y/N before each change; no leaves it undone", async () => {
    const w = world();
    // clone, backend, then the seven tools in order: all yes but treehouse.
    const { code, out } = await run(w, { answers: ["y", "yes", "n", "y", "y", "y", "y", "y", "Y"] });
    expect(out).toContain(`Clone Firstmate at 427056c into ${w.home}? [y/N] `);
    expect(out).toContain("Install tasks-axi 0.2.6 with npm install -g tasks-axi@0.2.6? [y/N] ");
    expect(out).toContain("treehouse: skipped");
    expect(code).toBe(1);
  });

  test("the end of input is no: nothing is changed", async () => {
    const w = world();
    const { code, out } = await run(w, { answers: [] });
    expect(code).toBe(1);
    expect(existsSync(w.home)).toBe(false);
    expect(out).toContain("skipped: Firstmate is not cloned");
    expect(w.calls().filter((c) => /^(npm|curl|git clone)/.test(c))).toEqual([]);
  });

  test("gh signed out is exit 1, and says to sign in by hand", async () => {
    const w = world({ signedOut: true });
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(1);
    expect(out).toContain("not signed in — run gh auth login yourself");
  });
});
