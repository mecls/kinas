# `~/.local/bin/kinas`

## What it is

The `kinas` command on the captain's PATH is a symlink to the CLI inside the running app bundle: `/Applications/Kinas.app/Contents/MacOS/kinas-cli` (PRD R35). Inside the bundle the CLI is `kinas-cli`, because `kinas` and `Kinas` would be the same file on the case-insensitive disk; the link on PATH is still called `kinas`.

## Where

`~/.local/bin/kinas`, managed by `app/src-tauri/src/cli_link.rs` at every launch. Session-start integrations (`integrations/`) find the CLI through `KINAS_BIN` when it is not on PATH.

## Who reads it

Every shell, every session hook, and every agent that runs `kinas open`, `kinas context` or `kinas status`. The CLI itself opens the store **read-only** (ADR 0001) and talks to the app over the Unix socket `kinas.sock` in the data directory.

## What it can do

Point at whichever `Kinas.app` is running. After a ship the new bundle's launch repoints it; `kinas status` exiting 0 from a fresh shell is the check that it did (the ship procedure in every build spec).

## Never

- Clobber somebody's own `kinas`: the link is created when missing and repointed only when it already points into a (moved) `Kinas.app`. A regular file, or a link to anything else, is left alone and Settings shows the conflict instead of replacing it (`LinkStatus`).
- Be pointed at a debug build: an app running outside a `Kinas.app` bundle (development, the e2e harness) has no bundled CLI to link and returns `NoBundle` without touching anything (`ensure_for_running_app`).
