# 0031 · Repository admin is exempt from the workers' rulesets, not "Always allow"

Date: 2026-11-26
Status: superseded by 0032

## Context

ADR 0029 recommends two rulesets on each repository the App is installed on: one on the default branch, one on every
tag. Its words: "Its bypass list is Repository admin, the captain's role and so the first mate's, in the mode 'Always
allow'". ADR 0030 kept that.

On 2026-11-26 the landing was checked on a scratch repository, `mecls/kinas-ruleset-check`, with both rulesets
applied. The first mate's exact command ran on the Linux machine under its own login:
`gh pr merge <n> --repo … --match-head-commit <sha> --squash`.
- **Under "Always allow":** GitHub reported the pull request `BLOCKED`, and `gh` 2.46 refused with "not mergeable:
  the base branch policy prohibits the merge" (exit 1). Only `--admin` landed it. Firstmate's `fm-pr-merge.sh` passes
  `--admin` only under `--attended-override`, "only for an explicit captain instruction".
- **Under "exempt":** GitHub reported the pull request `CLEAN`, and the same plain command landed it (exit 0).

The captain chose "exempt" the same day: "landings already wait for my word in Firstmate, and exempt still lets me
push to main by hand."

## Decision

ADR 0030 stands, with 0029's decision as 0030 amends it, except for one thing: the bypass mode. In both recommended
rulesets, Repository admin (repository role id 5) is in the bypass list in the mode **exempt**, not "Always allow".
Nothing else in either ruleset changes.

## Consequences

- **The first mate lands with its plain command,** as before the rulesets, once the captain has said to land. The
  captain pushes to `main` by hand.
- **Admin pushes and merges leave no entry.** GitHub doesn't evaluate the rules for an exempt actor, so neither the
  captain's nor the first mate's pushes and merges are logged as bypasses.
- **Every rule still holds the App's token.** The token acts as the App's installation, never as Repository admin.
  The acceptance run proves it from a worker on the scratch repository: no push to `main`, no merge of its own pull
  request, no workflow change, no tag.
- **`tasks/cloud-factory/github-rulesets.sh` sends `"bypass_mode": "exempt"`.** The rulesets are recommended, not
  enforced: Kinas never applies or reads them.

Supersedes 0030.
