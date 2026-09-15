// What a link (or an image source) in a rendered page points at (reader PRD R21). Pure: the reader decides what to do
// with each kind, and Rust decides whether a file may be opened. Runs in the webview, so paths are joined here rather
// than with node:path.

export type LinkTarget =
  | { kind: "fragment"; id: string }
  | { kind: "external"; url: string }
  | { kind: "file"; path: string; fragment: string | null }
  | { kind: "ignore" };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const EXTERNAL = /^(https?|mailto):/i;

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

function dirname(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

/** Joins and normalizes `.` and `..` segments; never climbs above `/`. */
export function joinPath(base: string, relative: string): string {
  const parts: string[] = [];
  for (const segment of `${base}/${relative}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

/**
 * @param currentPath the real path of the document the link is in
 * @param root the projects root, for links that start with `/`
 */
export function classifyLink(href: string | null | undefined, currentPath: string, root: string): LinkTarget {
  if (!href) return { kind: "ignore" };
  if (href.startsWith("#")) {
    const id = decode(href.slice(1));
    return id ? { kind: "fragment", id } : { kind: "ignore" };
  }
  if (SCHEME.test(href)) return EXTERNAL.test(href) ? { kind: "external", url: href } : { kind: "ignore" };
  if (href.startsWith("//")) return { kind: "ignore" };

  const hash = href.indexOf("#");
  const beforeHash = hash >= 0 ? href.slice(0, hash) : href;
  const fragment = hash >= 0 ? decode(href.slice(hash + 1)) || null : null;
  const query = beforeHash.indexOf("?");
  const pathPart = decode(query >= 0 ? beforeHash.slice(0, query) : beforeHash);
  if (pathPart === null) return { kind: "ignore" };
  if (pathPart === "") return fragment ? { kind: "fragment", id: fragment } : { kind: "ignore" };

  const base = pathPart.startsWith("/") ? root : dirname(currentPath);
  return { kind: "file", path: joinPath(base, pathPart), fragment };
}
