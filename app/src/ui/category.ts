import { fnv1a } from "../hash.ts";
import type { Category } from "./Dot.tsx";

// DESIGN.md §3.1: every client folder wears one of six category colours (--cat-1 … --cat-6). Settings may choose one;
// a folder without a choice gets one derived from its name, so a new checkout wears the same colour on every launch
// and the six are spread before any repeat. Pure, so the sidebar, Settings and the stories agree without a store.

export const CATEGORIES = 6;

/** The colour a name falls on by itself: stable, and the seed for the spread below. */
export function hashedCategory(name: string): Category {
  return ((fnv1a(name) % CATEGORIES) + 1) as Category;
}

/**
 * A category for every folder. Chosen ones come first and are never moved. The rest are seated in the order given:
 * the name's own colour if no folder wears it yet, else the next free one round the six — so two folders share a
 * colour only once all six are worn, and then by the hash alone.
 */
export function categoriesFor(names: readonly string[], chosen: Readonly<Record<string, number | null | undefined>>): Record<string, Category> {
  const out: Record<string, Category> = {};
  const worn = new Set<Category>();
  for (const name of names) {
    const pick = chosen[name];
    if (pick !== undefined && pick !== null && pick >= 1 && pick <= CATEGORIES) {
      out[name] = pick as Category;
      worn.add(pick as Category);
    }
  }
  for (const name of names) {
    if (out[name]) continue;
    const seed = hashedCategory(name);
    let cat = seed;
    for (let step = 0; step < CATEGORIES; step++) {
      const candidate = (((seed - 1 + step) % CATEGORIES) + 1) as Category;
      if (!worn.has(candidate)) {
        cat = candidate;
        break;
      }
    }
    out[name] = cat;
    worn.add(cat);
  }
  return out;
}
