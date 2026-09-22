# 0012 · Dependencies are pinned with `=`; a failing test is never disabled, skipped or loosened

Date: 2026-09-14
Status: accepted

## Context

Kinas is built largely by agents running unattended for hours, and an unattended run has two cheap ways to reach green that are both wrong: let a dependency float to a version that happens to pass, or weaken the test that is failing. Both leave the code different from what was reviewed. The smoke test found the first hazard on day one (2026-09-14): a terminal that renders differently after a dependency bump is a regression only if the versions under test are known. The second hazard is subtler — on 2026-09-17 the same commit failed one reader spec with a 120 s timeout when run beside a cargo build and passed in 3 m 37 s alone; the test was not the thing to change. Recorded here on 2026-09-22.

## Decision

Every direct dependency is pinned exactly: `=` in `Cargo.toml`, exact versions with no `^` or `~` in every `package.json`, the Bun version in the install command. No existing pin moves without a reason stated in the PR, and a dependency's cost (crates added, pins moved) is measured before it is chosen. A failing test is never disabled, skipped, commented out or loosened to reach green: it is fixed, or the code is. An e2e failure while another build or test app runs is re-run alone before it is believed. A test that would pass against the pre-change code tests nothing and is not written.

## Consequences

Upgrades are deliberate events with the smoke test run beside them, not drift. Every build spec names the existing assertions its work is allowed to change and exactly how ("by one array element, named in the PR"). Enforced by `app/src-tauri/Cargo.toml:13` and its `=`-pinned entries at `:15-52`, the exact versions in `package.json`, `app/package.json` and `cli/package.json`, `README.md:18` (the Bun version), `docs/smoke-test.md:3-5`, `:16-17`, `:301-304`, and the "Never do this" and "Existing tests this work could weaken" sections of `tasks/_templates/build-spec.md`.
