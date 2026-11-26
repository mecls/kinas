# 0028 · A worker can't write its worktree's `.claude` or `.mcp.json`, and Kinas scans the worktree for new ones before landing

Date: 2026-11-25
Status: superseded by 0029

## Context

ADR 0027 put every Firstmate worker on a VPS in Claude Code's sandbox. On 2026-11-25 the captain ran four checks from
inside a real worker that Firstmate spawned on the home lab (Claude Code 2.1.332, Firstmate `427056c`). Three held:
- the inbox and the wake queue;
- Herdr's socket and the first mate's pane;
- the reserved reads.

The fourth didn't. The Edit and Write tools were refused on every `.claude/**` and `.mcp.json`, but from the shell the
worker could:
- delete the tracked `.claude/notes.md`;
- create `sub/.claude/x` and `sub/.mcp.json`.

Measured afterwards:
- **The permission rules don't reach the shell.** Claude Code's sandbox doesn't turn the `Edit(**/.claude/**)` and
  `Edit(**/.mcp.json)` rules into filesystem denies. It protects its own fixed list instead: the root
  `.claude/settings.json`, `agents`, `commands`, `hooks`, `skills` and a few more; the root `.mcp.json`; the shell's rc
  files, `.gitconfig`, `.gitmodules`, `.ripgreprc`, `.idea` and `.vscode`. The rest of `.claude/`, and every nested
  path, stays writable.
- **`denyWrite` works, but only on exact paths.** `sandbox.filesystem.denyWrite` on `<worktree>/.claude` and
  `<worktree>/.mcp.json` refused a delete, a new file and an append. On an existing nested `.claude` or `.mcp.json` it
  refused everything, `rm -rf` included. A glob there (`<worktree>/**/.claude`) did nothing.
- **New paths can't be denied ahead of time.** A nested `.claude` or `.mcp.json` that doesn't exist when the sandbox
  starts can still be created by the shell.
- **The sandbox leaves placeholders behind.** For each protected path missing at the start, it makes an empty
  read-only file in the worktree: `.bashrc`, `.claude/settings.json`, `.idea` and so on. They stay there after the
  worker ends, and a `git add -A` would commit them.

The captain chose:
- deny what can be denied;
- prove that the review flag matches nested paths;
- scan the worktree, as plain files and never with git, when the worker reports done and again before landing,
  because Treehouse reuses worktree slots and an uncommitted plant outlives its task;
- keep the placeholders out of `git add` through the clone's local exclude;
- keep the review flag strict for any committed `.claude/` file, even an empty one.

## Decision

ADR 0027's decision stands whole, with three additions, (1) to (3) below. In full:

On a VPS, every Firstmate worker (a process with `FM_TASK_ID`) runs Claude Code in its sandbox. The first mate and the
captain's own sessions don't.

**The wrapper.** Kinas installs `~/.local/share/kinas/bin/claude`, a small sh script recorded as Kinas's, and puts
its folder first on the PATH of Kinas's Herdr unit, which every pane inherits. Without `FM_TASK_ID` it runs the real
Claude Code untouched.

With `FM_TASK_ID`, it runs `kinas companion worker-launch` first, which:
- checks the task id and Firstmate's arguments;
- checks that `bwrap`, `socat` and the seccomp helper are there;
- **(1)** walks the worker's folder for `.claude` and `.mcp.json` (below);
- writes the worker's settings file, `~/.local/state/kinas/workers/<id>.settings.json`: Firstmate's own settings
  merged with Kinas's policy, the policy winning. Only `feedbackDrafts`, `attribution`, `model` and `effortLevel` are
  kept from Firstmate's; any other key refuses the launch;
- **(2)** writes the placeholders' lines into the clone's local exclude (below);
- **(3)** writes the launch record (below).

The wrapper then removes the workers' unneeded key variables from the environment, sets the marker
`KINAS_WORKER_POLICY=<sha256 of the file>`, and runs the real Claude Code with:
- `--setting-sources user`, `--strict-mcp-config` and `--add-dir <worktree>`;
- Firstmate's arguments, its `--settings` value replaced by the file.

If any step but the exclude fails, the worker doesn't start.

**The policy:**
- `sandbox`: `enabled`, `failIfUnavailable`, `allowUnsandboxedCommands: false`. Writes are allowed to the task's own
  status file only, beyond what Claude Code itself allows.
- **(1) `sandbox.filesystem.denyWrite`**:
  - the worktree's root `.claude` and `.mcp.json`, whether or not they exist;
  - every `.claude` and `.mcp.json` found anywhere below the root at launch.

  The walk reads the folder as files: no git, no symlink followed, and the inside of a `.git` folder isn't entered. A
  link named `.claude` or `.mcp.json` is denied as found. If the walk can't finish (an unreadable folder, or more than
  500,000 entries), the worker doesn't start.
- The network: `strictAllowlist`, and the hosts `github.com`, `api.github.com`, `registry.npmjs.org`,
  `index.crates.io`, `static.crates.io`, `crates.io`, `pypi.org` and `files.pythonhosted.org`.
- `permissions.blockWritesOutsideWorkingDirectories`.
- **Read denies** for:
  - Claude Code's transcripts, history and credentials, and `~/.claude.json`;
  - Herdr's folder and the first mate's temp folder;
  - the vault (`~/vault`);
  - `~/.config/last30days`, `~/.config/brain` and the search skill's key files;
  - the Vercel CLI's login, Obsidian headless sync's login, and Kinas's own state.
- **Edit denies** for:
  - the first mate's temp folder;
  - the home's `.agents` and operational inbox;
  - every `.claude/**` and `.mcp.json`.
- Package-manager caches pointed at a per-worker temporary folder.

The git key and `gh` stay readable. The list of reserved paths is the captain's, and is always written in full.

**(2) The placeholders stay out of `git add`.** At launch, Kinas adds one root-anchored line to the clone's
`info/exclude` for each path the sandbox protects that is missing from the worktree, as Firstmate already does for its
own `.claude/settings.local.json`. Lines are only added, never removed. Every such path is one the worker can't
write, so a line hides nothing the worker made. The exclude is found as files: the worktree's `.git` file, its
`gitdir`, then its `commondir`, and it is written only if that resolves to a real `.git` folder of a clone under
`<home>/projects/`. If it can't be written, the worker still starts: a placeholder that gets committed turns the review
flag red, which is strict for any committed `.claude/` path, even an empty file.

**(3) The worktree scan.** At launch, Kinas records the worktree and the sha256 of Firstmate's
`.claude/settings.local.json` in `~/.local/state/kinas/workers/<id>.launch.json`. That file is out of the worker's
reach.

From the reading in which a task's row first says its worker reported done, until the backlog says it landed, the
companion walks that worktree at each reading, at most once a minute, the same way as at launch. Each `.claude` entry,
everything under it, and each `.mcp.json` is classed as follows:
- **The repository's own:** the same path in the clone's own checkout under `<home>/projects/` is the same kind, and
  for a file holds the same bytes.
- **Firstmate's:** the root `.claude/settings.local.json`, with the sha256 recorded at launch.
- **A placeholder:** an empty file or an empty folder inside the root `.claude`, or an empty root `.mcp.json`. These
  are the only places the sandbox makes them, and places the worker can't write.
- **Red:** anything else, empty or not, anywhere in the worktree.

A red entry, or a walk that can't finish, puts one line on the crew card under the review flag's line, in `--danger`
text: `worktree holds .claude/ that isn't the repository's — review before landing` (or `.mcp.json`, or both;
or `worktree could not be checked — review before landing`). The task detail lists the paths. The latest scan is what
shows. Kinas doesn't land; the card is what the captain reads before telling the first mate to land, or before merging
the pull request.

**The review flag** is unchanged: any committed path with a `.claude` part, or a `.mcp.json` at any depth, empty or
not, in the pull request or in the branch's own commits. A test runs nested paths through both readings.

**Fail closed at runtime.** The companion proves the policy for every worker at each reading, and again before any
answer is written. That means:
- the marker, and the exact command line;
- the settings file unchanged and equal to today's policy for that worker, its `denyWrite` included;
- every tool command outside the host PID namespace, under the seccomp filter;
- the helper, `bwrap` and `socat` present, the captain's user and managed settings loosening nothing, and
  Firstmate's crew harness being Claude Code.

One failing worker turns the "Workers sandboxed" row red and stops every answer. The companion refuses to write a
note until no failing worker is left.

Putting the wrapper on the panes' PATH takes one restart of Herdr's server, which closes its panes. It is a separate
click with a warning.

## Consequences

**What stays open, and is accepted:**
- **A new nested `.claude` or `.mcp.json` can still be made from the shell.** The scan catches it before landing if
  it is left uncommitted, and the review flag catches it if it is committed. Either way the card turns red and the
  captain decides.
- **The scan compares against the clone's checkout.** If that checkout is behind the task's base, a file the base
  changed shows red. That errs toward review.
- **GitHub itself remains an exfiltration path.** A worker holds the git key and `gh`'s token, so it can send data
  out through a gist, a new repository, an issue or any repository the token reaches. The planned next step is a
  per-task fine-grained token scoped to the task's repository.
- Workers can read and write each other's temporary files (`/tmp/claude-<uid>` is one folder).
- Workers lose a repository's own skills, subagents and MCP servers.
- no-mistakes mode can't run sandboxed: its daemon runs the repository's commands outside the sandbox. So sandboxed
  workers ship by direct pull request or locally only.
- Secondmates aren't marked and aren't sandboxed; Kinas doesn't enable them.
- **Two rules come from measuring 2.1.332:** the runtime check's rule for telling a tool command from Claude Code's
  own helpers, and the list of placeholder paths. Both are measured again in the acceptance run when Claude Code
  changes. A placeholder path a newer version adds is missing from the exclude. If it is committed, the review flag
  turns red.
- The scan and the denies are the VPS's. On the Mac, workers aren't sandboxed by Kinas (ADR 0027).

Enforced by:
- `cli/src/companion/worker.ts`, `plants.ts` and their tests;
- `run.ts` (the scan in each reading);
- `app/src-tauri/src/readers/crew/touches.rs` (the review flag's nested-path test), `bundle.rs` and `mirror.rs`;
- `app/src/crew/board.ts` (the card's line);
- `docs/external/firstmate-home.md` and `vps.md`.
