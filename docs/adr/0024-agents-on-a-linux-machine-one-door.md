# 0024 · Agents may run on one Linux machine the captain owns or rents; the door is unchanged, and Kinas never replaces what it did not install there

Date: 2026-11-24
Status: accepted

## Context

ADR 0021 said the agents may run on "one VPS the captain rents". On 2026-11-19 the captain set up a home lab instead,
an always-on Debian 13 machine reached over Tailscale, and it is where the agents will run. On 2026-11-24 another agent
checked it read-only against `tasks/cloud-factory/` and found three facts the design had missed:
- a non-interactive `ssh` (the door) and a systemd unit get a PATH without `~/.local/bin` or Node;
- the captain's Herdr `default` session already runs there as a daemon, outside systemd;
- the captain installed a newer Herdr (0.9.5) than the Mac's (0.9.0).

The captain approved the amendment to the build that follows from these the same day (build spec §17, 2026-11-24).

## Decision

Kinas has a place setting: this Mac (the default, everything as before) or one Linux machine with systemd and a user
manager, which the captain owns or rents and already reaches with `ssh` and their own key. A rented VPS and a home lab
are the same to Kinas, which calls the machine "the VPS" in its settings and code. With the machine set, every agent
session runs there and the Mac runs Kinas only.

The door is ADR 0021's, unchanged:
- `app/src-tauri/src/remote.rs` is the only code in the app that runs `ssh`, always `/usr/bin/ssh` with a fixed argv
  (batch mode, connect and keepalive limits, a control socket under Kinas's data directory), then the validated target
  and the constant remote command `.local/bin/kinas companion rpc`, relative to the login directory;
- the request is one JSON document on stdin, and no shell string is ever built;
- Kinas holds no key and never creates, sizes, rebuilds, pays for or deletes a machine;
- the Work page attaches with `herdr --remote <target> --session default`.

On the machine, `kinas companion` runs as the captain's user, never as root. It runs every child (Firstmate's scripts,
Herdr, `gh`, `claude`) with a PATH it builds from constants (`~/.local/bin`, Node's directory from a fixed list, then
the system paths), never from a shell's startup files.

Kinas never replaces or stops what it did not install on the machine:
- a `herdr` binary that is not Kinas's own copy is reported, never overwritten;
- a Herdr server already running for the `default` session is moved under systemd only on the captain's explicit click,
  which says that it stops the server and its panes.

## Consequences

The design works unchanged on a home lab, a rented VPS or any Linux with systemd. The words "a VPS the captain rents"
give way to "a Linux machine you own or rent" in the PRD, the README and `docs/external/vps.md`.

Setup can find the machine already half set up by the captain. Each check reports what it found, including the
machine's Herdr version beside the Mac's, and offers an Install only where nothing of the captain's is in the way.

A second remote command, a second way to reach the machine, Kinas holding a key, or Kinas replacing a binary or
stopping a server of the captain's without a click would each need a new record.

Enforced by:
- `app/src-tauri/src/readers/crew/guard.rs` (`ssh` named only in `remote.rs`, argv only, with a negative control);
- `remote.rs`'s argv and target tests;
- the companion's `companion_path_order`, `herdr_service_refuses_beside_a_running_server` and
  `install_herdr_leaves_a_foreign_binary` tests;
- `docs/external/vps.md`.

Supersedes 0021.
