// Which ground the window draws on is the window's appearance (Settings → Appearance; Rust sets it), and the page
// follows through one media query in styles/tokens.css. Almost everything needs nothing more. Two things copy the
// tokens into colours of their own, once — the terminal and Mermaid — and ask here to be told when the ground turns.

const LIGHT = "(prefers-color-scheme: light)";

/** Calls `fn` when the ground has changed; the tokens already have their new values. Returns the unsubscribe. */
export function onThemeChange(fn: () => void): () => void {
  const query = window.matchMedia(LIGHT);
  query.addEventListener("change", fn);
  return () => query.removeEventListener("change", fn);
}
