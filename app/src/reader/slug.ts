// Heading slugs the way GitHub makes them (reader PRD R24), so a link written for GitHub, `other.md#setup`, lands on
// the same heading here: lower-case, drop everything but letters, marks, numbers, connectors, spaces and `-`, then
// spaces become `-`. A repeated slug gets `-1`, `-2`, in document order.

const DROP = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;

export function slugify(text: string): string {
  return text.toLowerCase().replace(DROP, "").replace(/ /g, "-");
}

/** One per document: remembers the slugs handed out so far. */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = slugify(text);
    let slug = base;
    while (seen.has(slug)) {
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      slug = `${base}-${n}`;
    }
    seen.set(slug, 0);
    return slug;
  };
}
