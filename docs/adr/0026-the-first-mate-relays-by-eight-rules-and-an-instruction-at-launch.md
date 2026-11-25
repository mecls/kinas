# 0026 · The first mate relays answers by eight exact rules, with an instruction passed at launch

Date: 2026-11-25
Status: accepted

## Context

ADR 0025 had setup add four allow rules for the home's `bin/fm-send.sh` so the first mate could relay the captain's
answer. On 2026-11-25 the first real run on the captain's home lab stopped at the note, and the inbox route was then
measured there (Claude Code 2.1.332, Firstmate `427056c`). Three things came out of it.
- Two of the four entries never match: the first mate's environment has no `FM_HOME`, and `fm-send` refuses to run
  without it. The other two let any `fm-send` text through.
- Six narrower entries relayed five notes out of five, with the classifier never asked: the answer, acknowledging the
  note, and acknowledging the wake.
- Closing the hold (`fm-captain-hold.sh answer … --release`) was left to auto mode's classifier. It passed by rule
  only when the call stood alone. In auto mode, a call ending in `| tail` goes to the classifier even when every part
  of it matches a rule. `cd <home>;`, `&&`, `2>&1` and a decision file outside the home didn't matter. Of the six
  release calls that morning, none stood alone.

Claude Code 2.1.332 accepts `--append-system-prompt-file` in an interactive session; this was measured under a
terminal. The classifier reads user messages, tool calls and CLAUDE.md, not the system prompt.

The captain decided:
- replace the four entries with the six;
- add a narrow rule for releasing a hold, with no permission prompt;
- pass the one-command instruction at launch.

## Decision

Setup on a VPS keeps exactly these eight entries in `permissions.allow` of the Firstmate home's git-ignored
`.claude/settings.local.json`, with `<home>` absolute:

1. `Bash(FM_HOME=<home> bin/fm-send.sh * --resolve-key *)`
2. `Bash(FM_HOME=<home> <home>/bin/fm-send.sh * --resolve-key *)`
3. `Bash(bin/fm-inbox.sh drain --ack *)`
4. `Bash(FM_HOME=<home> bin/fm-inbox.sh drain --ack *)`
5. `Bash(bin/fm-wake-drain.sh --ack-through * --recovery-generation *)`
6. `Bash(FM_HOME=<home> bin/fm-wake-drain.sh --ack-through * --recovery-generation *)`
7. `Bash(bin/fm-captain-hold.sh answer * --decision-file * --release)`
8. `Bash(FM_HOME=<home> bin/fm-captain-hold.sh answer * --decision-file * --release)`

On the captain's click it removes ADR 0025's four entries, exactly those four strings. It then adds whichever of the
eight are missing, keeping every other key and entry of the file. A file that isn't a JSON object, or whose
`permissions.allow` isn't a list of strings, is reported and never written. No ask rule is ever added.

The one-command instruction is a file Kinas writes, `~/.local/share/kinas/first-mate-relay.md`, outside Firstmate's
tree. It is recorded in Kinas's record of what it wrote, and only ever written over Kinas's own unchanged copy. It
names the four calls in exactly the forms above, each as its own Bash call, with nothing before or after it. The
companion's `launch-first-mate` types `<claude> --append-system-prompt-file <that file>`, which is still one fixed
command and never a sentence from a request. It refuses to launch while Kinas's copy isn't there. A setup row reads
each running first mate's command line for the flag.

Everything else in ADR 0025 stands.

## Consequences

The answer and the hold's release pass by rule, and AC-3 says so. The instruction grants nothing. A first mate that
still writes a pipe or a second command goes to auto mode's classifier, as before.

A first mate the captain starts by hand, without the flag, has no instruction. The row says so.

Enforced by:
- `cli/src/companion/setup.ts` (`relayEntries`, `LEGACY_RELAY_ENTRIES`), `install.ts` and their tests;
- `cli/src/companion/actions.ts` (the launch) and `actions.test.ts`;
- `docs/external/firstmate-home.md`.

Supersedes 0025.
