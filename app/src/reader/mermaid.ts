// Mermaid for the reader (reader PRD R27): imported only when a page has a diagram, so Vite keeps it out of the main
// bundle, and each diagram is drawn once per source for as long as the ground stays. `securityLevel: "strict"` sanitizes labels and
// turns off click handlers, because a diagram in a file an agent wrote is untrusted input.

type Mermaid = (typeof import("mermaid"))["default"];

const CACHE_LIMIT = 200;
const cache = new Map<string, string>();
let loading: Promise<Mermaid> | null = null;
let counter = 0;

/** Goes up when the ground turns (theme.ts): a diagram drawn for the old one is not kept. */
let ground = 0;

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Mermaid bakes colours into each SVG, so they are read from the tokens as they stand now. */
function initialize(mermaid: Mermaid): Mermaid {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: token("--panel"),
      primaryColor: token("--panel"),
      primaryBorderColor: token("--blue"),
      primaryTextColor: token("--white"),
      secondaryColor: token("--ground"),
      tertiaryColor: token("--ground"),
      textColor: token("--white"),
      // --line is invisible on --ground at a line's thickness, so lines use --muted.
      lineColor: token("--muted"),
      fontFamily: token("--sans"),
      fontSize: "14px",
    },
  });
  return mermaid;
}

function load(): Promise<Mermaid> {
  loading ??= import("mermaid").then(({ default: mermaid }) => initialize(mermaid));
  return loading;
}

/** The ground turned: every drawn SVG holds the old colours, so none is kept, and the next one reads the new tokens.
 *  The reader then redraws the diagrams on screen. */
export function diagramsNeedRedrawing(): void {
  ground++;
  cache.clear();
  if (loading) loading = loading.then(initialize);
}

/** The SVG already drawn for this source, if any; a hit counts as recent use. */
export function cachedSvg(hash: string): string | undefined {
  const svg = cache.get(hash);
  if (svg !== undefined) {
    cache.delete(hash);
    cache.set(hash, svg);
  }
  return svg;
}

export async function renderDiagram(hash: string, source: string): Promise<{ svg: string } | { error: string }> {
  const hit = cachedSvg(hash);
  if (hit !== undefined) return { svg: hit };
  const id = `kinas-diagram-${++counter}`;
  const drawnFor = ground;
  try {
    const mermaid = await load();
    const { svg } = await mermaid.render(id, source);
    // Drawn while the ground was turning: shown, and redrawn by the reader, but never the copy that is kept.
    if (drawnFor === ground) cache.set(hash, svg);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    return { svg };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message.split("\n")[0] || "This diagram could not be drawn" };
  } finally {
    // Mermaid leaves its scratch element in <body> when a diagram fails.
    document.getElementById(`d${id}`)?.remove();
  }
}
