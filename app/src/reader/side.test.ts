import { describe, expect, test } from "bun:test";
import { dragWidth, drawnWidth, edgeDrag, sectionButton, sectionPlace, SIDE_DEFAULT, type SectionState } from "./side.ts";

const contents = (s: Partial<SectionState>): SectionState => ({ name: "Contents", offered: true, narrow: false, shown: true, overlayOpen: false, ...s });

describe("the side column's sections (reader-layout PRD rules 1–3)", () => {
  test("wide, a section's button shows its remembered state", () => {
    expect(sectionButton(contents({ shown: true }))).toEqual({ pressed: true, title: "Hide Contents" });
    expect(sectionButton(contents({ shown: false }))).toEqual({ pressed: false, title: "Show Contents" });
    expect(sectionButton({ ...contents({ shown: false }), name: "Files" })).toEqual({ pressed: false, title: "Show Files" });
    // An open overlay left over from a narrower reader does not press a wide button.
    expect(sectionButton(contents({ shown: false, overlayOpen: true }))).toEqual({ pressed: false, title: "Show Contents" });
    expect(sectionPlace(contents({ shown: true }))).toBe("beside");
    expect(sectionPlace(contents({ shown: false }))).toBeNull();
  });

  test("narrow, a button is the overlay's", () => {
    for (const shown of [true, false]) {
      expect(sectionButton(contents({ narrow: true, shown, overlayOpen: false }))).toEqual({ pressed: false, title: "Contents" });
      expect(sectionButton(contents({ narrow: true, shown, overlayOpen: true }))).toEqual({ pressed: true, title: "Contents" });
      expect(sectionPlace(contents({ narrow: true, shown, overlayOpen: false }))).toBeNull();
      expect(sectionPlace(contents({ narrow: true, shown, overlayOpen: true }))).toBe("over");
    }
  });

  test("a section not offered has no button and no place", () => {
    for (const narrow of [true, false])
      for (const shown of [true, false])
        for (const overlayOpen of [true, false]) {
          const s = contents({ offered: false, narrow, shown, overlayOpen });
          expect(sectionButton(s)).toBeNull();
          expect(sectionPlace(s)).toBeNull();
        }
  });

  test("the default shows both at 220 px — the same set commands.rs falls back to", () => {
    // READER_SIDE_DEFAULT in app/src-tauri/src/commands.rs pins the same value from its side.
    expect(SIDE_DEFAULT).toEqual({ contents: true, files: true, width: 220 });
  });
});

describe("the side column's width (reader-layout PRD rules 5–7)", () => {
  test("the column is drawn at its stored width, but the text keeps 320 px", () => {
    expect(drawnWidth(220, 1000)).toBe(220);
    expect(drawnWidth(300, 1400)).toBe(300);
    expect(drawnWidth(480, 700)).toBe(380);
    expect(drawnWidth(480, 640)).toBe(320);
    // Not measured yet: the stored width, not a column squeezed to its minimum for one frame.
    expect(drawnWidth(300, 0)).toBe(300);
  });

  test("a drag asks for 160 to 480, and never more than leaves the text 320", () => {
    expect(dragWidth(100, 1000)).toBe(160);
    expect(dragWidth(600, 1400)).toBe(480);
    expect(dragWidth(400, 700)).toBe(380);
    expect(dragWidth(250, 1000)).toBe(250);
    expect(dragWidth(250.4, 1000)).toBe(250);
  });

  test("the edge saves once per drag", () => {
    const live: (number | null)[] = [];
    const saved: number[] = [];
    const edge = edgeDrag({ live: (w) => live.push(w), save: (w) => saved.push(w) });
    edge.down(220);
    for (let i = 1; i <= 20; i++) edge.move(220 + i * 5, 1000);
    edge.end();
    edge.end();
    expect(saved).toEqual([320]);
    expect(live.length).toBe(22);
    expect(live.at(-1)).toBeNull();
    expect(edge.dragging).toBe(false);
  });

  test("a press and release that leaves the width where it was saves nothing, and a move after the end is ignored", () => {
    const saved: number[] = [];
    const edge = edgeDrag({ live: () => {}, save: (w) => saved.push(w) });
    edge.down(220);
    edge.move(220, 1000);
    edge.end();
    edge.move(400, 1000);
    edge.end();
    expect(saved).toEqual([]);
  });

  test("a cancelled drag keeps the width it reached", () => {
    const saved: number[] = [];
    const edge = edgeDrag({ live: () => {}, save: (w) => saved.push(w) });
    edge.down(300);
    edge.move(20, 1000);
    edge.end();
    expect(saved).toEqual([160]);
  });
});
