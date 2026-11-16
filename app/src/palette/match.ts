// The palette's matching (tasks/interface-polish, PRD rule 15; build-spec §11.2): case- and accent-insensitive, a
// match at the start of a word above one inside a word, a name match above a path match. The webview's groups score
// here; the Files group is scored by `app/src-tauri/src/search.rs`, which folds and ranks the same way.
//
// Slice 3: a query of several words that does not match as a whole still matches when every word is found in the
// name or the path, below every whole match — "ollama key" finds "API key" under Ollama Cloud (Journey D).

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
 * word in the path, inside the path, then every word of the query somewhere in the name or the path — `search.rs`'s
 * `score`, tier for tier.
 */
export function score(query: string, name: string, path?: string): number | null {
  const q = fold(query.trim());
  if (q === "") return null;
  const n = fold(name);
  if (n === q) return 7;
  if (n.startsWith(q)) return 6;
  if (wordStart(n, q) >= 0) return 5;
  if (n.includes(q)) return 4;
  const p = path === undefined ? undefined : fold(path);
  if (p !== undefined && wordStart(p, q) >= 0) return 3;
  if (p !== undefined && p.includes(q)) return 2;
  const words = q.split(/\s+/);
  if (words.length > 1 && words.every((w) => n.includes(w) || (p !== undefined && p.includes(w)))) return 1;
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

/** Where `q` sits in the folded name: at a word's start if it is anywhere there, else its first place, else -1. */
const placeOf = (folded: string, q: string) => {
  const ws = wordStart(folded, q);
  return ws >= 0 ? ws : folded.indexOf(q);
};

/**
 * `name` cut into runs, the matched letters marked — the whole query where the name holds it (at a word's start before
 * inside one), else each of its words the name holds. Folded letters map back to the characters they came from, so
 * "reuniao" marks "Reunião" whether its ã is one character or two; a combining mark goes with the letter before it.
 */
export function highlight(query: string, name: string): { text: string; hit: boolean }[] {
  const chars = [...name];
  const pieces = chars.map(foldChar);
  const folded = pieces.join("");
  const q = fold(query.trim());
  const spans: [number, number][] = [];
  if (q !== "") {
    const at = placeOf(folded, q);
    if (at >= 0) spans.push([at, at + q.length]);
    else
      for (const w of q.split(/\s+/)) {
        const wat = placeOf(folded, w);
        if (wat >= 0) spans.push([wat, wat + w.length]);
      }
  }
  if (spans.length === 0) return name === "" ? [] : [{ text: name, hit: false }];
  const runs: { text: string; hit: boolean }[] = [];
  let pos = 0;
  let previous = false;
  chars.forEach((c, k) => {
    const len = pieces[k]!.length;
    const hit = len === 0 ? previous : spans.some(([from, to]) => pos < to && pos + len > from);
    pos += len;
    previous = hit;
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += c;
    else runs.push({ text: c, hit });
  });
  return runs;
}
