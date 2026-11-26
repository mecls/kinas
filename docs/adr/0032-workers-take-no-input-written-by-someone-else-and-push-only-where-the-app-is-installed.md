# 0032 · Workers take no input written by someone else, and push only where the App is installed

Date: 2026-11-26
Status: accepted

## Context

Before slice 5b, a worker held the shared SSH key and `gh`'s login. The captain kept a rule by hand: workers take
tasks only on the captain's own repositories and Miraside's. ADR 0029 replaced that rule with the App's installation:
"Installed on the captain's account and on Miraside's organization, for the selected repositories workers may work
on. That list replaces the captain's interim rule." ADRs 0030 and 0031 kept that sentence.

Slice 5b was accepted on the Linux machine on 2026-11-26 (results below). The same day the captain lifted the old
limit and set a standing rule in its place, in their words: "no worker task takes input written by someone else
(issues, PR comments from non-collaborators, scraped web content), whichever repo it is in. Workers can only push
where the App is installed."

## Decision

ADR 0031 stands, with ADRs 0029 and 0030 as it carries them, except for the sentence quoted above, which this record
replaces:

- **Where workers push.** A worker pushes only to a repository where the GitHub App is installed. `worker-launch`
  refuses a worker whose clone's repository has no installation, so this holds by itself. The installation is the
  captain's, and only on repositories whose rulesets are on (ADR 0029, with 0031's bypass).
- **What workers take in.** No worker task takes input written by someone else, in any repository: no issue, no
  comment on a pull request from someone who isn't a collaborator, no scraped web content. A task's brief comes from
  the captain, the first mate, or a collaborator. The captain and the first mate keep this rule when a task is made;
  Kinas doesn't enforce it.
- **The old limit,** own and Miraside's repositories only until 5b, is lifted.

## Consequences

- **Workers may work on any repository the captain installs the App on.** On 2026-11-26: `mecls/glyph`,
  `mecls/kinas`, `mecls/kinas-ruleset-check` and `Miraside/contentAgent`, each public, each with both rulesets.
- **The token limits what an injected instruction can reach, not whether it arrives.** A worker that read hostile
  text could still misuse its one repository: a branch, a pull request, a comment. Hence the rule on input.
- **The scratch repository `mecls/kinas-ruleset-check` stays** as the regression test for the push path.

**Slice 5b's acceptance, 2026-11-26.** Run on the Linux machine: companion `5c094eaa`, repository `mecls/kinas-ruleset-check` with both rulesets on (bypass
exempt). Two workers, `kp1` and `kp10`, were spawned by Firstmate in Herdr through Kinas's wrapper. The build spec
holds the outputs.

| Case | Result |
|---|---|
| A worker pushes its branch and opens its PR with its own token | **pass** after one fix: the first push failed (git didn't run the credential helper), fixed in `398e7da`. PRs #3 and #4 are authored by `app/kinas-workers-mecls` |
| No push to `main` | **pass**: GH013 "Cannot update this protected ref" |
| No merge of its own pull request | **pass**: "the base branch policy prohibits the merge" |
| No merge of its own pull request with `--admin` | **pass**: "Repository rule violations found" |
| No workflow change | **pass**: "refusing to allow a GitHub App to create or update workflow … without `workflows` permission" |
| No tag creation | **pass**, both ways: `git push` GH013 "Cannot create ref", and the API 422 |
| A restarted worker gets a new token | **pass**: same folders, new token works, the old one answers 401 |
| Renewal | **pass**: each token renewed on its own with 15 minutes left; the replaced one answers 401 |
| Revocation at the task's end | **pass**: both tokens 401 on the next reading; token and temp folders removed |
| The first mate lands a throwaway PR with plain `gh pr merge --match-head-commit` | **pass**: PR #3, `CLEAN`, exit 0 |
| A worker can't read another worker's token or the App key | **pass**: refused by the read denies before the command ran |
| A worker can't see another worker's temp folder | **pass**: "No such file or directory" inside its sandbox |
| No GitHub token or SSH agent in a worker's environment | **pass**: none |

- **The push to `main` and both self-merges ran outside Claude Code, with the worker's own token.** Claude Code's auto
  mode had refused them inside the worker before they reached GitHub. GitHub's answer depends on the token, not on
  the client, so these rows hold for a worker.
- **SSH to GitHub was also refused by auto mode.** It rests on the `~/.ssh` deny, and on the 5b probe, where it failed
  without the key.

Supersedes 0031.
