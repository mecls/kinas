# 0013 · Kinas v1 is local; the server-side topology is reached by swapping seam occupants

Date: 2026-09-14
Status: accepted

## Context

The reference design for Kinas describes a company operating system with a server: a shared store, agents on remote machines, approvals that reach a phone, a deployer. Building that first would mean months without a usable app and a topology chosen before any of it had been run. Build 1 (2026-09-14) chose the other order — an empty castle first, then one room at a time, everything on one Mac — and wrote the reason into the README's first paragraphs: local first, one person first, no server, no SSH, no API bill. Recorded here on 2026-09-22.

## Decision

Kinas is built as a castle: it decides the contracts, the doors, the gates and the record, and everything inside is a seam with a default occupant that runs locally — the harness (Claude Code, Pi), the store (one SQLite file, read-only from the CLI), the session runtime (Herdr), the build conductor (Firstmate, ADR 0014), the review loop, the channel, the providers (each a read-only source). Every seam is read through one contract (`settle()` for a context source; a `KeyStore`; a reader's `write_reader_status`) and a missing occupant becomes one honest line, never a crash and never a fake number. The server-side topology is reached by swapping occupants behind those contracts — a Convex-backed store, a remote runtime — not by rewriting the castle.

## Consequences

Nothing in the app may depend on an occupant's private shape; when a feature needs something an occupant does not provide, the contract grows and every occupant implements it. Debug seams (`KINAS_E2E_*`) follow the same rule: a seam replaces the question, never the rules. Enforced by `README.md:4-12` (the castle paragraph), `README.md:62-72` (one read-only source per section), `packages/context/src/source.ts:1-2`, `:21-29` (`settle`), `packages/store/src/types.ts:2` (the store seam), `packages/commands/src/registry.ts:10` (the two doors), and `integrations/README.md:1-6` (the harness seam).
