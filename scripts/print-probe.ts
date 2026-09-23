// Proves that "Print as PDF" prints the document, only the document, across pages.
//
//   bun scripts/print-probe.ts                  the real check: exit 0 when every case passes
//   bun scripts/print-probe.ts --no-print-css   the control: the same page without print.css, which must FAIL
//
// An agent cannot click the macOS print sheet, and WebKit's pagination cannot be read off a stylesheet. So this builds
// the reader's page as the app builds it — the real renderers, the real stylesheets, the shell's real skeleton — and
// prints it through the same WebKit call the app's print button reaches (scripts/print-probe.swift).
//
// A case passes when the PDF has at least MIN_PAGES pages, still contains the document's last line, and contains none
// of the sentinels planted in the sidebar, the page, the reader's header and its side column. The control matters as
// much as the check: a probe that reports five pages whatever the stylesheet says has proved nothing. Without
// print.css the root is `height: 100%; overflow: hidden`, so the control prints one clipped page.
//
// Needs a logged-in GUI session (WebKit needs a window server), so it is not part of `bun run check`.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderMarkdown } from "../app/src/reader/render.ts";
import { renderSource } from "../app/src/reader/source.ts";

const MIN_PAGES = 5;
const SENTINELS = ["SIDEBAR-SENTINEL", "CONTENT-SENTINEL", "HEADER-SENTINEL", "SIDE-SENTINEL"];

const repo = resolve(import.meta.dir, "..");
const styles = join(repo, "app/src/styles");
const withPrintCss = !process.argv.includes("--no-print-css");
const out = join(tmpdir(), "kinas-print-probe");

/** Every stylesheet the app loads, in main.tsx's order, with print.css last — or left out, for the control. */
function stylesheets(): string {
  const order = ["tokens.css", "shell.css", "usage.css", "home.css", "settings.css", "overlay.css", "reader.css"];
  const present = readdirSync(styles).filter((name) => name.endsWith(".css") && name !== "print.css");
  const unknown = present.filter((name) => !order.includes(name));
  if (unknown.length > 0) throw new Error(`print-probe does not know where ${unknown.join(", ")} loads; add it to the order`);
  const sheets = order.filter((name) => present.includes(name));
  if (withPrintCss) sheets.push("print.css");
  return sheets.map((name) => `<style data-sheet="${name}">\n${readFileSync(join(styles, name), "utf8")}\n</style>`).join("\n");
}

/** The shell as App.tsx builds it, with the panel open beside a page, and a sentinel in everything that must not print. */
function page(render: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Kinas</title>
${stylesheets()}
</head>
<body>
<div id="root">
  <div class="shell" data-sidebar="shown" data-panel="open">
    <nav class="sidebar" aria-label="Sidebar">SIDEBAR-SENTINEL</nav>
    <div class="stage">
      <main class="content"><section class="page" data-page="usage"><p>CONTENT-SENTINEL</p></section></main>
      <div class="stage-divider" role="separator"></div>
      <aside class="shell-panel reader" aria-label="Reader" style="flex-basis: 45%">
        <div class="reader-frame">
          <header class="reader-head"><span class="reader-path">HEADER-SENTINEL</span></header>
          <div class="reader-main" data-narrow="">
            <div class="reader-side" data-overlay=""><nav class="reader-contents">SIDE-SENTINEL</nav></div>
            <div class="reader-scroll">
              <article class="reader-doc" data-render="${render}" data-rendered="">
                <div class="reader-body">${bodyHtml}</div>
              </article>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</div>
</body>
</html>`;
}

interface Case {
  name: string;
  render: "markdown" | "source";
  html: string;
  /** Text from the very end of the document: present only if the last page printed. */
  lastLine: string;
}

function cases(): Case[] {
  const plan = readFileSync(join(repo, "fixtures/reader/plan-300.md"), "utf8");
  const lastHeading = [...plan.matchAll(/^#{1,6}\s+(.+)$/gm)].at(-1)?.[1]?.trim();
  if (!lastHeading) throw new Error("fixtures/reader/plan-300.md has no heading to look for");
  // A long source file that is always here: the reader itself. Numbered so its last line is unmistakable.
  const source = `${readFileSync(join(repo, "app/src/reader/Reader.tsx"), "utf8")}\n// PRINT-PROBE-LAST-LINE\n`;
  return [
    { name: "markdown", render: "markdown", html: renderMarkdown(plan).html, lastLine: lastHeading },
    { name: "source", render: "source", html: renderSource(source, "typescript").html, lastLine: "PRINT-PROBE-LAST-LINE" },
  ];
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let failed = false;
for (const c of cases()) {
  const htmlPath = join(out, `${c.name}.html`);
  const pdfPath = join(out, `${c.name}.pdf`);
  writeFileSync(htmlPath, page(c.render, c.html));

  const run = Bun.spawnSync(["swift", join(repo, "scripts/print-probe.swift"), htmlPath, pdfPath], { stdout: "pipe", stderr: "pipe", timeout: 180_000 });
  const stdout = run.stdout.toString().trim();
  const pages = Number(/pages=(\d+)/.exec(stdout)?.[1] ?? Number.NaN);
  if (run.exitCode !== 0 || Number.isNaN(pages) || !existsSync(`${pdfPath}.txt`)) {
    // Not a result: the probe itself broke. Say so distinctly, so nobody records "pagination failed" from this.
    console.error(`${c.name}: PROBE ERROR (exit ${run.exitCode}) ${stdout} ${run.stderr.toString().trim().split("\n").slice(-3).join(" | ")}`);
    process.exit(70);
  }

  const text = readFileSync(`${pdfPath}.txt`, "utf8");
  const leaked = SENTINELS.filter((s) => text.includes(s));
  const hasLastLine = text.includes(c.lastLine);
  const ok = pages >= MIN_PAGES && hasLastLine && leaked.length === 0;
  if (!ok) failed = true;
  console.log(
    `${c.name}: ${ok ? "PASS" : "FAIL"} pages=${pages} (need ≥ ${MIN_PAGES}) last-line=${hasLastLine ? "present" : "MISSING"} leaked=${leaked.length === 0 ? "none" : leaked.join(",")}`,
  );
}

console.log(`${withPrintCss ? "with" : "WITHOUT"} print.css → ${failed ? "FAIL" : "PASS"}   (PDFs in ${out})`);
process.exit(failed ? 1 : 0);
