import { describe, expect, test } from "bun:test";
import { sectionButton, sectionPlace, SIDE_DEFAULT, type SectionState } from "./side.ts";

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
