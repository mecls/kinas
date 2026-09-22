// Which ground the window draws on is the window's appearance (Settings → Appearance; Rust sets it), and the page
// follows through one media query in styles/tokens.css. Almost everything needs nothing more. Two things copy the
// tokens into colours of their own, once — the terminal and Mermaid — and ask here to be told when the ground turns,
// and to be handed a colour they can parse: since the design system (2026-09-22) a token may be a `color-mix()`
// expression, which `getPropertyValue` returns as text, so `resolvedToken` reads the colour the engine actually
// painted. The accent is the one token set at runtime, from Settings, as an inline property on the root.

import { oklabToRgb } from "./styles/color.ts";

const LIGHT = "(prefers-color-scheme: light)";

/** Calls `fn` when the ground has changed; the tokens already have their new values. Returns the unsubscribe. */
export function onThemeChange(fn: () => void): () => void {
  const query = window.matchMedia(LIGHT);
  query.addEventListener("change", fn);
  return () => query.removeEventListener("change", fn);
}

let probe: HTMLElement | null = null;

/** A token's colour as painted — `#rrggbb` (or `#rrggbbaa` when translucent) — whatever expression defines it. */
export function resolvedToken(name: string): string {
  if (!probe) {
    probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
  }
  probe.style.backgroundColor = `var(${name})`;
  return toHex(getComputedStyle(probe).backgroundColor);
}

/**
 * A computed colour as `#rrggbb[aa]`: `rgb(r, g, b)`, `rgba(…)`, `rgb(r g b / a)` — and `oklab(L a b)`, which is
 * how WebKit reports a `color-mix(in oklab, …)` it painted. Anything else is returned as it came.
 */
export function toHex(color: string): string {
  const lab = /^oklab\(\s*([\d.]+%?)\s+(-?[\d.]+%?)\s+(-?[\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(color.trim());
  if (lab) {
    const num = (v: string, scale: number) => (v.endsWith("%") ? (Number(v.slice(0, -1)) / 100) * scale : Number(v));
    let hex = oklabToRgb([num(lab[1]!, 1), num(lab[2]!, 0.4), num(lab[3]!, 0.4)]);
    if (lab[4] !== undefined) {
      const alpha = lab[4].endsWith("%") ? Number(lab[4].slice(0, -1)) / 100 : Number(lab[4]);
      if (alpha < 1) hex += Math.round(alpha * 255).toString(16).padStart(2, "0");
    }
    return hex;
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(color.trim());
  if (!m) return color.trim();
  const channel = (v: string) => Math.round(Number(v)).toString(16).padStart(2, "0");
  let hex = `#${channel(m[1]!)}${channel(m[2]!)}${channel(m[3]!)}`;
  if (m[4] !== undefined) {
    const alpha = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    if (alpha < 1) hex += Math.round(alpha * 255).toString(16).padStart(2, "0");
  }
  return hex;
}

/** The accent chosen in Settings, or `null` for the brand's default: one inline property on the root, nothing else. */
export function applyAccent(hex: string | null): void {
  const root = document.documentElement;
  if (hex) root.style.setProperty("--brand-accent", hex);
  else root.style.removeProperty("--brand-accent");
}
