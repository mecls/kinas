# GitHub, through `gh`

## What it is

The GitHub CLI, signed in as the captain in the macOS keyring. Kinas uses it to ask about the crew's pull requests and to tell whether it is signed in. Kinas stores no GitHub token and never sees one.

## Where

`gh` on the login shell's `PATH` (`/opt/homebrew/bin/gh` on this Mac). Its login is `gh`'s own (`gh auth status` names the keyring).

## Who reads it

- `kinas crew setup` and the app's tool health (`crew/tools.rs`): `gh auth status` — exit 0 is "signed in". Its output names the account and is never stored or logged.
- From the crew's board slice, the collector (`readers/crew/gh.rs`): `gh pr view <url> --json number,state,isDraft,mergeable,reviewDecision,statusCheckRollup`, 10 s, only for a URL that matches `^https://github\.com/[^/]+/[^/]+/pull/\d+$`. Amended 2026-09-25 (slice 4, as built): asked for the PRs of tasks not yet done, each at most once a minute while the Crew page shows and once every five minutes otherwise, and again for all of them on Refresh readings. Kept: the state, the draft flag, mergeability, the review decision and the checks' counts in the store; each check's name and conclusion in memory only, for the task detail. A PR `gh` cannot read keeps its last values. The log says `crew: gh <n> PRs in <ms> ms` and nothing else.
- Firstmate's scripts and the crew's workers, as the captain, in their own panes.

## What it can do

Everything the captain's GitHub account can: read and write repositories, open and merge pull requests.

## Never

- `gh auth login`, `gh auth token`, or reading the keyring: signing in is the captain's.
- Any `gh` command that changes something, from Kinas: Kinas reads a PR's facts and nothing else.
- A token, an account name or `gh`'s error text in the log; `redact()` strips GitHub token shapes from anything stored.
