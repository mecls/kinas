import { describe, expect, test } from "bun:test";
import { injectCsp, PREVIEW_CSP, PREVIEW_SANDBOX } from "./preview.ts";

// The preview is the one place in Kinas that renders a document an agent may have written, in a process whose
// webview can type into the terminal. These cases are the parts of that isolation a unit test can reach: the
// literal sandbox string and where the policy lands. Whether WebKit *enforces* the policy in a script-running
// sandboxed frame is the one thing reading cannot settle, and is what the 6.0 probe exists for (R18).

const META = /<meta http-equiv="Content-Security-Policy"/;

describe("the sandbox attribute", () => {
  test("is exactly allow-scripts, and never same-origin", () => {
    // Pinned as a literal rather than left to review: with `allow-same-origin` beside `allow-scripts` the framed
    // document can remove its own sandbox attribute, and the whole isolation is gone (R12).
    expect(PREVIEW_SANDBOX).toBe("allow-scripts");
    expect(PREVIEW_SANDBOX).not.toContain("allow-same-origin");
  });

  test("grants nothing else that would reach the app or the screen", () => {
    for (const token of ["allow-top-navigation", "allow-popups", "allow-modals", "allow-forms", "allow-downloads", "allow-pointer-lock", "allow-presentation"]) {
      expect(PREVIEW_SANDBOX).not.toContain(token);
    }
  });
});

describe("the policy itself", () => {
  test("carries no nonce and no hash, or 'unsafe-inline' is ignored and the preview goes dark", () => {
    expect(PREVIEW_CSP).not.toMatch(/nonce-/);
    expect(PREVIEW_CSP).not.toMatch(/sha(256|384|512)-/);
  });

  test("names form-action and base-uri, which do not fall back to default-src", () => {
    expect(PREVIEW_CSP).toContain("form-action 'none'");
    expect(PREVIEW_CSP).toContain("base-uri 'none'");
  });

  test("lets inline script run but blocks every fetch", () => {
    expect(PREVIEW_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CSP).toContain("script-src 'unsafe-inline'");
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
    expect(PREVIEW_CSP).toContain("img-src 'none'");
  });

  test("uses single quotes only, so it cannot break out of the content attribute", () => {
    expect(PREVIEW_CSP).not.toContain('"');
  });

  test("does not try to carry the isolation, which a meta element ignores", () => {
    // `frame-ancestors` and `sandbox` are ignored in a meta-delivered policy. Naming them here would read as
    // protection that isn't there, and invite someone to drop the attribute as redundant.
    expect(PREVIEW_CSP).not.toContain("frame-ancestors");
    expect(PREVIEW_CSP).not.toContain("sandbox");
  });
});

describe("where the policy is injected", () => {
  test("with no DOCTYPE, it is the document's first bytes", () => {
    const out = injectCsp("<p>hello</p>");
    expect(out.search(META)).toBe(0);
    expect(out).toEndWith("<p>hello</p>");
  });

  test("an empty file still gets a policy", () => {
    expect(injectCsp("")).toMatch(META);
  });

  test("a DOCTYPE keeps its place, whatever its case", () => {
    const out = injectCsp("<!DOCTYPE HTML>\n<p>x</p>");
    expect(out).toStartWith("<!DOCTYPE HTML>");
    // Immediately after it: nothing of the file may be parsed before the policy.
    expect(out.search(META)).toBe("<!DOCTYPE HTML>".length);
  });

  test("a comment before the DOCTYPE is legal HTML, and the DOCTYPE still keeps its place", () => {
    // Injecting ahead of the DOCTYPE would drop the page into quirks mode, so the scan walks the comment.
    const out = injectCsp("<!-- generated -->\n<!doctype html><p>x</p>");
    expect(out.indexOf("<!doctype html>")).toBeLessThan(out.search(META));
    expect(out.search(META)).toBe(out.indexOf("<!doctype html>") + "<!doctype html>".length);
  });

  test("a BOM stays first, and the policy follows it", () => {
    const out = injectCsp("﻿<p>x</p>");
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.search(META)).toBe(1);
  });

  test("a spoofed <head> earlier in the file is never used as the insertion point", () => {
    // The whole reason the scan does not look for <head>: a file can put one in its text.
    const out = injectCsp("<p>write &lt;head&gt; or even <head> here</p>");
    expect(out.search(META)).toBe(0);
    expect(out.search(META)).toBeLessThan(out.indexOf("<head>"));
  });

  test("a DOCTYPE further down the document is ignored", () => {
    const out = injectCsp("<p>x</p><!DOCTYPE html>");
    expect(out.search(META)).toBe(0);
  });

  test("an unterminated comment cannot push the policy down the file", () => {
    const out = injectCsp("<!-- <!DOCTYPE html> <p>x</p>");
    expect(out.search(META)).toBe(0);
  });

  test("a commented-out DOCTYPE does not count as one", () => {
    const out = injectCsp("<!-- <!DOCTYPE html> --><p>x</p>");
    expect(out.search(META)).toBe(0);
  });

  test("the file's own CSP is left alone, because policies combine restrictively", () => {
    // A hostile `default-src *` cannot widen ours: the page gets the intersection of both, so ours still wins.
    const hostile = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src *">';
    const out = injectCsp(hostile);
    expect(out).toContain('content="default-src *"');
    expect(out).toContain(PREVIEW_CSP);
    // Ours is parsed first.
    expect(out.indexOf(PREVIEW_CSP)).toBeLessThan(out.indexOf("default-src *"));
  });

  test("the file's bytes are never altered, only prefixed", () => {
    const file = '<!doctype html><script>window.__pwned = 1</script><img src=x onerror="alert(1)">';
    expect(injectCsp(file).replace(META_TAG, "")).toBe(file);
  });
});

/** The exact tag `injectCsp` inserts, rebuilt here so the test above can subtract it. */
const META_TAG = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
