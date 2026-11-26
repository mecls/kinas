# The GitHub App that gives each worker its own token

## What it is

One GitHub App the captain registers (ADR 0029, 2026-11-26). On the Linux machine, Kinas's companion uses it to create
a token for each Firstmate worker. The token reaches one repository, the one the task is on, and lasts at most an hour.
The worker pushes and opens its pull request with that token and nothing else. It can't read the `claude` user's SSH
key or `gh`'s login. Without a Linux machine set, nothing here applies.

## Where

- **On GitHub:** the App, under the captain's account. It is installed on the captain's account and on Miraside's
  organization, for the selected repositories workers may work on.
  - **Repository permissions:** exactly Contents read and write, Pull requests read and write, and Metadata read.
    Nothing else: no Workflows, Administration, Secrets, Actions, Environments, Issues or Repository creation.
  - **No webhook.** No account permissions.
- **On the Linux machine, placed by the captain by hand:** in `~/.local/state/kinas/github-app/`, a folder of mode 700:
  - `app.json`: `{"app_id": <the App's id>}`, or `{"client_id": "<its client id>"}`;
  - `key.pem`: the App's private key, as GitHub gives it.

  Both files are mode 600 and the companion user's own, never links. Kinas never writes either file.
- **Each worker's token,** written by the companion. The folder `~/.local/state/kinas/workers/<task id>/` (700) holds
  `token`, and `gh/config.yml` and `gh/hosts.yml`, each mode 600. Beside it, `<task id>.github.json` records the
  repository, the installation and the expiry. The folder is removed when the task lands or is dropped.
- **The credential helper,** `~/.local/share/kinas/bin/kinas-git-credential`, written by Settings' `Sandbox workers`
  beside the wrapper. It answers git's `get` with one file's token, and nothing else.

## Who reads it

- **The companion's `github-app.ts`,** and only it, reads the key:
  - to sign the App's JWT;
  - to find a repository's installation (`GET /repos/{owner}/{repo}/installation`);
  - to create a token (`POST /app/installations/{id}/access_tokens`, `repositories` = the one name, `permissions` =
    the three);
  - to read the App's permissions for setup's **GitHub App** row (`GET /app`).

  It ends a token with the token itself (`DELETE /installation/token`). A token GitHub answers with anything but the
  three permissions and the one repository is refused, never written.
- **`kinas companion worker-launch`,** before each worker starts: a token for the repository of its clone's origin.
  The App not installed there, an origin that isn't on github.com, or no token: the worker doesn't start.
- **The companion's readings,** every 15 seconds: a token with 15 minutes or less left is renewed while the task is
  still listed. A task that landed or was dropped has its token revoked and its folders removed.
- **The worker** reads only its own token folder:
  - git through the helper, with every SSH remote rewritten to HTTPS;
  - `gh` and `gh-axi` through `GH_CONFIG_DIR`.

## What it can do

On the one repository: push and delete branches, open, comment on and merge pull requests, and publish releases on
tags that exist. Not change `.github/workflows/`, not open issues or gists, not create repositories, and not touch any
other repository.

On the repository's default branch and its tags, the captain's rulesets stop it, where they exist. They hold
Restrict updates, Require a pull request, Restrict deletions and Block force pushes on the default branch, and
Restrict creations, updates and deletions on every tag. Repository admin bypasses, Always allow. GitHub offers
rulesets on a private repository only on a paid plan.

## Never

- The key or a token in a log, a reading, a note, the Mac or a commit. Neither leaves the Linux machine.
- The key readable by a worker. It sits in the workers' read denies. The first mate and the captain's own sessions run
  as the same user and can read it; the captain accepted that on 2026-11-26. The future fix is a second Unix user.
- A token with more than the three permissions or more than one repository.
- Kinas registering, installing or changing the App, or setting rulesets: those are the captain's.
