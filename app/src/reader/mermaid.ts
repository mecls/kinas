// Mermaid for the reader (reader PRD R27): imported only when a page has a diagram, so Vite keeps it out of the main
// bundle, and each diagram is drawn once per source for the session. `securityLevel: "strict"` sanitizes labels and
// turns off click handlers, because a diagram in a file an agent wrote is untrusted input.

type Mermaid = (typeof import("mermaid"))["default"];

const CACHE_LIMIT = 200;
const cache = new Map<string, string>();
let loading: Promise<Mermaid> | null = null;
let counter = 0;

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function load(): Promise<Mermaid> {
  loading ??= import("mermaid").then(({ default: mermaid }) => {
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
  });
  return loading;
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
  try {
    const mermaid = await load();
    const { svg } = await mermaid.render(id, source);
    cache.set(hash, svg);
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
