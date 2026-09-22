# 0010 · Nothing in a file can run code in the app or reach the network

Date: 2026-09-16
Status: accepted

## Context

The reader renders documents that agents wrote — markdown, and since 2026-09-16 any HTML file — inside a webview that can call `pty_write`: a script that reached the app's window could type into the terminal, and a document that reached the network could exfiltrate whatever the page holds. The "any file" build set rules R12–R14 and proved them against a real listener (14 URLs aimed at it, 0 requests received). Two details decide everything: an iframe sandboxed with both `allow-scripts` and `allow-same-origin` can remove its own sandbox attribute, which MDN calls "no more secure than not using the sandbox attribute at all"; and `frame-ancestors` and `sandbox` are ignored in a meta CSP, so the isolation cannot be moved into the policy string. Recorded here on 2026-09-22.

## Decision

Markdown's raw HTML is off. An HTML file renders in an iframe whose sandbox attribute is `allow-scripts` and nothing else — never `allow-same-origin` beside it — with a CSP injected into the document that names every fetch directive (`default-src 'none'`, `connect-src 'none'`, `img-src 'none'`, …, `form-action 'none'`, `base-uri 'none'`) and allows only inline script (`script-src 'unsafe-inline'`, with no nonce and no hash, ever). The document is assigned to `srcdoc` as a property on an element made with `createElement`, so a file's bytes never pass through the parent document's `innerHTML`. No `postMessage` listener exists in a release build, and no `import()` path is ever built from a string that came out of a file.

## Consequences

A preview cannot load a stylesheet, a web font or an image from anywhere — mockups inline their styles (`tasks/_templates/mockup.html`) and the preview reports how many assets did not load. The literal strings are pinned by unit tests so a "simplification" fails before review. Enforced by `app/src/reader/preview.ts:11-23` (`PREVIEW_SANDBOX`), `:25-55` (the policy), `:60-70` (where the meta goes), `app/src/reader/preview.test.ts:11-53`, and `app/src/reader/Reader.tsx:444-468` (the `srcdoc` property assignment).
