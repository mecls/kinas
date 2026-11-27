# 0029 · Workers push with a per-task GitHub App token, can't read the SSH key or gh's login, and keep their own temp folder

Date: 2026-11-26
Status: superseded by 0030

## Context

ADR 0028 left two gaps open and named the next step for each:
- **Credentials.** A worker could read the `claude` user's SSH key and `gh`'s login. It could push to, or open issues and
  gists on, anything those reach.
- **Temp files.** Workers shared `/tmp/claude-<uid>`, so each could read and write the others' temporary files.

Until those closed, the captain kept a rule by hand: workers take tasks only on the captain's own repositories and
Miraside's. On 2026-11-25 the captain approved slice 5b to close both. They added a condition: the SSH key and `gh`'s
credentials go into the workers' read denies, so a worker can push only with its task's own token.

On 2026-11-26 the captain set the token's terms:
- a GitHub App with contents and pull requests read and write, and metadata read, and nothing else;
- its private key readable only by the companion, and in the workers' read denies;
- a token per task, scoped to one repository, renewed before its hour runs out;
- the token handed over through a credential helper that reads only that worker's own token file;
- a ruleset on `main` requiring a pull request, recommended for each repository workers touch.

The first mate keeps its current access for landing.

The captain approved this record on 2026-11-26, with five additions:
- the App key's reach accepted for now;
- the bypass set to Always allow;
- Vercel's preview builds;
- a tag ruleset;
- the local-only landing check.

**Measured the same day on the home lab** (Claude Code 2.1.332, three sandboxed stand-in workers built from Kinas's own
policy, fake tokens):
- **Read denies reach the shell.** A `Read(…)` permission rule and `sandbox.filesystem.denyRead` both hide a path from
  the shell, not only from the Read tool. `sandbox.filesystem.allowRead` re-opens one folder inside a denied one: a
  worker read its own token file and not another worker's. Hidden were `~/.ssh`, `~/.config/gh` and `~/backups`.
- **SSH is gone without the key folder.** With `~/.ssh` hidden, ssh to GitHub fails host-key verification.
- **HTTPS with the helper works.** Rewritten to HTTPS, git fetched, and `git credential fill` returned the worker's
  own token. `gh`, given its own config folder, used that folder's token: GitHub answered "Bad credentials" to the fake
  one, never falling back to the captain's login.
- **A short temp folder holds.** With `CLAUDE_CODE_TMPDIR=/tmp/kw/t1`, the worker's TMPDIR became
  `/tmp/kw/t1/claude-1001` and `/tmp/claude-1001` turned read-only. Another worker's folder under `/tmp/kw` was hidden.
  With `/tmp/claude-1001` hidden as well, the shell still ran. Claude Code ignores an override whose per-user folder
  is longer than about 30 bytes: a 46-byte one fell back to the shared folder.
- **The clone's git folder is partly writable.** Claude Code protects the clone's `.git/config`, `.git/hooks`, a
  worktree's `commondir` and `config.worktree`. The worker could still:
  - write `.git/info`;
  - move the clone's local `main`;
  - repoint `refs/remotes/origin/HEAD` at its own branch. That ref is the base the review flag reads a branch against.

GitHub's documentation (read 2026-11-26) says:
- an installation token lasts one hour, and can be narrowed to listed repositories and a subset of permissions;
- merging a pull request needs only Contents write;
- "Restrict updates" lets only bypass actors push to a matching branch;
- editing `.github/workflows` needs the Workflows permission;
- gists take a user's token, never an installation's.

## Decision

ADR 0028's decision stands, with the changes below. They hold on a VPS. On the Mac nothing changes.

**The App.** The captain registers one GitHub App:
- **Repository permissions:** exactly Contents read and write, Pull requests read and write, and Metadata read. No
  Workflows, Administration, Secrets, Actions, Environments, Issues or Repository creation.
- **No webhook.**
- **Installed** on the captain's account and on Miraside's organization, for the selected repositories workers may
  work on. That list replaces the captain's interim rule.

The captain places the App's id and private key on the VPS by hand, in `~/.local/state/kinas/github-app/`:
`app.json` and `key.pem`, each mode 600, in a folder of mode 700. Only the companion's code reads the key: never
logged, never sent, never copied.

Setup's **GitHub App** row checks the files and their modes, and that GitHub reports the App's permissions as exactly
those three. Until the row is green, no worker starts.

**A token per task.** `worker-launch` reads the worktree's clone origin as a file. The origin must name one repository
on github.com. Kinas finds the App's installation for that repository, signing with the key. It then creates an
installation token with `repositories` set to that one repository and `permissions` set to contents write, pull
requests write and metadata read.

The token goes into the worker's own folder, `~/.local/state/kinas/workers/<id>/` (mode 700). Each file is written by
rename, mode 600:
- `token`;
- `gh/config.yml` and `gh/hosts.yml`, holding the same token for `x-access-token`.

If there is no installation for the repository, the origin isn't one, or minting fails, the worker doesn't start, and
the launch says why.

The companion renews a worker's token when 15 minutes or less remain. It renews until the backlog says the task landed
or was discarded. Then it revokes the token (`DELETE /installation/token`) and removes that worker's folder.

**How the worker uses it.** The policy's `env` sets:
- **git:**
  - `url.https://github.com/.insteadOf` for `git@github.com:` and for `ssh://git@github.com/`;
  - every inherited `credential.helper` cleared;
  - for `https://github.com`, the helper `~/.local/share/kinas/bin/kinas-git-credential <the worker's token file>`.
    It is an sh script beside the wrapper, in Kinas's record. It answers `get` with that one file's token, as
    `x-access-token`, and does nothing else.
- **gh, and gh-axi, which runs gh:** `GH_CONFIG_DIR` set to the worker's own `gh` folder.

The wrapper also removes `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN` and
`SSH_AUTH_SOCK` from the worker's environment.

**Read denies.** These join the captain's reserved list, always written in full:
- `~/.ssh/**`;
- `~/.config/gh/**`;
- `~/.git-credentials`, `~/.config/git/credentials` and `~/.netrc`;
- `~/.local/state/kinas/github-app/**`, named even though `~/.local/state/kinas/**` already covers it;
- `~/backups/**`.

`sandbox.filesystem.allowRead` re-opens the worker's own `~/.local/state/kinas/workers/<id>/`, and nothing else in
there. The git key and `gh`'s login are no longer readable by a worker: this reverses "the git key and `gh` stay
readable" in ADRs 0027 and 0028.

**A temp folder per worker.** The wrapper makes `/tmp/kw`, mode 700, and inside it the worker's own folder: the first
8 hex digits of the task id's sha256, mode 700. Any folder already at that name refuses the launch. The worker's
Claude Code starts with `CLAUDE_CODE_TMPDIR` set to that folder, so its TMPDIR is `<folder>/claude-<uid>`.

The policy:
- denies reading `/tmp/kw` and `/tmp/claude-<uid>`;
- re-allows the worker's own folder;
- moves the package-manager caches inside it.

When the task ends, the companion removes the folder with the token folder. It removes only a real folder directly
under `/tmp/kw`, never one reached through a link.

**The review flag's base is fixed at launch.** The launch record keeps two commits, both read by the wrapper outside the
sandbox:
- the one `refs/remotes/origin/HEAD` named when the worker started;
- the one the clone's local default branch named.

The branch reading is `--not <the first>`, not the ref the worker can repoint.

**A local-only landing is checked against launch.** For a task in local-only mode, the companion compares the clone's
local default branch with the commit recorded at launch at each reading. It does this from the reading in which the
worker reports done until the backlog says the task landed. If they differ, the crew card shows one line under the
review flag's, in `--danger` text: `local main moved since this task started — check before landing`. The task detail
shows both commits. Kinas doesn't land; the captain reads the line before telling the first mate to land.

**Fail closed.** The runtime check adds, for each worker:
- none of the removed keys in its environment;
- `CLAUDE_CODE_TMPDIR` set to its own folder;
- its token folder present;
- its settings file equal to today's policy, these keys included.

One failing worker turns "Workers sandboxed" red and stops every answer, as before.

**The captain's rulesets, recommended.** Kinas never sets these. They apply on every repository the App is installed
on: one branch ruleset covering the default branch and every branch a push deploys from. It holds:
- Restrict updates;
- Require a pull request before merging, with 0 approvals;
- Restrict deletions;
- Block force pushes.

Its bypass list is Repository admin, the captain's role and so the first mate's, in the mode "Always allow": the
captain pushes to `main` by hand.

A second ruleset on the same repositories covers every tag, with Restrict creations, Restrict updates and Restrict
deletions, and the same bypass.

Without Restrict updates, the task's token could merge its own pull request. The acceptance run proves it from a
worker: the token can't push to `main`, merge its own pull request, push a workflow change, or create a tag.

**Preview builds, recommended.** Where Vercel builds a preview for every pushed branch, that build runs the branch's
code with the project's Preview environment variables. The worker controls `vercel.json` on its branch, so the file
can't stop it. Preview variables hold development keys only, never production ones. The captain's checklist gets a
per-project audit of them.

**The first mate** and the captain's own sessions keep the SSH key and `gh`'s login, and land as they do today.

## Consequences

**What is now closed:**
- A worker reaches one repository, the one its task is on, and only with contents and pull requests.
- No gists, issues or new repositories, and no other repository.
- The worker can't read another worker's token or temp files.

**What stays open, and is accepted:**
- **The App's key is readable by every `claude` process outside the sandbox:** the first mate, the captain's
  sessions, and Herdr's panes. On one Unix user, file modes can't tell the companion from them. They already read the
  SSH key and `gh`'s login, which reach further. The captain accepted this on 2026-11-26, for now and only while
  workers are denied the key (measured). **The future fix** is a second Unix user that alone holds the key and mints
  the tokens. Making it needs root.
- **The token reaches the whole repository.** A worker can:
  - push to, or delete, any branch the ruleset doesn't cover, another task's on the same repository included;
  - comment on pull requests;
  - publish a release on a tag that already exists. The tag ruleset stops it creating or moving one.

  The pull request shows foreign commits.
- **A pushed branch runs the repository's own workflows.** The worker can't edit them, but it can change the code they
  run, with whatever secrets they hand that code. Workflows that expose secrets on `push` or `pull_request` for other
  branches need the captain's review.
- **Vercel builds every pushed branch as a preview,** running the worker's code with the project's Preview environment
  variables, wherever a project does so. `vercel.json` is the worker's to change on its branch. A production key in
  Preview variables is a production key the worker's code can send out. That stays open until each project's audit
  shows development keys only.
- **Data can still leave through the task's own repository:** a branch, or a comment.
- **The clone's local refs are the worker's to move,** `main` and `origin/HEAD` included. The review flag no longer
  reads them, and a local-only landing shows when `main` moved.
- **Another task's legitimate local landing moves `main` too.** That shows the same line, and errs toward review.
- **A task that must change `.github/workflows/` can't push it.** The first mate or the captain does.
- **If the companion stops,** tokens expire within the hour and workers' pushes fail.
- **Several rules come from measuring 2.1.332, and are measured again when Claude Code changes:**
  - the length limit on `CLAUDE_CODE_TMPDIR`;
  - that `allowRead` re-opens a folder inside a denied one;
  - which `.git` paths Claude Code protects.
- **The rulesets are a recommendation.** A repository without them lets the task's token push to, and merge into,
  `main`, and create tags. Rulesets aren't available on every GitHub plan for private repositories. Where the API
  refuses one, the App shouldn't be installed on that repository.

Enforced by:
- `cli/src/companion/worker.ts` (the policy, the reserved reads, the removed keys) and its tests;
- a new `github-app.ts` (JWT, installation, mint, renew, revoke) and its tests;
- `plants.ts` (the launch record's base commit);
- `run.ts` (renewal and the runtime check);
- `app/src-tauri/src/readers/crew/touches.rs` (the branch reading's base);
- `app/src/crew/board.ts` (the local-only line);
- `docs/external/vps.md` and a new `docs/external/github-app.md`.

Supersedes 0028.
