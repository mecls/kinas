import { describe, expect, test } from "bun:test";
import { DRAG_THRESHOLD_PX, dropIndex, pastThreshold } from "./TabStrip.tsx";

// Four tabs, 100 px each, from x = 0: middles at 50, 150, 250, 350.
const rects = [0, 100, 200, 300].map((left) => ({ left, width: 100 }));

describe("the tab strip's drag (reader-layout PRD rule 19)", () => {
  test("a press becomes a drag at 4 px", () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
    expect(pastThreshold(3, 0)).toBe(false);
    expect(pastThreshold(0, -3)).toBe(false);
    expect(pastThreshold(4, 0)).toBe(true);
    expect(pastThreshold(-3, 3)).toBe(true);
  });

  test("a drop index from the pointer and the tabs' boxes", () => {
    // The last tab, dropped left of the first: first place.
    expect(dropIndex(-20, rects, 3)).toBe(0);
    // The first, dropped past the last: last place.
    expect(dropIndex(900, rects, 0)).toBe(3);
    // Over its own box, it stays.
    expect(dropIndex(120, rects, 1)).toBe(1);
    expect(dropIndex(180, rects, 1)).toBe(1);
    // Past a neighbour's middle, it takes that neighbour's place.
    expect(dropIndex(260, rects, 1)).toBe(2);
    expect(dropIndex(40, rects, 1)).toBe(0);
  });
});
