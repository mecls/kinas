# Fixtures

Shared by the Rust tests, the TypeScript tests, the e2e suite and `scripts/check-usage.ts`.

- Files ending in `.synthetic.json` are **not** captured from a real service. They are built from
  documented or observed shapes and stand in until a real capture exists:
  - `ollama-usage-legacy.synthetic.json` — shape from can1357/oh-my-pi#11739 (2026-09-11), with field
    paths re-checked against the live response on 2026-09-14 (`limits.<session|weekly>.usage`,
    `limits.<window>.models[].{name, request_count}`, `activity.cost`, `activity.period.*`); every
    value is made up. Replace with a real `ollama-usage-<legacy|credits>.json` from task 1.2.
  - `convex-usage.synthetic.json` — the shape of `GET /api/v1/get_current_usage` from Convex's docs
    (`metrics.<key>.{unit, usage.{current_day, current_month}}` plus `seedStatus`), read 2026-09-17; the
    endpoint is documented as beta, so a payload change is expected rather than surprising. Every value is
    made up, and two are chosen to carry assertions: `functionCalls.current_month` is 250 000, which is
    **25.0 %** of Starter's 1M allowance, and the three action-compute keys are 1, 2 and 3 GB-hours while
    `queryMutationComputeGbHours` is 10 — so the R7 sum must come out as **6, not 16**. Replace with a real
    capture once a live response has been seen.
  - `handoff/*.json` — status line hand-off files built from the documented status line schema
    (code.claude.com/docs/en/statusline): `used_percentage` 0–100, `resets_at` in epoch seconds.
- Secrets in fixtures are obviously fake (`ollama-FAKE…`, `sk-ant-FAKE…`) so the repo greps in the
  build spec's AC-10 stay meaningful.
- No fixture contains a real transcript. Transcript fixtures are hand-written lines in the same
  shape as `~/.claude/projects/**/*.jsonl` and `~/.pi/agent/sessions/**/*.jsonl`.
- `reader/` — the projects root for `e2e/specs/reader.e2e.ts` and the release speed check: `plan-300.md` (exactly 300
  lines, generated once: frontmatter, one Mermaid diagram, a table, a task list, a link to `other.md#part`, a 1×1
  `diagram.png`), `other.md`, `docs/`, `hostile.md` (HTML and links that must not run) and `notes.txt` (not markdown).
