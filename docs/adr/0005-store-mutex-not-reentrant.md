# 0005 · The store's mutex is not re-entrant

Date: 2026-09-16
Status: accepted

## Context

`Store::conn()` hands out the one SQLite connection behind a plain `std::sync::Mutex`. A plain mutex is not re-entrant: a thread that already holds the guard and asks for it again waits for itself, forever. On the first prod install, 2026-09-16, the app's first `get_settings` did exactly that — a helper it called took `Store::conn()` while the caller still held the guard — and the whole window froze, terminal included, with no error anywhere. A second variant bit the same day in a reader loop that held the guard across a network request. Recorded here on 2026-09-22.

## Decision

Never take `Store::conn()` while holding its guard, on any thread. Helpers that need the connection take `&Connection` as a parameter (`projects_root(conn, org_id)`), and the callers that hold no guard use the paired `_of(store)` form. A guard is held for the reads and writes that need it and nothing else: never across a child process, a file read, a network request or a call into another module that might lock. Reader loops read their inputs under one guard, release it, do the work, and take a fresh guard to write.

## Consequences

Some code reads more awkwardly — everything destructured out of one `let conn = store.conn();` block — and that awkwardness is the point: it is visible. The mutex is not replaced by a re-entrant one, because a re-entrant lock would hide the same held-across-I/O mistake instead of freezing on it. Enforced by `app/src-tauri/src/paths.rs:26-38` (the signature and the dated reason), `app/src-tauri/src/commands.rs:84-100`, `app/src-tauri/src/reader/pins.rs:17-19` (the one order every command follows), and `app/src-tauri/src/readers/runtime.rs:382-385`, `:527-531` (`with_conn`).
