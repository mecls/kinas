# 0009 · Every path is re-checked by Rust on every command; nothing is trusted because the CLI checked it

Date: 2026-09-15
Status: accepted

## Context

`kinas open` reaches the running app through a Unix socket in the data directory. The CLI resolves the path the user typed, but the socket accepts any local process — a script, an agent, anything running as this macOS user — and a process can write whatever line it likes. The webview is no better a witness: a document it renders may have been written by an agent (ADR 0010). So a check done once, somewhere else, is worth nothing to Rust. The reader's PRD made this rule R9 in Build 2 (2026-09-15). Recorded here on 2026-09-22.

## Decision

Every reader command re-checks its path, every time, in Rust: canonicalised on disk after symlinks, then judged against the projects root or a path the captain allowed by an explicit click in the app. The socket handler applies the same check and can never allow a path itself — a path outside the root is opened only by a click. A folder listing re-checks every entry; an image re-checks its own path; an export re-checks the path it was given even though it was opened moments ago. The socket handler reads no file contents, only canonicalises and stats, so a slow or hostile file cannot stall it.

## Consequences

`checked()` is the first line of every command that takes a path, and a new command copies that line before anything else. The projects root is read on every call, so a settings change applies without a restart. Enforced by `app/src-tauri/src/reader/access.rs:1-3`, `:225-227` (`permitted`), `app/src-tauri/src/reader/mod.rs:129-136` (`checked`) and its callers at `:162`, `:212`, `:228`, `:421`, `:446`, `app/src-tauri/src/reader/pins.rs:129`, `app/src-tauri/src/reader/export.rs:145-149`, and `app/src-tauri/src/reader/socket.rs:105-169` (the handler, pure apart from canonicalize and stat, tested without a socket).
