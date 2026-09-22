# 0007 · No file's contents and no file's path ever reach the log

Date: 2026-09-15
Status: accepted

## Context

The reader opens any file under the projects folder — client work, plans, credentials someone left in a README — and the app's log is a plain file that outlives the session, rotates into five more, and is the first thing pasted when something goes wrong. A log line that names a path names a client; one that quotes a line of content quotes whatever was in it. The reader's PRD made this rule R9 (Build 2, 2026-09-15) and the same week showed why logs need to be kept rather than cut: on 2026-09-16 the plugin's one-file log rotation threw away the evidence twice while a frozen window was being diagnosed. Recorded here on 2026-09-22.

## Decision

The log holds durations, counts, byte totals, states and exit codes, and nothing that came out of a file or names one: not a path, not a folder, not a label, not a line of content, not a third party's error text that could echo a path (Herdr's messages repeat `--cwd`). `kinas status --json` follows the same rule. The one path the app stores is a pin, by explicit click, in a settings key that `kinas status --json` does not read. The log keeps 2 MiB × 5 files so that evidence survives a diagnosis.

## Consequences

Log lines are dull by design — `reader: rendered 97 lines, 0 diagrams in 234 ms` — and debugging a specific file is done by reproducing, not by reading the log. Every e2e fixture carries a marker in its file names (`9c2e`) and the specs assert the marker never appears in the log. Enforced by `app/src-tauri/src/reader/mod.rs:140-143`, `:437-440` (the rule) and its log lines at `:151`, `:192`, `:391`, `:458`, `app/src-tauri/src/reader/export.rs:222`, `app/src-tauri/src/reader/pins.rs:8-10`, and `e2e/specs/reader-terminal.e2e.ts:198-200`, `e2e/specs/reader-export.e2e.ts:100-107` (`logLines("9c2e")` is empty).
