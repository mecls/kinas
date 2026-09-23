# 0017 · Kinas's words reach the first mate only as one launch sentence, or on the clipboard for the captain to paste

Date: 2026-09-23
Status: accepted

## Context

ADR 0015 let Kinas put one constant sentence to the first mate, as `claude`'s launch argument or on the clipboard while it runs, and said a template with more variables would be a new record. The first mate's slice 0 probe (2026-09-23) showed that Firstmate acts on a captain's call only when it arrives in the first mate's chat (ADR 0016), so the Inbox's Approve, Answer and Deny must reach that chat — and ADR 0003 keeps Kinas from typing anything into it. Settled with the captain on 2026-09-23 (`tasks/first-mate/prd.md` §7, answer 1A).

## Decision

Kinas puts words to the first mate in two forms and no others. The first is Add to crew's sentence, unchanged from ADR 0015: `Add the project https://github.com/<owner>/<repo> to the crew: clone it from GitHub, not from my desk, and ask me which mode it ships in.` It travels as the single launch argument of `claude` when Kinas starts the first mate through Herdr's CLI, or on the clipboard when the first mate is already running; its URL is built from a client folder's `origin` and accepted only when the owner and the name are letters, digits, `.`, `_` and `-`. The second is an Inbox answer line, `On <task id> (<key>): <answer>` — without the parenthesis when the key is the task's own id — whose answer is `Approved — go ahead.`, `Denied — <text>`, or the captain's text, and whose id and key are Firstmate's own, from the fleet snapshot. An answer line goes only on the clipboard: never into a launch argument, a file, a script or a pane. After either goes on the clipboard, Kinas shows the first mate's pane, and the captain pastes and presses Enter. Kinas types nothing (ADR 0003) and no Firstmate script carries either form (ADR 0016).

## Consequences

Add to crew costs one click while the first mate is stopped and one paste while it runs; an answer from the Inbox costs a click, a paste and Enter, and arrives as the captain's own message in the chat Firstmate trusts. The captain sees every word in the first mate's input before he sends it, and a line pasted by mistake is his to delete. The captain's typed text enters only the clipboard, so it never reaches a shell or an argv. A third form, a template with more variables, or words reaching the first mate by any other route is a new record that supersedes this one. Enforced, once Build 3 lands, by the launcher's argv test and its negative control (an `origin` with a quote, a space or `$` is refused and nothing launches), by the answer line's unit tests (`tasks/first-mate/build-spec.md` §11.4), and by the end-to-end cases for the Inbox and Add to crew (`tasks/first-mate/prd.md` AC-5, AC-12, AC-14 and AC-17: the clipboard holds exactly the line, nothing reaches any pane, and no Firstmate script but the snapshot runs); until then by `tasks/first-mate/prd.md` rules 3 and 6.
