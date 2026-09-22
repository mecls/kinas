# 0001 · One writer: the app writes the store, the CLI opens it read-only

Date: 2026-09-14
Status: accepted

## Context

Kinas has one SQLite store, `kinas.sqlite`, and two processes that want it: the app, which runs the readers and holds the settings, and the `kinas` CLI, which any shell, session hook or agent may run at any moment, several at once. Two writers to one SQLite file in WAL mode is a lock fight that shows up as "database is locked" at the worst time, and a CLI that could write would also be a CLI that an agent could use to change what the app believes. Build 1's PRD settled it as rules R7–R10 (2026-09-14); recorded here on 2026-09-22.

## Decision

The app is the single writer of `kinas.sqlite`. The CLI opens it read-only (`?mode=ro`) and writes only its own cache beside it (`kinas-cli.sqlite`). Anything the CLI would need to change goes through the app — a command over the socket, or a setting in the app — never through the file. The app keeps the `-wal` and `-shm` files on disk after its last connection closes so the read-only open works while the app is quit. Migrations are forward-only and every table carries `org_id`.

## Consequences

A command that writes has no CLI door (`packages/commands/src/registry.ts:79`, the `refresh` command); the context cache lives in its own file (`packages/context/migrations/0001_context_cache.sql:2-4`); and a reader's results are never copied into the CLI's cache, they are read from the store. Enforced by `packages/store/src/sqlite-readonly.ts:29` (`{ readonly: true }` on the only open path the CLI has), `cli/src/main.ts:2-3`, and `app/src-tauri/src/store.rs:1`, `:77-79` (the WAL files kept for the read-only open, measured in Build 1 task 1.7).
