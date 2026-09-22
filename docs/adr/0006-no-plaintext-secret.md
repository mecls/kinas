# 0006 · No plaintext secret anywhere; the Keychain through `security` on stdin

Date: 2026-09-14
Status: accepted

## Context

Kinas holds three credentials for other people's services — the Ollama Cloud API key, the Convex deploy key, the Hostinger API token — and one of them (Hostinger's) can recreate a machine. A secret in the SQLite store is a secret in a file any local process can read; a secret in the log is a secret in a file that gets pasted into bug reports; a secret in a process's argv is visible to `ps` for as long as the process runs; and `security add-generic-password -w` typed at its prompt keeps only the first 128 characters, which Convex keys exceed. Build 1's PRD set rule R4 on 2026-09-14; the first "no secrets at rest" check ran minutes after the first key was saved. Recorded here on 2026-09-22.

## Decision

Every secret lives in the macOS login Keychain, service `ai.sintralabs.kinas`, one account per secret, and nowhere else: not in the store, the log, a config file, an env var, `kinas status --json` or `last_error`. Writes go through `/usr/bin/security -i`, which reads the whole command — secret included — from stdin, and every write is read back before it counts as saved. Every error string is redacted of bearer tokens and Anthropic-style key prefixes before it is stored or logged. Settings fields for secrets are write-only.

## Consequences

Unsigned rebuilds of Kinas do not re-prompt for Keychain access, because items created by `security` stay readable by it; the price is that the app shells out for every read. A new credential is a new account constant in `keychain.rs`, a `docs/external/` entry, and a grep in AC-10 — never a new storage path. Enforced by `app/src-tauri/src/keychain.rs:1-6`, `:65-85` (the `-i` write and the read-back) and its test `the_key_never_goes_through_argv` at `:167-175`; `app/src-tauri/src/redact.rs:7-8`; and `scripts/acceptance.sh` AC-10 (the store, the logs and `kinas status --json` grepped for every key's prefix, read from the Keychain rather than written in the script).
