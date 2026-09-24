import { describe, expect, test } from "bun:test";
import type { DiffView } from "../api.ts";
import { renderDiff, renderRefusal } from "./diff.ts";

const at1402 = new Date(2026, 8, 23, 14, 2).getTime();

const view = (over: Partial<DiffView> = {}): DiffView => ({
  path: "/p/kinas/docs/overview.md",
  display_path: "docs/overview.md",
  root: "/p/kinas",
  ext: "md",
  since_ms: at1402,
  mark: "M",
  added: 1,
  removed: 1,
  rows: [
    { kind: "context", old: 1, new: 1, text: "# Overview", fold: null },
    { kind: "remove", old: 2, new: null, text: "old line", fold: null },
    { kind: "add", old: null, new: 2, text: "new line", fold: null },
  ],
  folds: [],
  baseline_text: null,
  ...over,
});

describe("the Changes view's markup (rules 21–25)", () => {
  test("renderDiff_escapes_text", () => {
    const html = renderDiff(view({ rows: [{ kind: "add", old: null, new: 1, text: `<img src=x onerror=alert(1)> & "q"`, fold: null }] })).html;
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;");
  });

  test("each_row_carries_its_sign_and_numbers", () => {
    const rendered = renderDiff(view());
    expect(rendered.headings).toEqual([]);
    expect(rendered.html).toContain('<p class="ui-diff-summary"><span class="ui-diff-count">+1 −1</span> <span class="ui-diff-since">since 14:02</span></p>');
    const rows = [...rendered.html.matchAll(/<div class="ui-diff-row" data-kind="(\w+)">(.*?)<\/div>/g)].map((m) => m[1] + " " + m[2]);
    expect(rows).toEqual([
      'context <span class="ui-diff-no">1</span><span class="ui-diff-no">1</span><span class="ui-diff-sign"></span><pre><code class="language-markdown"># Overview</code></pre>',
      'remove <span class="ui-diff-no">2</span><span class="ui-diff-no"></span><span class="ui-diff-sign">−</span><pre><code class="language-markdown">old line</code></pre>',
      'add <span class="ui-diff-no"></span><span class="ui-diff-no">2</span><span class="ui-diff-sign">+</span><pre><code class="language-markdown">new line</code></pre>',
    ]);
  });

  test("a_fold_row_holds_its_lines_hidden", () => {
    const rows = [
      { kind: "add" as const, old: null, new: 1, text: "top", fold: null },
      ...Array.from({ length: 5 }, (_, i) => ({ kind: "context" as const, old: i + 1, new: i + 2, text: `same ${i}`, fold: 0 })),
    ];
    const html = renderDiff(view({ rows, folds: [{ id: 0, lines: 5 }] })).html;
    // The fold's row sits right before the first line it hides, and every line it hides waits, hidden.
    expect(html).toContain('<button type="button" class="ui-diff-fold" data-fold="0">5 unchanged lines</button><div class="ui-diff-row" data-kind="context" data-fold="0" hidden>');
    expect(html.match(/data-fold="0" hidden/g)?.length).toBe(5);
    expect(html.match(/class="ui-diff-fold"/g)?.length).toBe(1);
  });

  test("a deleted file says what it was, under the summary", () => {
    const html = renderDiff(view({ mark: "D", added: 0, removed: 1, rows: [{ kind: "remove", old: 1, new: null, text: "gone", fold: null }] })).html;
    expect(html).toContain('</p><p class="ui-diff-lead">Deleted since 14:02 — what it said then</p><div class="ui-diff-rows">');
    expect(renderDiff(view()).html).not.toContain("ui-diff-lead");
  });

  test("a refusal is one escaped line and no rows", () => {
    const html = renderRefusal("Too many changes to show — 1,204 lines then, 980 now <b>").html;
    expect(html).toBe('<div class="ui-diff"><p class="ui-diff-refusal">Too many changes to show — 1,204 lines then, 980 now &lt;b&gt;</p></div>');
  });

  test("a file with no known language is plain monospace", () => {
    expect(renderDiff(view({ ext: "zzz" })).html).toContain("<pre><code># Overview</code></pre>");
  });
});
