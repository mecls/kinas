# The Claude Code status-line hook

## What it is

Kinas never reads Claude Code's login and never talks to Anthropic (Anthropic's credential rules forbid it). Instead Claude Code hands Kinas its own plan limits: three lines added by the captain to `~/.claude/statusline-command.sh`, directly after `input=$(cat)`, that write the `rate_limits` object Claude Code passes to its status line into a file Kinas watches. `README.md` → Connecting the two plans → Claude has the lines; Settings (⌘,) shows them with Copy buttons and whether the hook is being received.

## Where

- The script: `~/.claude/statusline-command.sh` (the captain's, outside the repository).
- The inbox file it writes: `~/Library/Application Support/ai.sintralabs.kinas/inbox/claude-rate-limits.json` — `{rate_limits, session_id, captured_at}`, written to a `.$$` temp file and moved into place with `mv -f`.

## Who reads it

`app/src-tauri/src/readers/claude_plan.rs` (`INBOX_FILE`), on the poller's cadence, for the Claude gauges on the Usage page and in the menu bar. That module reads this file and the session's transcript, nothing else (PRD R17). Token counts come separately from the transcripts under `~/.claude/projects` through `readers/logs.rs`, read-only, with `KINAS_CLAUDE_PROJECTS_DIR` pointing tests elsewhere.

## What it can do

Nothing beyond writing that one file with a `jq` projection of the status-line input — the comment in the snippet says "nothing else from this input", and that is the whole contract.

## Never

- A `refreshInterval` in the status-line config: a timer re-run would stamp old numbers as fresh.
- Kinas reading anything else under `~/.claude` — not the credential, not the settings — and never calling Anthropic. The same rule is why Kinas never runs `quota-axi` (see `firstmate-home.md`).
- Kinas writing under `~/.claude`: the hook is installed by the captain, by hand.
