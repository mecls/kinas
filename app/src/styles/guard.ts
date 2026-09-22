// The rules guard.test.ts applies to every stylesheet and component under app/src (DESIGN.md §9), and the ratchet:
// the raw values each old sheet still holds, which may only fall. Pure — strings in, findings out.

export interface Hit {
  line: number;
  message: string;
}

/** Raw values the sheets not yet rewritten still hold, by file, on the day the guard landed (2026-09-22): 314 in
 * all. Each slice of the design-system build brings its sheet to zero and removes the line; a count may only fall.
 * shell.css reached zero with slice 3 (the shell). */
export const RATCHET: Record<string, number> = {
  "styles/overlay.css": 20,
  "styles/reader.css": 126,
  "styles/settings.css": 35,
  "styles/usage.css": 74,
};

const COLOUR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\brgba?\(|\bhsla?\(/g;
const PX = /(-?\d*\.?\d+)px\b/g;
const SPACING = /^(margin|padding|gap|row-gap|column-gap|inset|inset-block|inset-inline)(-[a-z]+)?$/;
const EDGE = /^(top|right|bottom|left)$/;
const RADIUS = /^border-radius$|^border-(top|bottom)-(left|right)-radius$/;
const SIZE = /^(width|height|min-width|min-height|max-width|max-height|grid-template-columns|grid-template-rows|grid-auto-rows|flex-basis|box-shadow|transform|background-size|background-position|stroke-width|letter-spacing)$/;
const BORDER = /^(border|border-top|border-right|border-bottom|border-left|border-width|outline|outline-offset|outline-width|border-inline|border-block)$/;
const TYPE = /^(font-size|line-height|font)$/;

/** Component geometry is the component's own; the stories' scaffolding counts as a component's too. */
const inUi = (file: string) => file.startsWith("ui/");
const inStories = (file: string) => file.startsWith("ui/stories/");

/** A property's px values, in order, ignoring 0. */
function pxValues(value: string): string[] {
  return [...value.matchAll(PX)].map((m) => `${m[1]}px`).filter((v) => !/^-?0(\.0+)?px$/.test(v));
}

/** Every finding in a stylesheet or component file, with its line. */
export function violations(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  const clean = file.endsWith(".css") ? text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")) : text;
  const lineOf = (index: number) => clean.slice(0, index).split("\n").length;

  // Colours: nowhere but tokens.css. A custom-property declaration (`--c: #…`) is a token too; `color-mix(…, white)`
  // derives from one.
  for (const m of clean.matchAll(COLOUR)) {
    const lineStart = clean.lastIndexOf("\n", m.index) + 1;
    const lineText = clean.slice(lineStart, clean.indexOf("\n", m.index) < 0 ? undefined : clean.indexOf("\n", m.index));
    if (/^\s*--[\w-]+\s*:/.test(lineText) && file.endsWith(".css")) continue;
    // In a component, "#142" is a PR number in prose; a colour is quoted or follows a colon in a style object.
    if (!file.endsWith(".css") && m[0].startsWith("#") && !/["'`:]\s*$/.test(clean.slice(Math.max(0, m.index! - 3), m.index))) continue;
    hits.push({ line: lineOf(m.index!), message: `raw colour ${m[0].replace("(", "")} — use a token from tokens.css` });
  }

  if (file.endsWith(".css")) {
    for (const m of clean.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
      const prop = m[1]!;
      const value = m[2]!.trim();
      if (prop.startsWith("--")) continue;
      // WKWebView freezes a background transition across the window's theme change (found 2026-09-22: every
      // element with one kept its dark colour on a light page), so backgrounds do not transition (DESIGN.md §2.7).
      if (prop === "transition" && /\bbackground/.test(value)) {
        hits.push({ line: lineOf(m.index!), message: "a background transition freezes across the theme change in WKWebView — transition transform, opacity or width" });
        continue;
      }
      const px = pxValues(value);
      if (px.length === 0) continue;
      const line = lineOf(m.index!);
      if (TYPE.test(prop)) {
        for (const v of px) hits.push({ line, message: `raw ${prop} ${v} — use --fs-*` });
      } else if (SPACING.test(prop)) {
        for (const v of px) hits.push({ line, message: `raw spacing ${v} — use --space-*` });
      } else if (RADIUS.test(prop)) {
        for (const v of px) hits.push({ line, message: `raw border-radius ${v} — use --radius-*` });
      } else if (BORDER.test(prop)) {
        for (const v of px) if (v !== "1px" && v !== "2px") hits.push({ line, message: `raw border ${v} — hairlines are 1px, the focus ring 2px` });
      } else if (EDGE.test(prop)) {
        if (!inUi(file)) for (const v of px) hits.push({ line, message: `raw offset ${v} outside app/src/ui/ — use --space-*` });
      } else if (SIZE.test(prop)) {
        if (!inUi(file)) for (const v of px) hits.push({ line, message: `raw size ${v} outside app/src/ui/ — a layout token, or a component` });
      } else {
        for (const v of px) hits.push({ line, message: `raw ${prop} ${v}` });
      }
    }
  } else if (!inStories(file)) {
    // A component or a page: an inline style may carry a custom property, a percentage or a token — not a size.
    for (const m of clean.matchAll(/style=\{\{([^}]*)\}\}/g)) {
      for (const px of pxValues(m[1]!)) hits.push({ line: lineOf(m.index!), message: `raw inline size ${px} — a token, a class, or a --custom property` });
      for (const n of m[1]!.matchAll(/\b(fontSize|padding|margin|gap|width|height)\s*:\s*(\d+)\b/g)) {
        hits.push({ line: lineOf(m.index!), message: `raw inline ${n[1]} ${n[2]} — a token or a class` });
      }
    }
  }
  return hits;
}
