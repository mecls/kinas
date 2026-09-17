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
    // Asserted by property rather than as one exact string: the markup gained a gutter when line numbers landed,
    // and an equality assertion over the whole thing breaks on every future change to the wrapper.
    const html = renderSource("plain\n", null).html;
    expect(html).toContain('<pre class="reader-source"><code>plain\n</code></pre>');
    expect(html).not.toContain("language-");
  });
});

describe("the line-number gutter", () => {
  test("one number per line, in a sibling element the screen reader skips", () => {
    // A sibling, not a wrapper per line: highlight.js returns one HTML string whose spans can cross line
    // boundaries, so per-line elements would mean splitting that string and unbalancing its markup.
    const html = renderSource("a\nb\nc\n", "sql").html;
    expect(html).toContain('<pre class="reader-gutter" aria-hidden="true">1\n2\n3</pre>');
    expect(html).toContain('<code class="language-sql">a\nb\nc\n</code>');
  });

  test("a trailing newline does not invent a line", () => {
    const numbers = (text: string) => /reader-gutter" aria-hidden="true">([^<]*)</.exec(renderSource(text, null).html)?.[1];
    expect(numbers("one line\n")).toBe("1");
    expect(numbers("one line")).toBe("1");
    expect(numbers("")).toBe("1");
    expect(numbers("a\nb")).toBe("1\n2");
    // Two trailing newlines mean the file really does end with a blank line.
    expect(numbers("a\n\n")).toBe("1\n2");
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
