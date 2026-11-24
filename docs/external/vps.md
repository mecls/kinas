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
  - `~/projects/` — the client repositories' working copies (`KINAS_ROOT` there);
  - systemd user units `kinas-herdr.service` (`herdr server --session default`) and `kinas-companion.service`
    (`kinas companion run`), with lingering enabled by the captain (`loginctl enable-linger`, which needs root). Each
    unit sets `PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin`; the companion adds Node's directory (fnm's `default`
    alias, then Volta) for its children, because neither the door's non-interactive ssh nor systemd reads `.bashrc`;
  - a Herdr the captain installed (`~/.local/bin/herdr`) or a `default` server already running is the captain's: it is
    reported, never overwritten, and moved under `kinas-herdr.service` only on the captain's click (ADR 0024).
- **Claude Code** at `~/.local/bin/claude`, signed in by the captain, in the VPS's terminal, with their own
  subscription. `ANTHROPIC_API_KEY` must not be set there: its presence (never its value) is checked.

## Who reads it

- `app/src-tauri/src/remote.rs` — the one door: `ssh <fixed options> <target> .local/bin/kinas companion rpc`, the
  request on stdin (ADR 0024).
- `app/src-tauri/src/pty.rs` — the Work page: `herdr --remote <target> --session default`.
- `cli/src/companion/` — on the VPS: Firstmate's listed commands (ADR 0022), Herdr's API, `gh pr view`, the statusline
  hand-off, transcript token counts, `/proc` for the host reading.

## What it can do

Everything the captain's user can on that machine. The companion is limited by its code, not by the machine: a fixed
list of commands, no root, no shell strings.

## Never

- Kinas creating, sizing, rebuilding, paying for or deleting a server, or provisioning it through a provider's API (the
  Hostinger token stays GET-only, `hostinger-token.md`).
- Kinas holding an SSH key, reading `~/.ssh`, or putting a host, a path or ssh's error text in the log.
- Anything run as root by Kinas; anything written under `~/.claude` on the VPS by Kinas.
- A second account, or someone else's work, on the VPS's Claude Code; an `ANTHROPIC_API_KEY` in its environment.
- Code, diffs, briefs, reports, transcripts, paths or branch names copied off the VPS (ADR 0023).
