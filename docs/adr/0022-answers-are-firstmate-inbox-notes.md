# 0022 · With agents on a VPS, the captain's answers reach the first mate as notes in Firstmate's inbox, and Kinas runs only the Firstmate commands listed here

Date: 2026-11-17
Status: accepted

## Context

ADR 0017 let an Inbox answer reach the first mate only on the clipboard, pasted by the captain into its chat, and ADR
0020 let Kinas run four read-only Firstmate scripts and write nothing that answers. With the agents on a VPS and the
captain answering from a phone (`tasks/cloud-factory/prd.md`, rules 16–17), there is no chat to paste into. Firstmate
at the pin keeps one surface for the captain's words when the captain is not in its chat: `bin/fm-inbox.sh note`,
which saves the words, wakes the first mate once and records when it handled them — its own voice relay uses it the
same way. Its keyed-answer intake (`fm-captain-hold.sh answers`) would instead close a call without the worker hearing
the words.

## Decision

Everything ADR 0020 decides stands, with these changes. With a VPS set, Kinas's answer to a held task — the same line
ADR 0017 defines, `On <task id> (<key>): <answer>` — reaches the first mate as one note in Firstmate's inbox, written by
`kinas companion` on the VPS with `bash <home>/bin/fm-inbox.sh note --request-id kinas-<request id> --json -`, the line
on stdin and never in argv, at most 8,192 bytes. Before writing it, the companion asks `bash <home>/bin/fm-captain-hold.sh
open <task id> --distinguish-absent` and writes nothing unless it exits 0. It reads whether a note was handled, and the
first mate's reply to it, with `bash <home>/bin/fm-inbox.sh receipts --json`. Those three commands join ADR 0020's four
scripts, and no other Firstmate command is run: never `fm-send.sh`, `fm-captain-hold.sh` `answer`, `answers`, `hold` or
`reconcile`, or any script that spawns, tears down, holds, parks, releases or closes. Closing or releasing a hold stays
the first mate's own act, on reading the note. An answer is delivered once for one open question or refused, and an
answer older than 60 s is never delivered. With the place set to this Mac, ADR 0017's clipboard path is unchanged.

## Consequences

The captain can answer from the phone or the Mac while the agents run elsewhere, and the first mate hears the words
exactly as if they had been typed in its chat, under all of its own guards — a release while the captain is marked
away is still refused by Firstmate. Kinas still types into no pane (ADR 0003). A note is the first thing Kinas writes
into Firstmate; a fourth Firstmate command, or a note carrying anything but the answer line, is a new record. Enforced
by `cli/src/companion/firstmate.ts` (the fixed list as a type) and its guard test with a negative control, by
`app/src-tauri/src/readers/crew/guard.rs` for the Mac, and by `docs/external/firstmate-home.md`.
