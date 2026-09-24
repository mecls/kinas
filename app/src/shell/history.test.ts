import { describe, expect, test } from "bun:test";
import { back, canBack, canForward, EMPTY_HISTORY, forward, type History, HISTORY_CAP, type Place, patchScroll, readerAtOf, record } from "./history.ts";

// The places ← and → walk (reader-layout PRD rules 29–31).

const doc = (name: string) => ({ path: `/p/${name}`, displayPath: name });
const file = (name: string, scrollTop = 0) => ({ kind: "file" as const, path: `/p/${name}`, scrollTop });
const none = { kind: "none" as const };
const at = (page: string, reader: Place["reader"]): Place => ({ page, reader });
/** A place as the PRD's walk writes it: (Usage, a.md), (Home, nothing). */
const words = (p: Place) => `(${p.page}, ${p.reader.kind === "none" ? "nothing" : p.reader.path.slice(3)})`;
/** Records each place in turn. */
const walked = (...places: Place[]) => places.reduce<History>((h, p) => record(h, p), EMPTY_HISTORY);

describe("the places ← and → walk (reader-layout PRD rules 29–31)", () => {
  // Recent's step-gating, carried here when Recent went (build spec §17, slice 7): the reader reports in steps.
  test("a report of the previous file with a new folder is not a new place", () => {
    let h = record(EMPTY_HISTORY, at("work", readerAtOf({ doc: doc("a.md"), folder: null }, true)));
    // `kinas open docs`: first the folder, with the file open before still reported…
    h = record(h, at("work", readerAtOf({ doc: doc("a.md"), folder: "/p/docs" }, true)));
    expect(h.places.map(words)).toEqual(["(work, a.md)"]);
    // …then the README it opened: that is the new place.
    h = record(h, at("work", readerAtOf({ doc: doc("docs/README.md"), folder: "/p/docs" }, true)));
    expect(h.places.map(words)).toEqual(["(work, a.md)", "(work, docs/README.md)"]);
  });

  test("a folder with no README is a place; a closed panel is none", () => {
    expect(readerAtOf({ doc: null, folder: "/p/empty" }, true)).toEqual({ kind: "folder", path: "/p/empty" });
    expect(readerAtOf({ doc: doc("a.md"), folder: "/p/docs" }, false)).toEqual(none);
    expect(readerAtOf({ doc: null, folder: null }, true)).toEqual(none);
    expect(readerAtOf({ doc: doc("a.md"), folder: null }, true)).toEqual(file("a.md"));
  });

  test("recording the current place again changes nothing", () => {
    const h = walked(at("home", none), at("usage", file("a.md", 120)));
    // A scroll is not a place: the same file further down is the same place, and the same history comes back.
    expect(record(h, at("usage", file("a.md", 900)))).toBe(h);
    expect(record(h, at("home", file("a.md")))).not.toBe(h);
  });

  test("back and forward walk the places; recording after back drops those ahead", () => {
    // The PRD's §5 walk: Home → Usage → A → B → Settings.
    let h = walked(at("home", none), at("usage", none), at("usage", file("a.md")), at("usage", file("b.md")), at("settings", file("b.md")));
    expect(canBack(h)).toBe(true);
    expect(canForward(h)).toBe(false);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = back(h)!;
      h = r.history;
      seen.push(words(r.place));
    }
    expect(seen).toEqual(["(usage, b.md)", "(usage, a.md)", "(usage, nothing)", "(home, nothing)"]);
    expect(back(h)).toBeNull();
    expect(canBack(h)).toBe(false);
    // → twice: (Usage, A).
    h = forward(forward(h)!.history)!.history;
    expect(words(h.places[h.at]!)).toBe("(usage, a.md)");
    expect(canForward(h)).toBe(true);
    // Opening C drops everything ahead, and → has nowhere to go.
    h = record(h, at("usage", file("c.md")));
    expect(h.places.map(words)).toEqual(["(home, nothing)", "(usage, nothing)", "(usage, a.md)", "(usage, c.md)"]);
    expect(canForward(h)).toBe(false);
    expect(forward(h)).toBeNull();
  });

  test("the 51st place drops the first", () => {
    let h: History = EMPTY_HISTORY;
    for (let n = 1; n <= HISTORY_CAP + 1; n++) h = record(h, at("usage", file(`f-${n}.md`)));
    expect(h.places.length).toBe(50);
    expect(words(h.places[0]!)).toBe("(usage, f-2.md)");
    expect(h.at).toBe(49);
  });

  test("patchScroll sets the current file's position only", () => {
    const h = walked(at("usage", file("a.md")), at("usage", file("b.md")), at("settings", file("b.md")));
    const patched = patchScroll(h, "/p/b.md", 640);
    expect(patched.places[2]!.reader).toEqual(file("b.md", 640));
    expect(patched.places[1]!.reader).toEqual(file("b.md"));
    // Another file than the current place's changes nothing.
    expect(patchScroll(h, "/p/a.md", 640)).toBe(h);
    // After ←, the place left is named by its index.
    const walkedBack = back(h)!.history;
    expect(patchScroll(walkedBack, "/p/b.md", 300, 2).places[2]!.reader).toEqual(file("b.md", 300));
    expect(patchScroll(walkedBack, "/p/b.md", 300, 2).at).toBe(1);
  });
});
