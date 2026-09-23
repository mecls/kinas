# 0015 · Kinas's only words to the first mate are one fixed sentence, passed as its launch argument

Date: 2026-09-23
Status: accepted

## Context

Build 3 puts Firstmate — the first mate, on Claude Code — in a pane Kinas launches (ADR 0014), and anything typed into that pane is an order to it; ADR 0003 keeps Kinas from typing into any pane. The captain's plan of 2026-09-23 asked for one exception: Add to crew on a client folder should hand the first mate the ask to take that repository on. Firstmate holds one primary session per home (`state/.lock`), so a second first mate started to carry the ask would be read-only. Settled with the captain at the first mate's Gate 1 on 2026-09-23 (`tasks/first-mate/prd.md`, rule 3).

## Decision

The only words Kinas ever puts to the first mate are one constant sentence — `Add the project https://github.com/<owner>/<repo> to the crew: clone it from GitHub, not from my desk, and ask me which mode it ships in.` — and they travel only as the single launch argument of `claude` when Kinas starts the first mate through Herdr's CLI (ADR 0003), never typed. The sentence's one variable part is a GitHub URL that Kinas builds from a client folder's `origin` and accepts only when its owner and name are letters, digits, `.`, `_` and `-`. Nothing anyone typed, nothing read from a file and no folder path enters that command. When the first mate is already running, Kinas says nothing to it: the sentence goes on the clipboard and the first mate's pane is shown, for the captain to paste.

## Consequences

Adding a repository to the crew from the desk costs one click while the first mate is stopped and one paste while it runs; every other ask stays the captain's to type. The sentence holds no quote character and the URL no shell metacharacter, so the argument arrives exactly as built whether Herdr hands the command to a shell or not. The desk's path never reaches the crew, so the two copies of a repository stay apart (ADR 0014). A second sentence, a template with more variables, or words reaching a running first mate by any route is a new record that supersedes this one. If the first mate's slice 0 finds that Firstmate's session start does not take a first ask as an argument, the clipboard becomes the only route and this record still holds. Enforced, once Build 3 lands, by the launcher's argv test and its negative control (an `origin` with a quote, a space or `$` is refused and nothing launches) and by the Add to crew end-to-end case (`tasks/first-mate/prd.md` AC-17: the stand-in for `claude` records exactly the sentence as one argument; with the first mate running, nothing reaches its pane); until then by `tasks/first-mate/prd.md` rule 3.
