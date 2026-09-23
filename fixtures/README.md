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
  - `hostinger-vms.synthetic.json` and `hostinger-metrics.synthetic.json` — the shapes of
    `GET /api/vps/v1/virtual-machines` and `.../{id}/metrics`, taken from Hostinger's OpenAPI spec
    (`https://developers.hostinger.com/openapi/openapi.json`, read 2026-09-18). Every value is made up, IPs
    use TEST-NET-1 (192.0.2.0/24), and the numbers are chosen to carry assertions:
    - `ram_usage` 554 176 512 B against `memory` 8192 **MiB** is **6.4515 %**, and `disk_space`
      2 620 018 688 B against `disk` 51 200 MiB is **4.8802 %**. Reading the spec's "megabytes" as 10⁶
      instead of 2²⁰ gives 6.7649 % — close enough to look right, which is why the tests assert the exact
      figure rather than a range (hostinger R7).
    - traffic sums to 3 TiB outgoing and 1 TiB incoming against a 16 TiB `bandwidth`, so the two candidate
      rules give **25.0000 %** (both directions) and **18.7500 %** (outgoing only). They are deliberately
      far apart: a wrong aggregation rule must fail the test rather than pass it by luck (§7 Q1, Q2).
    - the newest sample differs from earlier ones in every metric, so "take the latest point" is tested
      rather than assumed; `srv18044` is `stopped`, so a non-running machine is exercised too.
    - `bandwidth` is written as MiB for consistency with `memory` and `disk`, but the spec's own example
      (2³⁰) is implausible either way and the real unit is **unconfirmed** — see §7 Q4. Replace with a real
      capture once a live response has been seen.
  - `handoff/*.json` — status line hand-off files built from the documented status line schema
    (code.claude.com/docs/en/statusline): `used_percentage` 0–100, `resets_at` in epoch seconds.
- Files ending in `.captured.json` **are** captured, from the first mate's slice-0 probe (2026-09-23): Firstmate at
  `f9f74a1` on Herdr 0.9.0, in a throwaway session with a scratch repository, never `default`. Every local path is
  rewritten — `__FM_HOME__` (Firstmate's home), `__ROOT__` (the probe's folders and `~/.treehouse`), `__HOME__` —
  and each file is checked against `scripts/private-names`:
  - `firstmate-fleet-snapshot.{empty,working,held,answered-outside-chat,done}.captured.json` — `fm-fleet-snapshot.sh
    --json` with no tasks, two workers, a finished scout beside a local-only ship held for the captain, that hold after
    an `fm-send.sh` answer closed it without anything landing, and after the landing and teardown.
  - `firstmate-home-summary.{fresh,done}.captured.json` — `state/home-summary.json` on a fresh home (`valid: false`,
    `missing structured backlog`) and after the fleet settled (`valid: true`).
  - `herdr-api-snapshot.captured.json`, `herdr-workspace-create.captured.json`,
    `herdr-process-info.{shell,claude}.captured.json` — Herdr's answers, including a worker's workspace and Claude
    Code's `name` being its version, not `claude`.
- Secrets in fixtures are obviously fake (`ollama-FAKE…`, `sk-ant-FAKE…`) so the repo greps in the
  build spec's AC-10 stay meaningful.
- No fixture contains a real transcript. Transcript fixtures are hand-written lines in the same
  shape as `~/.claude/projects/**/*.jsonl` and `~/.pi/agent/sessions/**/*.jsonl`.
- `reader/` — the projects root for `e2e/specs/reader.e2e.ts` and the release speed check: `plan-300.md` (exactly 300
  lines, generated once: frontmatter, one Mermaid diagram, a table, a task list, a link to `other.md#part`, a 1×1
  `diagram.png`), `other.md`, `docs/`, `hostile.md` (HTML and links that must not run) and `notes.txt` (not markdown).
