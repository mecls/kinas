# 0011 · The repository is public; the private-names check runs on every added line

Date: 2026-09-14
Status: accepted

## Context

Kinas is open source and runs a company whose clients are not: their names, their folder names and paths under the projects root appear constantly in the captain's own sessions, in planning documents, in fixtures copied from real runs and in commit messages written in a hurry. A public repository has no undo — a name pushed once is in every clone and every cache. Build 1's acceptance check AC-10 (2026-09-14) made the rule mechanical; the process half-day of 2026-09-22 widened what is tracked under `tasks/` and so widened what the check covers. Recorded here on 2026-09-22.

## Decision

The names that must never appear are kept in `scripts/private-names`, which is itself git-ignored, so the list is never in the repository either. Every added line and every commit message is checked against it before a PR, and AC-10 greps the whole tracked tree. Planning documents stay on the captain's Mac — `tasks/` is ignored except the templates and, per feature, its status file, PRD and mockups — and the split is pinned by a test so an edit to `.gitignore` cannot leak a spec silently. Fixtures use synthetic names carrying a marker (`9c2e`) that doubles as the log-leak probe (ADR 0007). Agent-facing documents (`docs/`, `AGENTS.md`, `DESIGN.md`, the templates, status files and PRDs) carry names and scopes, never a value: AC-10 greps them for secret patterns too.

## Consequences

A PRD is public from the day it is written, so it is written that way; the build spec and the architecture document, which name paths and hold the captain's words, are not. A tracked document that must mention a client says "the first customer". Enforced by `scripts/acceptance.sh` AC-10 (the private-names grep, the secret-pattern grep over the agent-facing documents, the release binary's `strings`), `.gitignore`, and `scripts/gitignore.test.ts` (the tracked/private table).
