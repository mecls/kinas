// The palette's matching (tasks/interface-polish, PRD rule 15; build-spec §11.2): case- and accent-insensitive, a
// match at the start of a word above one inside a word, a name match above a path match. The webview's groups score
// here; the Files group is scored by `app/src-tauri/src/search.rs`, which folds and ranks the same way.

const MARKS = /[̀-ͯ]/g;

/** Latin letters that carry no combining mark to strip, taken to their base by hand (Gate 2: no library). */
const LATIN: Readonly<Record<string, string>> = {
  æ: "ae",
  œ: "oe",
  ß: "ss",
  þ: "th",
  ð: "d",
  ø: "o",
  đ: "d",
  ħ: "h",
  ı: "i",
  ł: "l",
  ŧ: "t",
  ĳ: "ij",
  ŋ: "n",
  ŀ: "l",
  ſ: "s",
};

/** One character folded: lowercase, decomposed, its marks dropped. A mark alone folds to nothing. */
function foldChar(c: string): string {
  const base = c.toLowerCase().normalize("NFD").replace(MARKS, "");
  let out = "";
  for (const x of base) out += LATIN[x] ?? x;
  return out;
}

/** Lowercase, without accents, so "Reunião" stored composed or decomposed both read "reuniao". */
export function fold(s: string): string {
  let out = "";
  for (const c of s) out += foldChar(c);
  return out;
}

/** Where `q` sits in `s` right after the start or a character that is not a letter or a digit, or -1. */
function wordStart(s: string, q: string): number {
  for (let i = s.indexOf(q); i >= 0; i = s.indexOf(q, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(s[i - 1]!)) return i;
  }
  return -1;
}

/**
 * Higher is better; null is no match. The whole name, then the name's start, a word in the name, inside the name, a
 * word in the path, inside the path — `search.rs`'s `score`, tier for tier.
 */
export function score(query: string, name: string, path?: string): number | null {
  const q = fold(query.trim());
  if (q === "") return null;
  const n = fold(name);
  if (n === q) return 6;
  if (n.startsWith(q)) return 5;
  if (wordStart(n, q) >= 0) return 4;
  if (n.includes(q)) return 3;
  if (path === undefined) return null;
  const p = fold(path);
  if (wordStart(p, q) >= 0) return 2;
  if (p.includes(q)) return 1;
  return null;
}

/** `items` that match, best first; equal scores keep their given order. */
export function ranked<T>(items: readonly T[], scoreOf: (item: T) => number | null): T[] {
  return items
    .map((item, i) => ({ item, i, s: scoreOf(item) }))
    .filter((x): x is { item: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

/**
 * `name` cut into runs, the matched letters marked — the first match at a word's start, else the first match. Folded
 * letters map back to the characters they came from, so "reuniao" marks "Reunião" whether its ã is one character or
 * two; a combining mark goes with the letter before it.
 */
export function highlight(query: string, name: string): { text: string; hit: boolean }[] {
  const chars = [...name];
  const pieces = chars.map(foldChar);
  const folded = pieces.join("");
  const q = fold(query.trim());
  const ws = q === "" ? -1 : wordStart(folded, q);
  const at = ws >= 0 ? ws : q === "" ? -1 : folded.indexOf(q);
  if (at < 0) return name === "" ? [] : [{ text: name, hit: false }];
  const end = at + q.length;
  const runs: { text: string; hit: boolean }[] = [];
  let pos = 0;
  let previous = false;
  chars.forEach((c, k) => {
    const len = pieces[k]!.length;
    const hit = len === 0 ? previous : pos < end && pos + len > at;
    pos += len;
    previous = hit;
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += c;
    else runs.push({ text: c, hit });
  });
  return runs;
}
