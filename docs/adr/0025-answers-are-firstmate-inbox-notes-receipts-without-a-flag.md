# 0025 · With agents on a VPS, answers stay notes in Firstmate's inbox: receipts are read without a flag, and setup lets the first mate relay them

Date: 2026-11-24
Status: superseded by 0026

## Context

ADR 0022 sends the captain's answer to a held task as a note in Firstmate's inbox and reads whether it was handled with
`fm-inbox.sh receipts --json`. On 2026-11-24 the probe on the captain's home lab ran it end to end at Firstmate's pin
(`427056c`), with a first mate and two `claude` workers (build spec §19). Three things it found:
- `fm-captain-hold.sh open … --distinguish-absent` and `fm-inbox.sh note --request-id … --json -` behave as ADR 0022
  says. A note is created and announced, and a second note with the same request id comes back as a `replay`.
- `receipts --json` is refused (`unknown option for receipts: --json`, exit 1). Without a flag, `receipts` already
  prints JSON (`fm-inbox-receipts.v1`): `pending[]` and `handled[]`, each note with its request id, whether it was
  acknowledged and its reply, then `replies[]`, `reply_cursor` and `omitted[]`.
- The first mate runs in Claude Code's auto permission mode. It read the note and passed the answer to the worker with
  `bin/fm-send.sh`, which is its own job. The first time, auto mode blocked that call as an unwanted action. From then
  on, that session refused every later note on its own, saying the answer had come "through a local note file, not
  this chat".
- With an allow rule for the home's own `bin/fm-send.sh` in the home's git-ignored `.claude/settings.local.json`, a
  fresh first mate relayed the next note within 95 s. The worker wrote what the captain asked, the hold closed, and
  `receipts` showed the note handled with the first mate's reply.

## Decision

Everything ADR 0022 decides stands, with two changes.

With a VPS set, Kinas's answer to a held task — the line ADR 0017 defines, `On <task id> (<key>): <answer>` — reaches
the first mate as one note in Firstmate's inbox. `kinas companion` writes it on the VPS with `bash
<home>/bin/fm-inbox.sh note --request-id kinas-<request id> --json -`: the line goes on stdin, never in argv, and is at
most 8,192 bytes. Before writing it, the companion asks `bash <home>/bin/fm-captain-hold.sh open <task id>
--distinguish-absent` and writes nothing unless it exits 0.

It reads whether a note was handled, and the first mate's reply to it, with `bash <home>/bin/fm-inbox.sh receipts`.
This takes no flag, and its output is read only when it is `fm-inbox-receipts.v1`.

Those three commands join ADR 0020's four scripts, and no other Firstmate command is run: never `fm-send.sh`,
`fm-captain-hold.sh` `answer`, `answers`, `hold` or `reconcile`, or any script that spawns, tears down, holds, parks,
releases or closes. Closing or releasing a hold stays the first mate's own act, on reading the note. An answer is
delivered once for one open question or refused, and an answer older than 60 s is never delivered.

Setup on the VPS adds one permission rule to the Firstmate home's `.claude/settings.local.json`, which Firstmate
git-ignores. The rule lets the first mate run the home's own `bin/fm-send.sh` without auto mode's review, so relaying
a note is never left to it. The rule's entries are the home's `bin/fm-send.sh`, by its relative and absolute path,
each with and without the `FM_HOME=<home>` prefix. They are added to `permissions.allow` on the captain's click,
keeping everything already in the file, and no entry is ever removed or rewritten.

With the place set to this Mac, ADR 0017's clipboard path is unchanged.

## Consequences

The companion's fixed list (`cli/src/companion/firstmate.ts`) has `receipts` with no arguments. A Firstmate that
changes the receipt's schema must be read again before Kinas moves its pin.

Kinas now writes two things into Firstmate's home on a VPS: the note, and the one allow rule. Both are written by
Kinas, never run as Firstmate commands. A wider rule, a rule for another script, or a rule for anything outside the
home would need a new record.

Three things stay open after the probe:
- It could not tell whether the rule matched the first mate's own spelling of the command or whether auto mode passed
  it. The first mate sometimes writes the home through a shell variable, which no fixed rule matches.
- A session that was blocked once keeps refusing notes until it is restarted.
- Slice 4's setup check and the first real run on the machine must confirm a note is relayed, or the build stops
  there.

Enforced by:
- `cli/src/companion/firstmate.ts` and `firstmate.test.ts`;
- `app/src-tauri/src/readers/crew/guard.rs` for the Mac;
- slice 4's setup tests for the rule;
- `docs/external/firstmate-home.md`.

Supersedes 0022.
