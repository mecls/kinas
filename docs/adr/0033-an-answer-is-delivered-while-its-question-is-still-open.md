# 0033 · An answer is delivered while its question is still open, read from a fresh reading, not only from the hold

Date: 2026-11-26
Status: accepted

## Context

ADR 0025, which ADR 0026 carries ("Everything else in ADR 0025 stands"), says the companion asks `bash
<home>/bin/fm-captain-hold.sh open <task id> --distinguish-absent` before writing an answer's note, "and writes
nothing unless it exits 0".

That command answers one question: is the task's backlog row an open captain hold? A worker's own question is
something else. It is a `needs-decision [key=…]` line in the worker's status log, which Firstmate's snapshot lists
as the task's open decisions, and `open` never sees it. In the acceptance run of 2026-11-25, 4 of 5 answers arrived
before any hold opened, and the first mate relayed them correctly. The rule as written would have refused all four.

On Firstmate as pinned (`427056c`), `open` has two more exits: 2 when it can't tell, and 3 when the task is absent.
`fm-inbox.sh note` exits 3 when the note is saved but the first mate wasn't woken. ADR 0025 gives none of these a
meaning.

The captain approved slice 6's design change on 2026-11-26 (build spec §12, slice 6).

## Decision

ADR 0026 stands, and everything in ADR 0025 it carries, except the sentence "and writes nothing unless it exits 0",
which this record replaces.

When an answer arrives, the companion takes a fresh reading: `fm-fleet-snapshot.sh --json`, one of ADR 0020's four
scripts. It writes the note only while the question is open:
- **A worker's question** is open while its key is still among that task's open decisions in the reading.
- **A captain hold** is open while `fm-captain-hold.sh open <task id> --distinguish-absent` exits 0.

Anything else is not open, and nothing is written:
- **`open` exit 2:** Firstmate couldn't tell, so nothing is written and the captain is told so.
- **`open` exit 3:** the task is absent, so the question is not open.

A note `fm-inbox.sh note` saved is delivered, including exit 3, where the first mate reads it at its next turn rather
than at once.

## Consequences

- **An answer to a worker's question no longer waits for the first mate to open a hold.**
- **A question closed between the reading and the note** can still receive one note. The first mate reads it and
  finds the key closed. The window is the time a reading takes, and the note says which key it answers.
- **The commands Kinas may run in Firstmate don't change.** The snapshot was already among them. Kinas still writes
  only `fm-inbox.sh note`.
- **Enforced by** the companion's `answer` verb (`cli/src/companion/answer.ts`, slice 6.1) and its tests.

Supersedes 0026.
