# The VPS where the agents run

## What it is

One Linux machine with systemd that the captain owns or rents — a rented VPS or a home lab — where every agent session
runs when Settings → Where agents run is set to a VPS (ADR 0024, which superseded 0021 on 2026-11-24): Herdr's
`default` session with the captain's own Claude Code and Pi sessions, Firstmate's first mate and its workers, and
Kinas's companion. The Mac then runs Kinas only. Without a VPS set, nothing here applies.

## Where

- **On the Mac:** the settings `place`, `vps_target` (`user@host`, `host`, `host:port` or an ssh-config alias) and
  `vps_label`; OpenSSH at `/usr/bin/ssh` with the captain's own `~/.ssh` and agent; Kinas's control socket under its
  data directory (`ssh/`).
- **On the VPS** (any distribution with systemd and a user manager; the captain's is Debian 13), as the captain's user,
  never root:
  - `~/.local/bin/kinas` — the Kinas CLI for Linux, whose `kinas companion` is the only thing that acts there for Kinas;
  - `~/.local/state/kinas/` — the companion's latest reading, its event log and its cursors;
  - `~/.config/kinas/companion.env` (mode 0600) — `KINAS_COMPANION_SECRET` and `CONVEX_URL` (see `kinas-cloud.md`);
  - `~/.local/share/kinas/firstmate` — Firstmate's home at the pin (`FM_HOME`; see `firstmate-home.md`);
  - `~/.local/bin/herdr` — Herdr, run by that path (never looked up on a PATH); `hello` reports its version, which
    Settings shows beside the Mac's;
  - `~/projects/` — the client repositories' working copies (`KINAS_ROOT` there). Amended 2026-11-25 (slice 5.3, the
    captain's word): the projects folders are the `roots` list in `~/.config/kinas/config.json` when it is set (the
    captain's: `~/miraside` and `~/personal`). `kinas context`, the session hook and the companion's check, Clone and
    Open in the terminal read it, and Kinas never makes a folder named there. Without it, `~/projects`;
  - systemd user units `kinas-herdr.service` (`herdr server --session default`) and `kinas-companion.service`
    (`kinas companion run`), with lingering enabled by the captain (`loginctl enable-linger`, which needs root). Each
    unit sets `PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin`; the companion adds Node's directory (fnm's `default`
    alias, then Volta) for its children, because neither the door's non-interactive ssh nor systemd reads `.bashrc`;
  - a Herdr the captain installed (`~/.local/bin/herdr`) or a `default` server already running is the captain's: it is
    reported, never overwritten, and moved under `kinas-herdr.service` only on the captain's click (ADR 0024).
  - Amended 2026-11-25 (setup, slice 4): `hello` reports setup's checks, one row per piece; each Install is one item
    (`kinas companion rpc` `install`), refused as root. A binary in `~/.local/bin` is written only where none is or over
    a copy Kinas wrote and that is unchanged since (amended the same day: Kinas's record of what it wrote,
    `~/.local/state/kinas/written.json`, mode 0600 — path, release, version and the SHA-256 of the bytes it put there —
    replaces the pinned-SHA-256 test, which took the captain's own byte-identical Herdr for Kinas's and could never
    recognise an unpacked archive's binary; a copy the record does not name, or that has changed, is the captain's); a unit only where none is or over one whose first line is Kinas's
    header. `kinas-herdr.service` runs `HERDR_SESSION=default ~/.local/bin/herdr server --session default` (Firstmate's own start), and both units set `PATH=~/.local/bin:~/.local/share/fnm/aliases/default/bin:/usr/local/bin:/usr/bin:/bin` (the captain, 2026-11-25); before it
    starts, the companion writes Firstmate's `firstmate-server-owner` marker (`systemd user unit kinas-herdr.service`)
    beside the session's socket, so Firstmate never starts a second server; adopting a running server also writes
    `firstmate-server-replacing` for the change and runs `herdr --session default server stop`. Firstmate is cloned
    beside its home and renamed in. Client folders are cloned with `gh repo clone <owner/repo> <first projects folder>/<folder>`,
    the repository read from the Mac's own folder's origin. Kinas's own Linux binary comes from the release of the
    installed version (`kinas-linux-x64`, `kinas-linux-arm64`); until one is published, Settings gives the two steps by
    hand.
  - Amended 2026-11-25 (the answer path, ADRs 0026 and 0027):
    - `~/.local/share/kinas/first-mate-relay.md`: the first mate's relay instruction, passed at launch.
    - `~/.local/share/kinas/bin/claude`: the workers' wrapper. Its folder is first on `kinas-herdr.service`'s PATH, which takes one restart of Herdr's server, on the captain's second click.
    - `~/.local/state/kinas/workers/<id>.settings.json` (0600): each worker's settings.
    - `~/.local/state/kinas/workers/<id>.launch.json` (0600, ADR 0028): the worker's worktree, and the sha256 of Firstmate's `.claude/settings.local.json` at launch. The worktree scan reads it.
    - In each task clone's `.git/info/exclude` (ADR 0028): one root-anchored line for each path Claude Code's sandbox protects that was missing from a worktree at launch (its empty placeholders), under Firstmate's own `.claude/settings.local.json` line. Lines are only added.
    - Workers run in Claude Code's sandbox, which needs `bwrap`, `socat` and `@anthropic-ai/sandbox-runtime` in Node's global folder (the seccomp helper `vendor/seccomp/<arch>/apply-seccomp`).
    - All four files are in Kinas's record. The runtime check reads `/proc` for the user's own processes: environment, command line, PID namespace and seccomp mode.
    - The reserved paths no worker may read: `~/vault`, `~/.config/last30days`, `~/.config/brain`, `~/.config/search.env`, `~/.config/parallel.env`, `~/.config/agentwikis.env`, `~/.local/share/com.vercel.cli`, `~/.now`, `~/.local/share/now`, `~/.config/obsidian-headless` and `~/.local/state/kinas`. Amended 2026-11-26 (the captain's word): and `~/backups`,
      where every Kinas backup and staged file goes, in `~/backups/kinas/<date>-<purpose>/`. Those copies hold Firstmate
      settings, `~/.claude.json` and test transcripts.
  - Amended 2026-11-26 (slice 5b, ADR 0029, superseding "the git key and `gh` stay readable"):
    - **Reserved reads:** the workers' list also holds `~/.ssh`, `~/.config/gh`, `~/.git-credentials`,
      `~/.config/git/credentials`, `~/.netrc` and the App's folder. A worker pushes only with its task's own token
      (`github-app.md`).
    - `~/.local/share/kinas/bin/kinas-git-credential`: git's credential helper, beside the wrapper and in Kinas's
      record.
    - **Each worker's token folder:** `~/.local/state/kinas/workers/<id>/` (700), and `<id>.github.json` beside it.
    - **Its own temp folder,** `/tmp/kw/<first 8 hex of sha256(id)>` (700, in `/tmp/kw`, 700). The wrapper passes it
      as `CLAUDE_CODE_TMPDIR`, and the package managers' caches are under it. `/tmp/kw` and `/tmp/claude-<uid>` are
      hidden from workers.
    - **The launch record** also keeps that folder, the commit `origin/HEAD` named and the clone's local default branch
      with its commit.
    - **The wrapper** also unsets `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN` and
      `SSH_AUTH_SOCK`.
    - **The runtime check** also wants each worker's environment free of those, its own temp folder, and its token
      folder there.
- **Claude Code** at `~/.local/bin/claude`, signed in by the captain, in the VPS's terminal, with their own
  subscription. `ANTHROPIC_API_KEY` must not be set there: its presence (never its value) is checked.
  - Amended 2026-11-25 (slices 5.1 and 5.3). The captain installs two scripts there by hand, each staged by Kinas
    in the home folder with its sha256 and tested there first. Kinas never writes under `~/.claude`.
    - The status line writes `~/.local/state/kinas/claude-rate-limits.json`.
    - The `SessionStart` hook is `integrations/claude-code/kinas-context.sh`, the Mac's own.

    Both exit at once in a worker and treat their input as data only. Both sit outside every worktree, where a
    sandboxed worker can't write (ADR 0028).

## Who reads it

- `app/src-tauri/src/remote.rs` — the one door: `ssh <fixed options> <target> .local/bin/kinas companion rpc`, the
  request on stdin (ADR 0024).
- `app/src-tauri/src/pty.rs` — the Work page: `herdr --remote <target> --session default`.
- `cli/src/companion/` — on the VPS: Firstmate's listed commands (ADR 0022), Herdr's API, `gh pr view`, the statusline
  hand-off, transcript token counts, `/proc` for the host reading.
  - As built, slice 5.1 (2026-11-25), `cli/src/companion/machine.ts`, at each reading:
    - the hand-off `~/.local/state/kinas/claude-rate-limits.json`, verbatim (64 KiB at most, never through a link),
      with its modification time;
    - the last assistant line's time in the last 512 KiB of `~/.claude/projects/*/<session_id>.jsonl`, for the
      session the hand-off names;
    - `/proc/stat`, `/proc/meminfo` and `statfs` of the home folder.

    At most every 5 minutes, it recounts tokens by day and model over `~/.claude/projects` (the last 31 days). Only
    the counts and the hand-off cross; a transcript's text never does.

## What it can do

Everything the captain's user can on that machine. The companion is limited by its code, not by the machine: a fixed
list of commands, no root, no shell strings.

## Never

- Kinas creating, sizing, rebuilding, paying for or deleting a server, or provisioning it through a provider's API (the
  Hostinger token stays GET-only, `hostinger-token.md`).
- Kinas holding an SSH key, reading `~/.ssh`, or putting a host, a path or ssh's error text in the log.
- Anything run as root by Kinas; anything written under `~/.claude` on the VPS by Kinas.
- A worker on the VPS started outside Kinas's sandbox while answers flow: the companion refuses every answer until none is left (ADR 0027).
- A second account, or someone else's work, on the VPS's Claude Code; an `ANTHROPIC_API_KEY` in its environment.
- Code, diffs, briefs, reports, transcripts, paths or branch names copied off the VPS (ADR 0023).
