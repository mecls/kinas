# 0004 · A failed read never overwrites a good value

Date: 2026-09-14
Status: accepted

## Context

The Usage page exists to answer one question — how much of what we pay for is left — and it reads that from providers that fail in ordinary ways: a 401, a timeout, a beta endpoint whose payload changed, a status-line hook that has not fired yet. The natural failure mode of a poller is to write what it got, and what it got on a failure is nothing, which renders as 0 % used. Build 1's PRD named that "the most dangerous wrong answer this page can give" (rule R12, 2026-09-14): a gauge that falls to zero reads as the whole plan being left. The same rule is why the Claude status-line hook must not carry a `refreshInterval` — a timer re-run would stamp old numbers as fresh. Recorded here on 2026-09-22.

## Decision

A reader changes stored values only on a successful, complete read. A failure records the attempt — `state`, `last_attempt_at`, a redacted `last_error` — and keeps `last_success_at` and every number as they were; a partial read writes nothing and lets the previous row age into "stale". The UI shows the failure beside the last reading ("showing the last reading"), never an empty state. On the CLI side a source's timeout keeps the previous good reading with its own timestamp.

## Consequences

A wrong number can persist until the next good read, which is why staleness is shown once per section and a stale bar is drawn in its own colour (DESIGN.md §2.2). Every reader's tests include a "failures keep the previous values" case. Enforced by `app/src-tauri/src/redact.rs:81-96` (`write_reader_status`, `COALESCE(excluded.last_success_at, reader_status.last_success_at)`, tested at `:150-161`), `readers/convex/mod.rs:462-480`, `readers/hostinger/mod.rs:745-767`, `readers/claude_plan.rs:353-357`, `packages/context/src/source.ts:20-26`, and `app/src/pages/Usage.tsx:108-118`.
