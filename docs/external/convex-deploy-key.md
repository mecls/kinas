# The Convex deploy key

## What it is

A Convex deploy key minted for one deployment with the single scope **`deployment:usage:view`** (prd-convex-usage.md R2), pasted once into Settings. Kinas uses it to read the nine usage metrics of the month for the Usage page (the month gauge is labelled as an upper bound).

## Where

Keychain service `ai.sintralabs.kinas`, account **`convex-deploy-key`** (`keychain.rs`, `CONVEX_ACCOUNT`; see `keychain.md`). The deployment URL is a setting, not a secret.

## Who reads it

`app/src-tauri/src/readers/convex/mod.rs` — one `GET https://<deployment>.convex.cloud/api/v1/get_current_usage` per poll. The auth scheme is `Convex`, not `Bearer`, and a test pins it. The endpoint is documented as beta; every failure keeps the previous numbers and changes only `reader_status` (R12).

## What it can do

Read usage, and nothing else: with that scope the key cannot deploy, cannot read or write data, cannot run functions and cannot read environment variables. This is the one provider whose credential agrees with the watch-only rule; the habit still starts here because Hostinger's does not.

## Never

- Watch-only and GET-only — no write, ever, and tests grep the reader for any other verb (ADR 0008).
- The key in `kinas.sqlite`, the log, `kinas status --json` or `last_error`.
- A key with a wider scope stored under this account: if usage needs more one day, that is a new PRD, not a bigger key.
