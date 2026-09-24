import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
if [ "$1" = clone ]; then mkdir -p "$4/.git" "$4/bin"; echo stub > "$4/bin/fm-fleet-snapshot.sh"; exit 0; fi
if [ "$1" = -C ]; then
  dir=$2; shift 2
  case "$1" in
    checkout) echo "$5" > "$dir/.git/STUB_HEAD" ;;
    rev-parse) cat "$dir/.git/STUB_HEAD" 2>/dev/null || exit 128 ;;
    status) cat "$dir/.git/STUB_DIRTY" 2>/dev/null ;;
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
  for (const name of ["node", "jq", "python3", "herdr", "claude"]) script(join(stub, name), "exit 0");

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
      "would: clone Firstmate at f9f74a1",
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
    expect(out).toContain("tasks-axi: already 0.2.5");
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

  test("a clean clone that moved on by itself is reported, not reset", async () => {
    const w = world();
    mkdirSync(join(w.home, ".git"), { recursive: true });
    writeFileSync(join(w.home, ".git", "STUB_HEAD"), "9296f9b0000000000000000000000000000000ff\n");
    const { code, out } = await run(w, { yes: true });
    expect(code).toBe(0);
    expect(out).toContain("at 9296f9b, moved from the pin f9f74a1 — setup leaves it");
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
    expect(out).toContain(`Clone Firstmate at f9f74a1 into ${w.home}? [y/N] `);
    expect(out).toContain("Install tasks-axi 0.2.5 with npm install -g tasks-axi@0.2.5? [y/N] ");
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
