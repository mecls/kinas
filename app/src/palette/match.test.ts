import { describe, expect, test } from "bun:test";
import { fold, highlight, ranked, score } from "./match.ts";

const COMPOSED = "reunião";
const DECOMPOSED = "reunião";

describe("fold", () => {
  test("folds both forms", () => {
    expect(COMPOSED).not.toBe(DECOMPOSED);
    expect(fold(COMPOSED)).toBe("reuniao");
    expect(fold(DECOMPOSED)).toBe("reuniao");
  });

  test("lowers case and takes Latin letters to their base, as search.rs does", () => {
    expect(fold("Ångström")).toBe("angstrom");
    expect(fold("ÇÃO Straße Æsir Œuvre Łódź Þór")).toBe("cao strasse aesir oeuvre lodz thor");
    expect(fold("Привет")).toBe("привет");
  });
});

describe("score", () => {
  test("word start ranks first", () => {
    expect(score("inv", "inventory.ts")!).toBeGreaterThan(score("inv", "reinvent.ts")!);
    expect(score("plan", "my-plan.md")!).toBeGreaterThan(score("plan", "airplane.md")!);
    expect(score("usage", "Go to Usage")!).toBeGreaterThan(score("sage", "Go to Usage")!);
  });

  test("a name hit ranks above a path hit, and the whole name above its start", () => {
    expect(score("inv", "reinvent.ts", "src/reinvent.ts")!).toBeGreaterThan(score("inv", "notes.md", "invoices/notes.md")!);
    expect(score("notes", "Notes")!).toBeGreaterThan(score("notes", "notes.md")!);
  });

  test("accents and case never stop a match", () => {
    expect(score("REUNIAO", `${DECOMPOSED} de março.md`)).toBe(6);
    expect(score(COMPOSED, "Reuniao.md")).toBe(6);
  });

  test("several words match when each is in the name or the path, below every whole match", () => {
    expect(score("ollama key", "API key", "Ollama Cloud Used only to read your usage.")).toBe(1);
    expect(score("key ollama", "API key", "Ollama Cloud")).toBe(1);
    expect(score("ollama key", "Deploy key", "Convex")).toBeNull();
    expect(score("api key", "API key", "Ollama Cloud")!).toBeGreaterThan(score("ollama key", "API key", "Ollama Cloud")!);
    expect(score("acme inventory", "inventory.ts", "clients/acme/src/inventory.ts")).toBe(1);
  });

  test("no match, or nothing typed, is null", () => {
    expect(score("zzz", "inventory.ts", "src/inventory.ts")).toBeNull();
    expect(score("   ", "inventory.ts")).toBeNull();
    expect(score("src", "inventory.ts")).toBeNull();
  });
});

describe("ranked", () => {
  test("best first; equal scores keep their order; misses dropped", () => {
    const titles = ["Refresh readings", "Go to Home", "Go to Usage", "Hide or show the sidebar"];
    expect(ranked(titles, (t) => score("go to", t))).toEqual(["Go to Home", "Go to Usage"]);
    expect(ranked(titles, (t) => score("re", t))).toEqual(["Refresh readings"]);
    expect(ranked(titles, (t) => score("s", t))).toEqual(["Hide or show the sidebar", "Refresh readings", "Go to Usage"]);
  });
});

describe("highlight", () => {
  test("marks the letters at a word's start before an earlier match inside a word", () => {
    expect(highlight("inv", "reinvent-inventory.ts")).toEqual([
      { text: "reinvent-", hit: false },
      { text: "inv", hit: true },
      { text: "entory.ts", hit: false },
    ]);
    expect(highlight("inv", "reinvent.ts")).toEqual([
      { text: "re", hit: false },
      { text: "inv", hit: true },
      { text: "ent.ts", hit: false },
    ]);
  });

  test("maps folded letters back, a decomposed accent included", () => {
    expect(highlight("reuniao", `${DECOMPOSED}.md`)).toEqual([
      { text: DECOMPOSED, hit: true },
      { text: ".md", hit: false },
    ]);
    expect(highlight("strasse", "Straße.md")).toEqual([
      { text: "Straße", hit: true },
      { text: ".md", hit: false },
    ]);
  });

  test("marks each word the name holds when the whole query is not in it", () => {
    expect(highlight("ollama key", "API key")).toEqual([
      { text: "API ", hit: false },
      { text: "key", hit: true },
    ]);
    expect(highlight("go usage", "Go to Usage")).toEqual([
      { text: "Go", hit: true },
      { text: " to ", hit: false },
      { text: "Usage", hit: true },
    ]);
  });

  test("nothing typed or no match leaves the name whole", () => {
    expect(highlight("", "README.md")).toEqual([{ text: "README.md", hit: false }]);
    expect(highlight("zzz", "README.md")).toEqual([{ text: "README.md", hit: false }]);
    expect(highlight("x", "")).toEqual([]);
  });
});
