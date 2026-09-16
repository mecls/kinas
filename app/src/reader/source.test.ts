import { describe, expect, test } from "bun:test";
import { renderImage, renderSource } from "./source.ts";

// A source view is nothing but escaping (R9, R19). The reader shares its webview with the code that can type into
// the terminal, so anything a file contains must arrive as text — these cases are the proof, not the comment above
// `renderSource`.

describe("source is escaped, never markup", () => {
  test("a script tag and an inline handler come out as visible text", () => {
    const html = renderSource('<script>window.__pwned = 1</script>\n<img src=x onerror="alert(1)">\n', "xml").html;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror=\"alert(1)\"");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=");
  });

  test("the language class is escaped too, so a language id can never close the attribute", () => {
    const html = renderSource("x", 'sql" onload="alert(1)').html;
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain("&quot;");
  });

  test("no language renders a plain block", () => {
    expect(renderSource("plain\n", null).html).toBe("<pre class=\"reader-source\"><code>plain\n</code></pre>");
  });
});

describe("the Rendered shape", () => {
  test("source has no headings, no frontmatter and no diagrams, so Contents hides itself", () => {
    const rendered = renderSource("# not a heading here\n", "markdown");
    expect(rendered.headings).toEqual([]);
    expect(rendered.frontmatter).toBeNull();
    expect(rendered.diagrams).toEqual([]);
  });

  test("a --- leading file keeps its head: source never runs the frontmatter split", () => {
    // renderMarkdown calls splitFrontmatter unconditionally, so a .yaml or a Jekyll .html would lose its first
    // lines if source reused that path. Bypassing it is the fix, and this is what pins it.
    const yaml = "---\nname: kinas\nversion: 2\n---\n";
    const html = renderSource(yaml, "yaml").html;
    expect(html).toContain("---\nname: kinas");
    expect(html).toContain("version: 2");
  });
});

describe("an image opened by name", () => {
  test("data-src is the bare name and there is no src, so nothing loads until Rust resolves it", () => {
    // Not the absolute path: classifyLink reads a leading `/` as "relative to the projects root", so an absolute
    // path would resolve to <root>/Users/… and fall back to alt text. The document is the image, so its own
    // folder is the base.
    const html = renderImage("/Users/someone/Projects/app/docs/diagram.png").html;
    expect(html).toContain('data-src="diagram.png"');
    expect(html).toContain('alt="diagram.png"');
    expect(html).not.toContain(" src=");
    expect(html).not.toContain("/Users/someone");
  });

  test("a name needing escaping stays escaped", () => {
    expect(renderImage('/a/b/we"ird<.png').html).toContain('data-src="we&quot;ird&lt;.png"');
  });
});
