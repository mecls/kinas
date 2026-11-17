# 0021 · Agents may run on one VPS the captain rents; Kinas reaches it through one door, holds no key and never provisions it

Date: 2026-11-17
Status: accepted

## Context

ADR 0013 kept Kinas v1 on one Mac and said the server-side topology would be reached by swapping seam occupants, "a
remote runtime" among them. On 2026-11-16 the captain asked for every agent — their own Claude Code and Pi sessions
and the crew — to run in the cloud, with Kinas as the dashboard (`tasks/cloud-factory/prd.md`). Herdr already attaches
a remote server over SSH (`herdr --remote`), and Firstmate runs on Linux with a headless Herdr in its own CI. Until now
Kinas reached no other machine, and its README said so.

## Decision

Kinas has a place setting: this Mac (the default, everything as before) or one VPS, named by an SSH target and a
label. With a VPS set, every agent session runs there and the Mac runs Kinas only. Kinas reaches the VPS through one
door: the file `app/src-tauri/src/remote.rs` is the only code in the app that runs `ssh`, always `/usr/bin/ssh` with a
fixed argv — batch mode, connect and keepalive limits, a control socket under Kinas's data directory — then the
validated target and the constant remote command `kinas companion rpc`. The request travels as one JSON document on
the child's stdin; no shell string is ever built from anything a source, a setting or the captain wrote, and the
target is refused when it starts with `-` or holds whitespace or a shell metacharacter. On the VPS, `kinas companion`
runs as the captain's user, never as root, and is the only thing that runs Herdr's and Firstmate's commands there for
Kinas. Kinas holds no SSH key and no other credential for the machine: OpenSSH and the captain's agent do. Kinas never
creates, sizes, rebuilds, pays for or deletes a server. The Work page attaches the VPS's Herdr `default` session with
`herdr --remote <target> --session default`, also a fixed argv.

## Consequences

The crew pages read the VPS by the same parsers and rules as the Mac, and Kinas keeps working on the Mac alone when the
place is this Mac. Every remote call can fail, so each one is a reading that may be stale (ADR 0004), runs off the main
thread and never under the store lock (ADR 0005), and logs only the verb, the outcome and a fixed reason, never a host,
a path or ssh's own words (ADR 0007). A second remote command, a second way to reach the machine, or Kinas holding a key
is a new record. Enforced by `app/src-tauri/src/readers/crew/guard.rs` (`ssh` named only in `remote.rs`, argv only, with
a negative control), by `remote.rs`'s argv and target tests, and by `docs/external/vps.md`.
