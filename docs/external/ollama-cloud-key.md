# The Ollama Cloud API key

## What it is

A personal API key created on ollama.com, pasted once into Settings (⌘,). Kinas uses it to read the plan's usage windows for the Usage page.

## Where

Keychain service `ai.sintralabs.kinas`, account **`ollama-cloud-api-key`** (`keychain.rs`, `OLLAMA_ACCOUNT`; see `keychain.md`). `README.md` → Connecting the two plans → Ollama Cloud is the user-facing setup.

## Who reads it

`app/src-tauri/src/readers/ollama_cloud.rs` — one `GET https://ollama.com/api/usage` per poll with an `Authorization: Bearer` header (the endpoint is undocumented; the field paths were checked against the live response on 2026-09-14). `KINAS_OLLAMA_BASE_URL` points the reader at a stub server in tests.

## What it can do

Whatever the account can do through Ollama's API. Kinas asks it one thing: usage.

## Never

- Any request but that GET.
- The key in the store, the log, `kinas status --json` or `last_error` (`redact.rs` strips `Bearer …`).
- A `refreshInterval`-style re-run stamping old numbers as fresh: a failed read keeps the last good value (ADR 0004).
