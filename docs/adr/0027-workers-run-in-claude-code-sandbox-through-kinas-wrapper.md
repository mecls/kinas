# 0027 · On a VPS, Firstmate's workers run in Claude Code's sandbox through a wrapper Kinas owns; the first mate does not

Date: 2026-11-25
Status: accepted

## Context

The captain's answer reaches the first mate as a note in Firstmate's inbox (ADR 0025). A worker runs as the same Unix
user as the first mate, so a worker could write a forged note, or read and type into the first mate's Herdr pane.
Until that is closed, workers work only on the captain's own repositories.

The captain chose Claude Code's own sandbox (bubblewrap, socat, and the seccomp helper of `@anthropic-ai/sandbox-runtime`)
before a separate user or containers. It was measured on the captain's home lab on 2026-11-25 (Claude Code 2.1.332,
Firstmate `427056c`), in bypass and auto mode.
- **Managed settings don't fit.** They apply to every session on the machine, and the first mate needs Herdr's Unix
  socket, which the sandbox's seccomp filter refuses outright on Linux.
- **Firstmate can't carry it.** It passes each worker one inline `--settings` and has no way to add to it. Of two
  `--settings` flags, Claude Code applies only the last, so a second flag would drop Firstmate's own value.
- **The policy holds when it rides in `--settings`.** With `allowUnsandboxedCommands: false` there, the sandbox
  becomes admin-required, and a repository's settings that try to loosen it are ignored. A stand-in worker then could
  not:
  - write a note, the wake queue or another task's status;
  - reach Herdr's socket;
  - see the first mate's process;
  - read its transcript or temp folder.

  It could still commit, append its own status, and reach GitHub over https, ssh and `gh`.
- **The repository's own settings are a risk.** Firstmate pre-trusts each worktree, and hooks run outside the
  sandbox, so a repository's committed hooks would run in its workers. With `--setting-sources user`, none of the
  repository's settings, skills, subagents or hooks loaded. Its `CLAUDE.md` loads again through `--add-dir <worktree>`
  and `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.

The captain approved this with four conditions:
- the sandbox is proven at runtime;
- reads of the vault and of credentials workers don't need are denied;
- the hosts are limited to GitHub and the npm, crates and PyPI registries;
- GitHub is recorded as a remaining exfiltration path.

## Decision

On a VPS, every Firstmate worker (a process with `FM_TASK_ID`) runs Claude Code in its sandbox. The first mate and the
captain's own sessions don't.

**The wrapper.** Kinas installs `~/.local/share/kinas/bin/claude`, a small sh script recorded as Kinas's, and puts
its folder first on the PATH of Kinas's Herdr unit, which every pane inherits. Without `FM_TASK_ID` it runs the real
Claude Code untouched.

With `FM_TASK_ID`, it runs `kinas companion worker-launch` first, which:
- checks the task id and Firstmate's arguments;
- checks that `bwrap`, `socat` and the seccomp helper are there;
- writes the worker's settings file, `~/.local/state/kinas/workers/<id>.settings.json`: Firstmate's own settings
  merged with Kinas's policy, the policy winning. Only `feedbackDrafts`, `attribution`, `model` and `effortLevel` are
  kept from Firstmate's; any other key refuses the launch.

The wrapper then removes the workers' unneeded key variables from the environment, sets the marker
`KINAS_WORKER_POLICY=<sha256 of the file>`, and runs the real Claude Code with:
- `--setting-sources user`, `--strict-mcp-config` and `--add-dir <worktree>`;
- Firstmate's arguments, its `--settings` value replaced by the file.

If any step fails, the worker doesn't start.

**The policy:**
- `sandbox`: `enabled`, `failIfUnavailable`, `allowUnsandboxedCommands: false`. Writes are allowed to the task's own
  status file only, beyond what Claude Code itself allows.
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

**Fail closed at runtime.** The companion proves the policy for every worker at each reading, and again before any
answer is written. That means:
- the marker, and the exact command line;
- the settings file unchanged and equal to today's policy;
- every tool command outside the host PID namespace, under the seccomp filter;
- the helper, `bwrap` and `socat` present, the captain's user and managed settings loosening nothing, and
  Firstmate's crew harness being Claude Code.

One failing worker turns the "Workers sandboxed" row red and stops every answer. The companion refuses to write a
note until no failing worker is left.

Putting the wrapper on the panes' PATH takes one restart of Herdr's server, which closes its panes. It is a separate
click with a warning.

## Consequences

**What stays open, and is accepted:**
- **GitHub itself remains an exfiltration path.** A worker holds the git key and `gh`'s token, so it can send data
  out through a gist, a new repository, an issue or any repository the token reaches. The planned next step is a
  per-task fine-grained token scoped to the task's repository.
- Workers can read and write each other's temporary files (`/tmp/claude-<uid>` is one folder).
- Workers lose a repository's own skills, subagents and MCP servers.
- Workers can't change `.claude/**` or `.mcp.json`. Kinas flags any worker branch or pull request that touches them
  for the captain's review, because a merged hook would run in the captain's own unsandboxed sessions.
- no-mistakes mode can't run sandboxed: its daemon runs the repository's commands outside the sandbox. So sandboxed
  workers ship by direct pull request or locally only.
- Secondmates aren't marked and aren't sandboxed; Kinas doesn't enable them.
- The runtime check's rule for telling a tool command from Claude Code's own helpers comes from a measurement of
  2.1.332. It is measured again in the acceptance run when Claude Code changes.

If the captain's acceptance run fails, a separate Unix user (or containers) comes next.

Enforced by:
- `cli/src/companion/worker.ts` and `worker.test.ts`;
- `setup.ts` (the row), `install.ts` (the item) and `firstmate.ts` (the gate on notes);
- `docs/external/firstmate-home.md` and `vps.md`.
