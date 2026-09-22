# 0008 · Providers are watch-only; tests grep the code for anything but GET

Date: 2026-09-17
Status: accepted

## Context

Kinas reads usage from services that also accept writes: Convex (deploy, run functions), Hostinger (recreate the machine, reset its root password, buy another VPS), later Vercel. For Convex the credential can be minted with only `deployment:usage:view`, so the key itself cannot write; for Hostinger there is no read-only scope — its docs say a token "will have same permissions as the owning user" — and the destructive endpoints sit in the same URL namespace as the two Kinas reads, differing only by verb and suffix. A single edited verb would be one typo from destroying the machine. The Convex integration set the habit on 2026-09-17 (rule R1) where it was cheap; Hostinger's on 2026-09-18 made it a property of the code. Recorded here on 2026-09-22.

## Decision

Every provider reader is watch-only: GET requests only, and no destructive path ever constructed, regardless of what the credential could do. Watch-only is enforced by tests that read the reader's own source code — not its prose — and fail on any other verb or any destructive path, with a negative control proving the guard is reading real code. The same grep runs against the shipped tree in AC-10, so a release cannot disagree with the test suite. Where a service offers a narrower scope, the credential is minted with it too.

## Consequences

A feature that needs a write to a provider is a new PRD with its own rule, never an edit to a reader. The guard tests assemble their needles from parts so they cannot match themselves; a guard that trips on a description of itself teaches whoever hits it to weaken the guard. Enforced by `app/src-tauri/src/readers/convex/mod.rs:543-553` (`this_module_makes_no_request_other_than_a_get`), `app/src-tauri/src/readers/hostinger/mod.rs:581-627` (`the_guards_are_reading_real_code_and_not_an_empty_string`, `no_verb_but_get_reaches_hostinger`, `no_destructive_path_is_ever_constructed`), and `scripts/acceptance.sh` AC-10's grep of the Hostinger reader.
