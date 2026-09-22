# The macOS Keychain

## What it is

Every secret Kinas holds lives in the login Keychain as a generic password, never in `kinas.sqlite`, the log, a config file or an env var (ADR 0006).

## Where

Service **`ai.sintralabs.kinas`** (`app/src-tauri/src/keychain.rs`, `SERVICE`), one account per secret:

| Account | Secret | Entry |
|---|---|---|
| `ollama-cloud-api-key` | the Ollama Cloud API key | `ollama-cloud-key.md` |
| `convex-deploy-key` | the Convex deploy key | `convex-deploy-key.md` |
| `hostinger-api-token` | the Hostinger API token | `hostinger-token.md` |

## Who reads it

- `keychain.rs` — the `KeyStore` trait; the real store shells out to `/usr/bin/security`, and every write is read back before it counts as saved. Items created by `security` stay readable by it without a prompt, so unsigned rebuilds of Kinas do not re-prompt.
- Settings (⌘,) — write-only fields with a "Stored in Keychain" caption; the Settings commands take the store as Tauri state (`Keys`).
- Each provider's reader (`readers/ollama`, `readers/convex`, `readers/hostinger`) reads its own account at poll time.
- Tests: `KINAS_E2E_MEMORY_KEYCHAIN=1` swaps in an in-memory store, optionally pre-filled with `KINAS_E2E_OLLAMA_KEY` (debug builds only).

## What it can do

Hold and return the three values above to the app that stored them.

## Never

- A secret in argv: writes go through `security -i`, which reads the whole command from **stdin**, because argv is visible to `ps` and `add-generic-password -w` silently truncates at 128 characters (Convex keys are long enough to hit that).
- A secret in the store, the log, `kinas status --json` or `last_error`: `redact.rs` strips bearer tokens and Anthropic-style key prefixes from every message before it is stored or logged, and `scripts/acceptance.sh` (AC-10) greps the store and the log for them.
- A value in this folder or in any document.
