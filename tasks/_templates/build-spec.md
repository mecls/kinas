<!--
TEMPLATE USE NOTES — for the session assembling the spec, not for the build agent.

This is Gate 3 (§11, program design) and Gate 4 (§12, the slice plan) of the four-gate workflow
in AGENTS.md, in the house build-spec shape the `agent-build-spec` skill produces. Saved as
tasks/<feature-slug>/build-spec.md, **private** (git-ignored): the build agent reads and edits it
at its absolute path in the main checkout. Gate 1 is prd.md and the mockups; Gate 2 is
architecture.md when more than one layer is touched.

Fill every <angle-bracket placeholder> and delete every GUIDANCE comment before handing this
over. A placeholder left in the final document is, by definition, a fork left in for the build
agent to trip over at hour three. Keep the section order and numbers: §0's boilerplate refers to
them. Write in imperative voice, addressed to the agent that will build this: "Store X as Y", not
"the system should probably store X". Numbers, table names, selectors, argv, thresholds and error
strings belong here; adjectives like "robust", "clean" and "secure" do not, unless something
concrete follows them.

If a section genuinely does not apply, keep the header and write one line saying it does not
apply and why. A missing section reads as an oversight; an explicit "single-user, no roles" reads
as a decision.

Each gate is approved with the protocol in AGENTS.md: write the document, present at most ten
bullet decisions and the path, ask exactly "Approve Gate N, or what should change?". §11 is
presented for Gate 3 and §12 for Gate 4 — separately.
-->

# Kinas — <feature> — Build Spec

**One-line mission:** <what this produces for whom, in one sentence>

Written <date> from `tasks/<feature-slug>/prd.md` (the PRD; where the two differ **this document wins** and §17 says why)<, from `architecture.md`,> and from the Kinas tree at `origin/main` = `<sha>`. Base commit: **`<sha>`**.

---

## 0. How to use this document

You are building this unattended. Nobody will answer questions while you work, so:

1. **This document outranks your instincts.** Where it names a rule, a number, an argv, a selector or a string, follow it even if you would have chosen differently.
2. **When you hit something genuinely unspecified, decide and keep moving.** Pick the smallest choice consistent with §1 and §2, append it to §17 with one line of reasoning, and continue.
3. **§14 is your finish line.** Work is done when those scenarios pass, not when the code looks finished.
4. **The non-goals in §2 are binding.** A useful idea outside them goes in §17 as a suggestion and is not built.
5. **§12 is the task list.** Tick each box **as you finish it**, not at the end of a slice — someone resuming after an interruption can only trust boxes ticked as the work happened. Tick the slice in `status.md` too.
6. **Compact at every boundary.** At the end of every slice the documents hold everything decided — nothing important may exist only in chat. Say in one line that this is a safe point for a fresh session. If the harness warns that context is low, compact at once, wherever the work is.
7. **This file is private**, so it does not exist in your worktree. Read and edit it — and every other private document of the feature — at its absolute path in the main checkout, which `git worktree list` names first. If your session refuses that path, keep a working copy in the worktree's own git-ignored `tasks/` and copy it back at every ship point.
8. **<Where the truth outside this document lives, and which wins when they disagree>** — e.g. a pinned upstream's script headers, a vendor's API schema. Record the difference in §17 and follow the source.

---

## 1. Primary user and outcome

**Primary user:** <the narrowest true description of one person — a role and their situation, not a market segment>

**Outcome:** <the single thing this must produce for them>

**Narrowing principle:** <the rule that stops this becoming a clone of the whole category it resembles. This is the sentence to re-read whenever a feature feels tempting.>

## 2. Non-goals

<GUIDANCE: 3–5 concrete exclusions, each with a clause on why. "Keep it simple" is not an exclusion. Anything the captain waved off during the interview belongs here in their words. Parked work from earlier builds is restated here so the agent does not resume it.>

- **<Excluded thing>** — <why: out of scope, later phase, deliberately someone else's job>

## 3. Journeys

<GUIDANCE: 2–4 end-to-end journeys as stories. At least one must be an unhappy path — a denied permission, a failed external call, a first-run empty state — and one may be the build's own unhappy path (a probe that fails). Number the steps; §14 refers back to them.>

### Journey A — <name> (happy path)
1. <User does X>
2. <System shows Y>
3. <User does Z; the outcome from §1 has now happened>

### Journey B — <name> (unhappy path: <what goes wrong>)
1. <...>
2. <What the user sees, exactly — the error copy, not "an error message">
3. <How they recover, or how the system recovers for them>

## 4. Screens and states

<GUIDANCE: one block per screen, with its selector (`section.page[data-page="…"]`, `data-*` state attributes, class names — grep before naming a class; the stylesheets are global). Every screen needs all four states filled in. A blank state here is the single most common reason an agent invents its own error handling. Every screen was a mockup first (`mockups/<screen>.html`, approved in Gate 1); name it, and name the DESIGN.md §4 components it composes.>

### <Screen name> — `<selector>` (mockup: `mockups/<screen>.html`)
- **Primary action:** <the one thing this screen exists for>
- **Secondary actions:** <or "none">
- **Empty:** <what shows before any data exists — one sentence in `--ink-2` and one action>
- **Loading:** <skeleton, spinner, disabled controls — be specific>
- **Error:** <what the user sees and what they can do next — one line, what happened and what to do>
- **Success:** <what confirms the action worked>

## 5. Capabilities

<GUIDANCE: a flat list of features, not prose. Each line should be something you can later mark done. Order roughly by build sequence — see §12.>

- [ ] <Capability>

## 6. Invariants — enforce in the core, not the UI

<GUIDANCE: things that must hold no matter which path the user takes. Phrase each as something Rust or the store rejects, not something the UI prevents — a disabled button is not an invariant. Where a rule exists because something went wrong before, say so: a rule with a reason survives refactoring, a bare rule gets optimised away by someone who doesn't know what it was for. Name the check that enforces it — a constraint, a guard test, a unique index, a fixed argv. The repository-wide invariants are in `docs/adr/`; restate the ones this feature touches by number, and add the feature's own.>

1. **<Rule name>.** <What is always true, stated so it can be tested; the check; the reason.>

## 7. Data model and lifecycle

<GUIDANCE: entities and their states, not full schema — §11.2 carries the migration's table shapes. Be explicit about what is permanent and what is reversible, and what is a cache.>

### <Entity>
- **Represents:** <what it is>
- **Owned by:** <which user or system actor>
- **States:** <draft → active → archived, and what triggers each transition>
- **Reversible:** <which transitions can be undone>
- **Never silently deleted:** <what must be retained, and for how long>

## 8. Users, auth and permissions

<GUIDANCE: Kinas v1 is single-user; say so explicitly here rather than omitting the section — an unstated assumption is itself a fork. If this feature introduces a second actor (a script, an agent, a phone), name what it may do that the captain's click may not, and where that boundary is enforced.>

## 9. Technical direction

<GUIDANCE: name every layer and every file it lands in. "Choose an appropriate module" is exactly the fork this document exists to remove. Constants (pins, versions, checksums, paths) are written here as code so the agent copies rather than re-derives them.>

- **Rust (`app/src-tauri/src/`):** <modules, commands, threads — with the blocking-I/O rule: async commands + `spawn_blocking`>
- **Store:** <migration number, `SCHEMA_VERSION`, tables>
- **Webview (`app/src/`):** <pages, components from `app/src/ui/` or DESIGN.md §4, hooks; nothing above `<Terminal>` conditionally rendered>
- **CLI (`cli/src/`):** <subcommands, the read-only rule and any dated exception>
- **Context packet (`packages/context/`):** <sources touched, or "none">
- **Keys and palette:** <the `keymap.md` rows and `registry` entries, written there first, or "none">

### External integrations

<GUIDANCE: for each third-party API, OS capability or process run. Each one needs an adapter behind an interface, a timeout, a fixed argv (never a shell string), and a local fake or a debug seam (`KINAS_E2E_*`) — otherwise the agent blocks on credentials it does not have. Each has a `docs/external/` entry.>

| Integration | Used for | Timeout | Local fake / seam | `docs/external/` |
|---|---|---|---|---|
| <name> | <what it does> | <ms> | <how to run without the real thing> | <file> |

## 10. Security and privacy

<GUIDANCE: name the sensitive data specifically. Defaults for Kinas: everything stays on the Mac; secrets in the Keychain through `security` on stdin, never in the store, the log, `kinas status --json` or `last_error`; no file's contents and no file's path in the log; the repository is public, so fixtures use synthetic names and every added line is checked against `scripts/private-names`.>

- **Sensitive data:** <what, and where it is allowed to live — and nowhere else>
- **Never leaves the machine / never sent to a third party:** <be explicit>
- **Retention and deletion:** <how long, and what deletion actually removes>
- **Riskiest surfaces, and the guardrail on each:** <uploads, child processes, text into argv, third-party tokens — one guardrail per surface>

## 11. Program design

<GUIDANCE: Gate 3 — the decisions the agent would otherwise make silently mid-implementation. Present §11 alone for approval before §12 exists. A person should be able to read §11.2 in seconds and say "right" or "wrong"; that is the whole point. Read the code first — every name here is a real file, a real table, a real component.>

### 11.1 Files

<Every file created or changed, one line each, with why it lives there. New files say which existing file is the precedent to follow.>

- `<path>` — <created|changed>: <why it lives there; the precedent>

### 11.2 Types and signatures

<Code blocks defining the types and the signatures, with **no implementation bodies**: the Rust `#[tauri::command]` signatures the webview may call and their `Result` error types; the migration's table shapes (`CREATE TABLE` as it will be written); the CLI's subcommand signatures and their exit codes; the React component props and the `api.ts` functions; the pure functions the tests will call.>

```rust
// <module>.rs
```

```sql
-- migrations/NNNN_<slug>.sql
```

```ts
// api.ts · <Component>.tsx · cli/src/<file>.ts
```

### 11.3 Call stack

<For each main flow, what calls what, top to bottom — e.g. click in the inbox → `api.ts` → `#[tauri::command]` → validation → `spawn_blocking` → child process → exit code → store row → event → re-render. One list per journey in §3, naming the functions from 11.2.>

### 11.4 Test plan

<Test case names and what each one asserts, written before any of them exist — bun (`*.test.ts` beside the code), Rust (`#[cfg(test)]`), e2e (`e2e/specs/<name>.e2e.ts`, with its `.setup.ts` and the throwaway session it uses) — plus the invariant tests (the guard tests with their negative controls: zero PTY writes, no writes under a path that must stay untouched, forbidden strings absent from the log). A test that passes against the pre-change code tests nothing.>

| Test | Kind | Asserts |
|---|---|---|
| `<name>` | bun / Rust / e2e | <the observable result> |

### 11.5 Least confident decisions

<A numbered list of the calls most worth challenging now, while changing them is free — **at least five**, each with the alternative considered and why it lost. These are the bullets to present for Gate 3.>

1. **<Decision>** — alternative: <the other way>; chose this because <one clause>.

## 12. Build order — the slice plan

<GUIDANCE: Gate 4. Vertical slices in build order, one line each; present the list alone for approval, then build one slice at a time. Slice 1 is the tracer bullet: stubbed end to end, it does almost nothing but it runs and the captain can see it. Slice 2 replaces the stubs with the real happy path. Slice 3+ add one capability each — a rule, an error path, an edge case, polish — each ending in a working, testable state. Never horizontal (all of the store, then all of Rust, then all of the webview). Docs that a slice makes false are amended at the start of that slice with a dated note (`Amended <date> (<feature>): …`), never rewritten. Every slice ends green: `bun run check`, then the specs that touch the changed code; the full e2e, alone, at every ship point. After every slice: prove it (run it, show the result), tick it here and in `status.md`, compact, and ask "Continue to slice N+1, or re-steer?".>

### Slice 0 — ground
- [ ] 0.1 Create the worktree and branch per §16 from `origin/main`; `bun install`; `bun run build:cli`; `bun run check` once for a baseline (record its time and counts in §19).
- [ ] 0.2 Docs first: <the tracked docs this work changes, amended before the code>.

### Slice 1 — tracer bullet: <one line>
- [ ] 1.1 <...>

### Slice 2 — <one line> → ship point 1
- [ ] 2.1 <...>

## 13. Testing

<GUIDANCE: §11.4 is the plan; this section is how it runs. Defaults: unit tests on invariants and state transitions, integration tests on external adapters against the local fakes, one end-to-end test per journey.>

- **Unit (Rust):** <what must be covered>
- **Unit (bun):** <what must be covered>
- **Integration (Rust):** <the adapters from §9 against a real store in a tempdir>
- **End-to-end:** <one spec per journey; the throwaway session name; time things in-page, never by WebDriver polling>
- **Command to run everything:** `bun run check` — typecheck, `bun test`, `build:cli`, `cargo test`, clippy `-D warnings`.
- **E2E command:** `PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH" bun e2e/run.ts [<filter>]` — **alone**: `uptime`, `pgrep -fl "e2e/run.ts"`, `pgrep -x cargo`, `git worktree list` first. Never edit a spec while a run is in flight.

**Existing tests this work could weaken. Do not let it.**
1. <test file and line: exactly how it may change, e.g. "by one array element, named in the PR">

## 14. Acceptance scenarios — your finish line

<GUIDANCE: Given/When/Then, each tied to a journey and an invariant. At least one covers a failure or refused path and one the privacy path (what is NOT written, logged or printed). These must be checkable without a human judging them; the ones only the captain can check go in §19 "Needs the captain".>

### AC-1 — <happy path, from Journey A; §6.n>
- **Given** <starting state>
- **When** <action>
- **Then** <observable, checkable result — a value, a row, a rendered string>

### AC-2 — <failure or refused path, from Journey B> — *the failure path*
- **Given** <...>
- **When** <...>
- **Then** <the exact failure behaviour: what the user sees, what is logged, what is NOT written>

### AC-3 — <edge case from an invariant in §6> — *the privacy path*
- **Given** <...>
- **When** <...>
- **Then** <...>

### AC-n — Nothing already working broke
- `bun run check` green; the full e2e green, alone; every existing assertion named in §13 holds as written.

## 15. Failure recovery

<GUIDANCE: defaults — failures are visible, nothing is swallowed silently; durations, counts and exit codes in the log, never contents, paths or titles.>

- **Errors surface in:** <UI surfaces, `reader_status`, the log — and at what level of detail>
- **Retries:** <how many, with what backoff, where the retry state is visible; or "none — the user clicks again">
- **Migrations / rollback:** forward-only; <the migration this adds>; a store newer than the app is refused. Git rollback is `git revert` on `main`. Prod rollback is the previous bundle kept until the warm-open gate passes.
- **The stop rule:** <what makes the build stop and report instead of continuing, and what is committed when it does>
- **When a sub-task is blocked:** one serious attempt plus one alternative, both logged in §17, the box marked `- [ ] (blocked: <reason>)`, then the next sub-task that does not depend on it.

### Never do this
<GUIDANCE: the repository-wide list lives in `docs/adr/` and in AGENTS.md; restate here only what this feature makes tempting, one line each, starting with the ones that would cost the most to undo.>
- <...>
- Disable, skip or loosen a failing test to reach green; run the e2e suite beside cargo or another session's e2e; edit a spec mid-run.
- `git push --force` to `main`; switch branches, pull, stash or commit in the main checkout while a worktree exists; use bare `git stash`.

## 16. Deliverables

- [ ] `feat/<slug>` merged to `main` by fast-forward at <n> ship point(s), each with a PR whose body carries <the gate numbers, the versions, the named test changes>
- [ ] `/Applications/Kinas.app` built from the final commit, ad-hoc signed, running, the previous bundle deleted once the warm-open gate passes
- [ ] <migrations, fixtures, fakes, seams>
- [ ] `bun run check` green and the full e2e green, run alone, at every ship point
- [ ] Every doc named in §12's docs-first items amended with a dated note; `README.md` carrying any new seam; `prd.md` untouched except its trailing note
- [ ] §12 with every box ticked as the work happened; §17 filled in; §19 written as the hand-off; `status.md` with every slice ticked
- [ ] The worktree removed with `git worktree remove`, the merged branch deleted locally **then** remotely; the main checkout's `main` **not** pulled if another worktree still exists (say so in §19)

### Ship procedure (every ship point)
1. Rebase onto `origin/main`. `bun run check`; full e2e, alone.
2. Push; `gh pr create`; fast-forward: `git push origin HEAD:main`. Never force.
3. `xcodebuild -license check`. Then, **in the worktree**: `bun run build:cli`, `bun run build`.
4. `strings` the new binary: 0 × `wdio`, 0 × `__kinasTest`. **Only now** may Kinas be quit — `pgrep -f "Kinas.app/Contents/MacOS/Kinas"` first, and check no sibling session's test app is running.
5. Move `/Applications/Kinas.app` to `$TMPDIR/kinas-previous/`; `cp -R` the new bundle in; `codesign --force --deep --sign - /Applications/Kinas.app`; `open` it.
6. Verify: the process runs from `/Applications`; `~/.local/bin/kinas` points into it; `kinas status` exits 0; the log shows the store opened at schema **<n>**. Then the warm-open gate (median under 200 ms).
7. `scripts/private-names` against every added line and commit message: 0 hits.

### Working environment
Work in a **git worktree** so the captain's checkout stays usable: `git worktree add .claude/worktrees/<slug> -b feat/<slug> origin/main` (from the main checkout — do not pull it; other worktrees may exist and are not yours). Then:
1. **`bun install` before anything else** — a fresh worktree has no `node_modules`.
2. **`bun run build:cli` before `bun run build`** or `cargo test` — both fail on a missing sidecar; `bun run check` builds it first.
3. `bun` and `cargo` are not on the job shell's PATH: `export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"`.
4. Disk: read `/System/Volumes/Data`, not `/`. Keep 30 GiB free before a release build.
5. Before any e2e run: `uptime`, `pgrep -fl "e2e/run.ts"`, `pgrep -x cargo`, `git worktree list`, the mtime of other worktrees' `target/debug/Kinas`.

## 17. Decisions log

Append one line per decision this spec did not settle: `<what you decided> — <why, in one clause>`. Also record anything you deliberately did not build because §2 excluded it.

### Settled before this run (<date>, with the captain)
- **<Decision>** — <why>

### Settled by default — the captain may veto any, and none was objected to
- <...>

### Decisions made during the run
<!-- append below -->

## 18. Definition of Done

> <One sentence the captain would actually check against. Not "it works" — done how, verified how. The strongest version names the command to run and the state to observe: "every scenario in §14 passes via `bun run check` and `bun e2e/run.ts` run alone on the commit `origin/main` points to; `/Applications/Kinas.app` is built from that commit and running with the warm-open median under 200 ms; and everything only the captain can check is listed in §19.">

## 19. Status at hand-off

*(The agent fills this in.)*

### Measured
- Baseline (`bun run check` time and test counts; full e2e specs/cases/time and load), <the probe's record, versions installed, in-page timings>, the warm-open numbers at each ship point, tests added by kind.

### AC-1 to AC-n
- One line each: pass/fail, the spec or test that proves it, anything worth a look.

### Needs the captain
- <Everything only the captain can check — the real session, the real account, the smoke items — as an unticked list, copied to `docs/smoke-test.md`.>

### Not done, deliberately
- Everything in §2, restated with the reason.
