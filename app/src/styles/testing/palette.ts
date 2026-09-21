// What the palette tests share: WCAG contrast, and the custom properties a stylesheet declares. Strings in, values
// out — the tests read the real CSS off disk and hand it over.

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A commented-out declaration is not a declaration. */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** What sits between the braces that open at or after `from`, nested blocks included; "" when there are none. */
function braced(css: string, from: number): string {
  const open = css.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return "";
}

/** The body of `@media <query> { … }`, or "" when the sheet has no such block. The query must match exactly. */
export function mediaBlock(css: string, query: string): string {
  const at = stripComments(css).indexOf(`@media ${query} {`);
  return at < 0 ? "" : braced(stripComments(css), at);
}

/** The body of the first `selector { … }` rule in `css`, or "" when there is none. */
export function ruleBlock(css: string, selector: string): string {
  const clean = stripComments(css);
  const at = new RegExp(`(^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`).exec(clean);
  return at ? braced(clean, at.index) : "";
}

/** Every `--name: value` in a rule's body, in order. */
export function declarations(body: string): Map<string, string> {
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

export const isHex = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);
