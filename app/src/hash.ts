/** FNV-1a, 32-bit, over the UTF-16 code units: one small stable hash for the whole webview — the reader's diagram
 * cache key (reader/render.ts) and a client folder's default category (ui/category.ts) both read it. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
