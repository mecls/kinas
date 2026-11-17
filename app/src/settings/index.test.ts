import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SECTIONS, SETTINGS, sectionOf, settingMatches } from "./index.ts";
import { SHORTCUT_ACTIONS } from "./shortcuts.ts";

// The registry the palette searches is the page as built: every id it lists is a row on Settings, and every row on
// Settings is in it (build-spec §11.4, settings/index.test.ts). A row draws `data-setting` with its id (ui/SettingsRow).

const here = import.meta.dir;
const sources = [join(here, "..", "pages", "Settings.tsx"), ...readdirSync(here).filter((f) => /Section\.tsx$/.test(f)).map((f) => join(here, f))];

/** The ids the page's source draws as rows (settings/Row.tsx, slice 9): `<Row id="…">`, or one per shortcut. */
function idsOnThePage(): string[] {
  const ids: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/<Row\b[^>]*?\bid="([a-z][a-z.-]*)"/g)) ids.push(m[1]!);
    if (text.includes("id={`shortcuts.${action}`}")) ids.push(...SHORTCUT_ACTIONS.map((a) => `shortcuts.${a}`));
  }
  return ids;
}

describe("the settings registry", () => {
  test("one id each, every row exists", () => {
    const ids = SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const onPage = idsOnThePage();
    expect(new Set(onPage).size).toBe(onPage.length);
    expect([...onPage].sort()).toEqual([...ids].sort());
  });

  test("every setting sits in a listed section, and every section holds one", () => {
    for (const s of SETTINGS) expect(SECTIONS.map((x) => x.id)).toContain(s.section);
    for (const x of SECTIONS) expect(SETTINGS.some((s) => s.section === x.id)).toBe(true);
    expect(SECTIONS.map((x) => x.group)).toEqual([
      "Providers",
      "Providers",
      "Providers",
      "Providers",
      "Crew",
      "Workspace",
      "Workspace",
      "Workspace",
      "Interface",
      "Interface",
      "Interface",
      "Interface",
      "Interface",
      "System",
      "System",
    ]);
  });

  test("a setting is found by its label, its description or its section's title (Journey D)", () => {
    expect(settingMatches("ollama key").map((s) => s.id)).toEqual(["ollama.key"]);
    expect(settingMatches("deploy key")[0]!.id).toBe("convex.key");
    expect(settingMatches("hotkey")[0]!.id).toBe("hotkey.chord");
    expect(settingMatches("keychain").map((s) => s.id)).toEqual(["ollama.key"]);
    expect(settingMatches("dark").map((s) => s.id)).toContain("appearance.theme");
    expect(settingMatches("zzz")).toEqual([]);
    expect(sectionOf(settingMatches("ollama key")[0]!).title).toBe("Ollama Cloud");
  });
});
