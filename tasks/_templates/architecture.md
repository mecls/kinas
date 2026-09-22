# Architecture: <feature name>

Gate 2. Written only when the feature touches more than one layer (the webview and Rust, the
CLI and the store, a reader and a page). Saved as `tasks/<feature-slug>/architecture.md`,
**private** (git-ignored): read it at its absolute path in the main checkout. Read the code
before writing this — never design against an imagined codebase.

## Fit

<Which existing modules this touches and how, named by file and line as read today:
`app/src-tauri/src/<module>.rs:<lines>`, `app/src/<file>.tsx:<lines>`, `cli/src/<file>.ts`,
`packages/<pkg>/src/<file>.ts`. Say what each one does now and what changes.>

## Commands and tables

<The `#[tauri::command]`s added or changed, one line each with the direction of the call;
the migration (`migrations/NNNN_<slug>.sql`) and the tables or columns it adds, with an
outline of the queries that will hit them; the `kinas` subcommands added or changed. Or
"none" for a layer this feature does not touch.>

## Flow

<The end-to-end call order for the main path, top to bottom: what calls what, from the click
or the command to the row and back to the screen. One flow per journey that crosses a layer.>

## External

<Everything outside the repository this depends on: third-party APIs, OS capabilities,
processes run, files read — with env var **names** only, never values, and a pointer to the
`docs/external/` entry for each. Or "none".>
