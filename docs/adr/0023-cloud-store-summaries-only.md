# 0023 · A cloud store in the EU holds only the factory's summaries, so the phone can see and answer while the Mac is closed

Date: 2026-11-17
Status: accepted

## Context

Kinas's state has been one SQLite file on the Mac, written only by the app (ADR 0001). With the agents on a VPS, the
captain wants the phone to show what waits on them, notify them and send answers while the Mac is closed
(`tasks/cloud-factory/prd.md`, rules 12–15). The VPS holds the client code, so the phone must not reach into it, and
the captain chose that only summaries leave it, to a store Miraside owns.

## Decision

A Convex deployment in Miraside's team, in the region `aws-eu-west-1`, holds the factory's summaries and nothing
else: task titles, project names, crew words, PR numbers and check counts; a held question's text (at most 2,000
characters) and its recommendation; timeline event names and times; the factory's events and numbers; usage
percentages and the VPS's health; the answers the captain submits from a phone, until delivered; and paired devices
with their push subscriptions. Never code, diffs, briefs, reports, transcripts, file paths, branch names, logs, keys or
tokens. Its schema's validators reject any other field. It has two kinds of writer: `kinas companion` on the VPS,
proved by a secret whose SHA-256 alone is stored in the deployment, and a paired phone, proved by a device token whose
hash alone is stored, which may only submit an answer, finish its own pairing and store its own push subscription.
The Mac app does not write to it. The local store stays the app's alone (ADR 0001); the companion's own records live in
its state directory on the VPS. Factory events are never deleted from the cloud store; waiting items and answers are
dropped 30 days after they closed.

## Consequences

The phone can work with the Mac closed, and nothing that could identify a client's code leaves the VPS. Kinas gains a
hosted dependency, a small bill (the EU region carries a surcharge) and a second store to keep in step with the
first. A new field in the store, a new writer, or the Mac writing to it is a new record. Enforced by
`cloud/convex/schema.ts`'s validators, by `cli/src/companion/cloud.ts`'s `summaryOf` (an explicit allowlist) and its
test that planted paths, branches, diffs and keys never reach a summary, by `cloud/convex/lib/auth.ts` and its tests,
and by `docs/external/kinas-cloud.md`.
