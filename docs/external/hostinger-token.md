# The Hostinger API token

## What it is

An API token from the Hostinger account that owns the VPS, pasted once into Settings. Kinas uses it to read the machine's state, uptime, CPU, memory, disk and network for the Usage page (prd-hostinger-usage.md).

## Where

Keychain service `ai.sintralabs.kinas`, account **`hostinger-api-token`** (`keychain.rs`, `HOSTINGER_ACCOUNT`; see `keychain.md`). Create it with an expiry.

## Who reads it

`app/src-tauri/src/readers/hostinger/mod.rs` — two GETs per poll: `/api/vps/v1/virtual-machines` and `/api/vps/v1/virtual-machines/{id}/metrics?date_from=…&date_to=…` (both dates are required; a 422 means Kinas built the window wrong). Usage is in bytes and allowances in MiB; the conversion lives in `pct_of_mib` alone. Bandwidth is a figure, not a gauge, until a probe settles whether samples are deltas or counters.

## What it can do

**Everything the account can.** Hostinger offers no read-only scope — its docs say a token "will have same permissions as the owning user" — and the endpoints that would recreate this machine, reset its root password or buy another VPS sit in the same URL namespace as the two Kinas reads, differing only by verb and suffix.

So watch-only is a property of the code, not of the credential: two guard tests at the foot of the reader (`no_verb_but_get_reaches_hostinger`, `no_destructive_path_is_ever_constructed`) read the module's own source and fail on any other verb or any destructive path, with a negative control (`the_guards_are_reading_real_code_and_not_an_empty_string`) proving the guards are reading real code.

## Never

- Any request but those two GETs; any edit that weakens or skips the guard tests (ADR 0008, ADR 0012).
- The token in the store, the log, `kinas status --json` or `last_error`.
- The token pasted into a transcript, a document, a fixture or a shell history: a probe that needs it is run by the captain, and only the numbers come back.
