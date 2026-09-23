// Rewrites the token blocks of tasks/_templates/mockup.html from app/src/styles/tokens.css (DESIGN.md §9, "Adding a
// surface", step 3: the template inlines this repo's tokens).
//
//   bun scripts/mockup-template.ts
//
// A mockup opens in the reader's sandbox, which allows inline styles and nothing external, so the template carries its
// own copy of every token: the light :root, and the dark values twice — under the system's preference, and forced by
// `data-theme="dark"` on <html> so the other theme can be checked by hand. No @font-face: the sandbox loads no fonts,
// and the stacks fall back to the system's. Everything outside the markers is the template's own and is left alone.
// app/src/styles/preview.test.ts holds the result equal to tokens.css.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { declarations, mediaBlock, ruleBlock } from "../app/src/styles/testing/palette.ts";

const root = join(import.meta.dir, "..");
const tokens = readFileSync(join(root, "app/src/styles/tokens.css"), "utf8");
const light = declarations(ruleBlock(tokens, ":root"));
const dark = declarations(ruleBlock(mediaBlock(tokens, "screen and (prefers-color-scheme: dark)"), ":root"));

const lines = (map: Map<string, string>, indent: string) => [...map].map(([name, value]) => `${indent}${name}: ${value};`).join("\n");

const START = "/* ===== Tokens, generated from app/src/styles/tokens.css by scripts/mockup-template.ts — do not edit ===== */";
const END = "/* ===== End of the generated tokens ===== */";
const block = `${START}
:root{
${lines(light, "  ")}
  color-scheme:light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]){
${lines(dark, "    ")}
    color-scheme:dark;
  }
}
/* Set data-theme="dark" on <html> to check the other theme. */
:root[data-theme="dark"]{
${lines(dark, "  ")}
  color-scheme:dark;
}
${END}`;

const path = join(root, "tasks/_templates/mockup.html");
const html = readFileSync(path, "utf8");
const from = html.includes(START) ? html.indexOf(START) : html.indexOf("/* ===== Brand layer (overridable) ===== */");
const to = html.includes(END) ? html.indexOf(END) + END.length : html.indexOf("/* ===== Base ===== */");
if (from < 0 || to < 0 || to < from) throw new Error("mockup.html: cannot find its token blocks");
writeFileSync(path, `${html.slice(0, from)}${block}\n\n${html.slice(to).replace(/^\n+/, "")}`);
console.log(`mockup.html: ${light.size} light tokens, ${dark.size} dark`);
