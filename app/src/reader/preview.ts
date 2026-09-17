// The HTML preview's isolation, as two frozen constants and one pure function (reader PRD R12, R13, R14, R18).
// Pure: no DOM and no Tauri, so bun tests cover it.
//
// This is the one place in Kinas that deliberately renders a document an agent may have written, inside a process
// whose webview can call `pty_write`. Nothing here is a preference. The sandbox attribute denies the page the app;
// the injected policy denies it the network; and `hydrate` assigns the document to `iframe.srcdoc` as a *property*
// so the file's bytes never pass through the parent document's `innerHTML` (R13).

/**
 * The frame's sandbox attribute — `allow-scripts` and **nothing else** (R12).
 *
 * `allow-same-origin` must never appear beside it: with both, the framed document can remove its own sandbox
 * attribute, which MDN calls "no more secure than not using the sandbox attribute at all". Its absence is what
 * denies the page `window.parent`'s DOM, `__TAURI_INTERNALS__`, `invoke` and `pty_write`.
 *
 * Every other token stays off and each omission earns its place: no `allow-top-navigation` (the frame cannot
 * navigate the app away from index.html), no `allow-popups`, no `allow-modals` (a page cannot freeze the app in an
 * alert loop), no `allow-forms`, no `allow-downloads`. `preview.test.ts` pins this literal string, because a
 * reviewer skimming a diff is exactly the wrong last line of defence.
 */
export const PREVIEW_SANDBOX = "allow-scripts";

/**
 * The policy injected into every previewed document (R14).
 *
 * `script-src 'unsafe-inline'` is what "scripts may run" means: inline code and handlers run, while `<script src>`
 * is a fetch and is blocked. **No nonce and no hash may ever appear here** — if either does, browsers ignore
 * `'unsafe-inline'` and the preview silently goes dark.
 *
 * `form-action` and `base-uri` do **not** fall back to `default-src` and so are named explicitly; omitting them is
 * the classic hole, letting a page POST to a remote endpoint or retarget every relative URL with `<base href>`.
 * The fetch directives are listed redundantly on purpose, so the policy reads as intent and nobody has to recall
 * the fallback table to review it.
 *
 * Note that `frame-ancestors` and `sandbox` are *ignored* in a meta element, which is why the isolation comes from
 * `PREVIEW_SANDBOX` above and must never be "simplified" into this string.
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** The policy uses single quotes only, so it never needs escaping inside this double-quoted attribute. */
const META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

/**
 * Where the policy goes: immediately after a leading DOCTYPE if there is one, else as the document's first bytes.
 *
 * **Never by searching for `<head>`** (R14): a file can carry a literal `<head>` in its text, in a comment, or
 * inside a script, and injecting after that would put the policy *below* markup it is supposed to govern. The scan
 * here can only ever walk a BOM, whitespace and properly terminated comments — anything else stops it — so a
 * DOCTYPE further down the document is deliberately ignored, and `<!-- <!DOCTYPE html> -->` cannot fool it.
 *
 * Skipping comments matters for correctness rather than safety: a comment before the DOCTYPE is legal HTML, and
 * inserting the meta ahead of the DOCTYPE would drop the page into quirks mode.
 */
function insertionPoint(html: string): number {
  // Keep a BOM first if there is one; a meta in front of it would leave the BOM as stray text in the body.
  const start = html.charCodeAt(0) === 0xfeff ? 1 : 0;
  let at = start;
  for (;;) {
    while (at < html.length && /\s/.test(html[at]!)) at++;
    if (!html.startsWith("<!--", at)) break;
    const end = html.indexOf("-->", at + 4);
    // An unterminated comment swallows the rest of the file, so there is no DOCTYPE to sit after.
    if (end === -1) return start;
    at = end + 3;
  }
  if (!/^<!doctype/i.test(html.slice(at, at + 9))) return start;
  const close = html.indexOf(">", at);
  return close === -1 ? start : close + 1;
}

/**
 * The document as it is handed to the frame: the file's own bytes, untouched, with the policy prepended.
 *
 * A page's own CSP is left in place. It cannot weaken ours, because multiple policies combine restrictively — the
 * page gets the intersection — so a hostile `default-src *` only ever narrows to what we already allow.
 */
export function injectCsp(html: string): string {
  const at = insertionPoint(html);
  return html.slice(0, at) + META + html.slice(at);
}
