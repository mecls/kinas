// The words the reader's header makes from a file's name. Pure, so bun tests cover them.

/** `docs/plan.md` as its muted folder part and its bright name. Joined back together they are the path, exactly. */
export function splitDisplayPath(displayPath: string): { dir: string; name: string } {
  const slash = displayPath.lastIndexOf("/");
  return { dir: displayPath.slice(0, slash + 1), name: displayPath.slice(slash + 1) };
}

/**
 * The extension after the last dot, or null when the name has none.
 *
 * A leading dot is not an extension: `.gitignore` is a whole name, and so is `Dockerfile`. Rust's `ext` cannot be
 * used for this — for a name without an extension it is the whole name, which is what picks the highlighter.
 */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : null;
}

/** The badge beside the name: `MD`, `SQL`. Nothing for a name with no extension. */
export function extBadge(name: string): string | null {
  return extensionOf(name)?.toUpperCase() ?? null;
}

/** "Download as .md" — or, for `Dockerfile`, "Download a copy": there is no "as" to speak of. */
export function downloadLabel(name: string): string {
  const ext = extensionOf(name);
  return ext ? `Download as .${ext.toLowerCase()}` : "Download a copy";
}
