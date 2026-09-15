import { describe, expect, test } from "bun:test";
import { hashText, renderMarkdown } from "./render.ts";

describe("nothing in a file runs (R19, R20)", () => {
  test("raw HTML, script included, comes out as escaped text", () => {
    const { html } = renderMarkdown('<script>window.__pwned=1</script>\n\n<img src=x onerror="window.__pwned=2">\n');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src");
  });

  test("dangerous link schemes get no href", () => {
    for (const href of ["javascript:window.__pwned=3", "vbscript:x", "file:///etc/hosts", "data:text/html,x"]) {
      expect(renderMarkdown(`[click](${href})`).html).not.toContain(`href="${href.split(":")[0]}`);
    }
    expect(renderMarkdown("[away](https://example.com)").html).toContain('href="https://example.com"');
  });

  test("images never carry a src, local or remote", () => {
    const { html } = renderMarkdown('![remote](https://example.com/p.png "T")\n\n![diagram](diagram.png)\n');
    expect(html).not.toContain(" src=");
    expect(html).toContain('<img data-src="https://example.com/p.png" alt="remote" title="T">');
    expect(html).toContain('<img data-src="diagram.png" alt="diagram">');
  });

  test("an .mdx import stays text", () => {
    expect(renderMarkdown('import X from "y"\n\n<X prop={1} />\n').html).toContain("&lt;X prop={1} /&gt;");
  });
});

describe("structure (R23–R27)", () => {
  test("headings get GitHub ids, and levels 1–3 are collected for Contents", () => {
    const r = renderMarkdown("# Plan\n\n## Setup\n\n## Setup\n\n#### Deep\n");
    expect(r.html).toContain('<h2 id="setup">Setup</h2>');
    expect(r.html).toContain('<h2 id="setup-1">Setup</h2>');
    expect(r.html).toContain('<h4 id="deep">');
    expect(r.headings).toEqual([
      { level: 1, text: "Plan", slug: "plan" },
      { level: 2, text: "Setup", slug: "setup" },
      { level: 2, text: "Setup", slug: "setup-1" },
    ]);
  });

  test("a Mermaid fence becomes a placeholder with its source hash; other fences stay code", () => {
    const source = "graph TD; A-->B\n";
    const r = renderMarkdown(`\`\`\`mermaid\n${source}\`\`\`\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n`);
    expect(r.diagrams).toEqual([{ index: 0, hash: hashText(source), source }]);
    expect(r.html).toContain(`<div class="mermaid-block" data-index="0" data-hash="${hashText(source)}"></div>`);
    expect(r.html).toContain('<pre><code class="language-ts">');
    expect(r.html.match(/<pre>/g)?.length).toBe(1);
  });

  test("task items are disabled checkboxes", () => {
    const { html } = renderMarkdown("- [x] done\n- [ ] todo\n- plain [x] later\n");
    expect(html).toContain('<li class="task-list-item"><input type="checkbox" disabled checked> done</li>');
    expect(html).toContain('<li class="task-list-item"><input type="checkbox" disabled> todo</li>');
    expect(html).toContain("<li>plain [x] later</li>");
  });

  test("frontmatter is split off and never rendered as markdown", () => {
    const r = renderMarkdown("---\ntitle: T\n---\n# Body\n");
    expect(r.frontmatter).toEqual({ ok: true, title: "T", rows: [] });
    expect(r.html).toBe('<h1 id="body">Body</h1>\n');
  });

  test("tables render, and a 300-line document renders quickly", () => {
    expect(renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n").html).toContain("<table>");
    const doc = Array.from({ length: 300 }, (_, i) => (i % 20 === 0 ? `## Section ${i}` : `Line ${i} with **bold** and \`code\`.`)).join("\n\n");
    renderMarkdown(doc);
    const started = performance.now();
    renderMarkdown(doc);
    expect(performance.now() - started).toBeLessThan(20);
  });
});
