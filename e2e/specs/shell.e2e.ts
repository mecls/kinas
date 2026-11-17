import { browser, $, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// AC-1 (the empty app and its store), the shell rules R28 (close hides) and R33 (pages stay mounted), and the
// sidebar of DESIGN.md §3.1: the five pages and Settings at the foot, the client folders from the projects root
// (shell.setup.ts plants fixtures/projects-discovery.json's tree), their categories, and no Reader row (folder views,
// 2026-09-23).

const dataDir = process.env.KINAS_DATA_DIR!;
const db = join(dataDir, "kinas.sqlite");

function sql(query: string): string {
  return execFileSync("/usr/bin/sqlite3", [db, query], { encoding: "utf8" }).trim();
}

async function hook<T>(name: string): Promise<T> {
  return (await browser.executeAsync((hookName: string, done: (v: unknown) => void) => {
    const hooks = (window as unknown as { __kinasTest?: Record<string, () => Promise<unknown>> }).__kinasTest;
    if (!hooks || !hooks[hookName]) return done({ error: `no test hook ${hookName}` });
    hooks[hookName]().then(done, (e: unknown) => done({ error: String(e) }));
  }, name)) as T;
}

describe("Kinas shell", () => {
  it("AC-1: opens a WAL store with one org and the latest schema", async () => {
    const info = await hook<{ org_id: string; path: string; schema_version: number }>("storeInfo");
    expect(info.path).toBe(db);
    // The latest schema is the number of migrations, so this does not go stale when one is added (it said 1 after
    // 0002_usage_details.sql raised SCHEMA_VERSION to 2).
    const latest = readdirSync(join(process.cwd(), "migrations")).filter((f) => f.endsWith(".sql")).length;
    expect(info.schema_version).toBe(latest);
    expect(sql("PRAGMA journal_mode")).toBe("wal");
    expect(sql("SELECT count(*) FROM orgs")).toBe("1");
    expect(sql("SELECT id FROM orgs")).toBe(info.org_id);
    const missingOrgId = sql(
      "SELECT count(*) FROM sqlite_master m WHERE m.type = 'table' AND m.name NOT IN ('orgs','schema_migrations','sqlite_sequence') AND NOT EXISTS (SELECT 1 FROM pragma_table_info(m.name) p WHERE p.name = 'org_id' AND p.\"notnull\" = 1)",
    );
    expect(missingOrgId).toBe("0");
  });

  it("starts on Home; ⌘2, ⌘4 and ⌘1 switch pages (keymap.md, 2026-09-22)", async () => {
    await expect($('section[data-page="home"]')).toBeDisplayed();
    await expect($('section[data-page="work"]')).not.toBeDisplayed();
    await browser.keys(["Meta", "2"]);
    await expect($('section[data-page="work"]')).toBeDisplayed();
    await expect($('section[data-page="home"]')).not.toBeDisplayed();
    await browser.keys(["Meta", "4"]);
    await expect($('section[data-page="usage"]')).toBeDisplayed();
    await browser.keys(["Meta", "1"]);
    await expect($('section[data-page="home"]')).toBeDisplayed();
    await expect($('section[data-page="usage"]')).not.toBeDisplayed();
  });

  it("R28: closing the window hides it and the app keeps running", async () => {
    await hook("closeWindow");
    await browser.waitUntil(async () => (await hook<boolean>("isVisible")) === false, {
      timeoutMsg: "window still visible after close",
    });
    expect(existsSync(db)).toBe(true);
    await hook("showWindow");
    await browser.waitUntil(async () => (await hook<boolean>("isVisible")) === true);
  });
});

/** A command's answer, or its refusal (never `{ error }`, the shape of a WebDriver error). */
const invoke = <T>(command: string, args?: Record<string, unknown>) =>
  browser.execute(
    (cmd: string, a: Record<string, unknown> | undefined) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(cmd, a).then(
        (value) => ({ ok: value }),
        (refusal) => ({ refused: String(refusal) }),
      ),
    command,
    args,
  ) as Promise<{ ok?: T; refused?: string }>;

interface FolderRow {
  name: string;
  cat: string | null;
  internal: boolean;
  tag: string | null;
}

/** The client folder rows as the sidebar shows them, in order. */
const folderRows = () =>
  browser.execute(() =>
    [...document.querySelectorAll(".sidebar-folders li")].map((li) => ({
      name: li.querySelector(".ui-nav-label")?.textContent ?? "",
      cat: li.getAttribute("data-cat"),
      internal: li.hasAttribute("data-internal"),
      tag: li.querySelector(".ui-tag")?.textContent ?? null,
    })),
  ) as Promise<FolderRow[]>;

describe("the sidebar (DESIGN.md §3.1)", () => {
  const shared = JSON.parse(readFileSync(join(process.cwd(), "fixtures/projects-discovery.json"), "utf8")) as { names: string[] };

  it("has the five pages, Settings as its last row, no count at zero, no machine without a VPS, and the client folders by name, six colours for six", async () => {
    await browser.waitUntil(async () => (await folderRows()).length === shared.names.length, { timeout: 30000, timeoutMsg: "the client folders never listed" });
    const seen = await browser.execute(() => ({
      rows: [...document.querySelectorAll(".sidebar-nav .ui-nav .ui-nav-label")].map((n) => n.textContent),
      counts: document.querySelectorAll(".sidebar-nav .ui-nav-count").length,
      current: [...document.querySelectorAll('.sidebar-nav .ui-nav[aria-current="page"] .ui-nav-label')].map((n) => n.textContent),
      // The interface polish (rule 22): the VPS left the sidebar for the status bar; the sidebar draws no machine.
      machine: document.querySelector(".sidebar .ui-machine, .sidebar [data-part=vps]") !== null,
      heading: document.querySelector(".sidebar-folders .ui-nav-h")?.textContent ?? null,
      last: document.querySelector(".sidebar")?.lastElementChild?.querySelector(".ui-nav-label")?.textContent ?? null,
      sections: [...document.querySelectorAll(".sidebar-scroll > section")].map((s) => s.getAttribute("aria-label")),
    }));
    expect(seen.rows).toEqual(["Home", "Work", "Crew", "Inbox", "Usage"]);
    // Settings left the pages for the foot (folder views, 2026-09-23): the sidebar's last element.
    expect(seen.last).toBe("Settings");
    // Nothing is pinned or open at launch: the client folders are the only section drawn.
    expect(seen.sections).toEqual(["Client folders"]);
    expect(seen.counts).toBe(0);
    expect(seen.current).toEqual(["Home"]);
    expect(seen.machine).toBe(false);
    expect(seen.heading).toBe("Client folders");
    const rows = await folderRows();
    expect(rows.map((r) => r.name)).toEqual(shared.names);
    expect(rows.every((r) => !r.internal && r.tag === null)).toBe(true);
    // Six folders wear six colours before any repeats (ui/category.ts).
    expect(new Set(rows.map((r) => r.cat)).size).toBe(6);
    expect(rows.every((r) => /^[1-6]$/.test(r.cat ?? ""))).toBe(true);
  });

  it("a category and an internal flag chosen for a folder show on the next listing; a seventh colour is refused", async () => {
    expect(await invoke("set_folder_category", { name: "hub", cat: 3 })).toEqual({ ok: null });
    expect(await invoke("set_folder_internal", { name: "hub", internal: true })).toEqual({ ok: null });
    expect((await invoke("set_folder_category", { name: "hub", cat: 7 })).refused).toContain("category must be 1 to 6");
    // The sidebar reads the folders again when the window comes forward.
    await browser.execute(() => window.dispatchEvent(new Event("focus")));
    await browser.waitUntil(async () => (await folderRows()).at(-1)?.name === "hub", { timeout: 15000, timeoutMsg: "hub never moved to the end as an internal folder" });
    const hub = (await folderRows()).at(-1)!;
    expect(hub).toEqual({ name: "hub", cat: "3", internal: true, tag: "internal" });
    // Settings lists the same folders with the same chip, and its chip cycles to the next colour.
    await browser.keys(["Meta", ","]);
    await expect($('section[data-page="settings"]')).toBeDisplayed();
    await expect($('[data-section="folders"] li[data-folder="hub"]')).toHaveAttribute("data-cat", "3");
    await $('[data-section="folders"] li[data-folder="hub"] .settings-folder-chip').click();
    await expect($('[data-section="folders"] li[data-folder="hub"]')).toHaveAttribute("data-cat", "4");
    await browser.waitUntil(async () => (await folderRows()).at(-1)?.cat === "4", { timeout: 15000, timeoutMsg: "the sidebar never took the new colour" });
    await browser.keys(["Escape"]);
    await expect($('section[data-page="home"]')).toBeDisplayed();
  });

  it("has no Reader row: the reader opens from a file's row, and the panel stays closed at launch", async () => {
    // The row is gone (folder views, 2026-09-23); the panel itself keeps its aria-label, so this looks only in the sidebar.
    const seen = await browser.execute(() => ({
      reader: document.querySelectorAll('.sidebar [aria-label="Reader"]').length,
      panel: document.querySelector(".shell")?.getAttribute("data-panel") ?? null,
    }));
    expect(seen).toEqual({ reader: 0, panel: "closed" });
  });

  // The interface polish, rule 9: each nav row and Settings carry the chord bound now, drawn while pointed at or focused,
  // out of the row's text (its title says it), so a row's text stays its name.
  it("every nav row carries its bound chord, shown on focus and hidden otherwise", async () => {
    const seen = await browser.execute(() => {
      const rows = [...document.querySelectorAll<HTMLButtonElement>(".sidebar-nav .ui-nav, .sidebar-foot .ui-nav")];
      const shown = (b: HTMLElement) => getComputedStyle(b.querySelector(".ui-nav-chord")!).display;
      const before = rows.map((b) => shown(b));
      // The test window is not the Mac's active one (document.hasFocus() is false), and WebKit matches :focus only in an
      // active window: the rule that shows the chord is read from the stylesheet instead of from a focused row.
      const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((r): r is CSSStyleRule => r instanceof CSSStyleRule);
      const showing = rules.find((r) => r.selectorText.includes(".ui-nav:focus > .ui-nav-chord") && r.selectorText.includes(".ui-nav:hover > .ui-nav-chord"));
      const workFocused = showing?.style.display ?? "no rule";
      return {
        chords: rows.map((b) => [b.querySelector(".ui-nav-label")?.textContent, b.querySelector(".ui-nav-chord")?.getAttribute("data-chord")]),
        texts: rows.map((b) => b.textContent),
        before,
        workFocused,
      };
    });
    expect(seen.chords).toEqual([
      ["Home", "⌘1"],
      ["Work", "⌘2"],
      ["Crew", "⌘3"],
      ["Inbox", "⌘5"],
      ["Usage", "⌘4"],
      ["Settings", "⌘,"],
    ]);
    expect(seen.texts).toEqual(["Home", "Work", "Crew", "Inbox", "Usage", "Settings"]);
    expect(seen.before.every((d) => d === "none")).toBe(true);
    expect(seen.workFocused).toBe("inline-block");
  });

  // The interface polish, rule 19: under the wordmark, a search row with the palette's chord; a click opens the palette.
  it("the search row under the wordmark opens the palette", async () => {
    const seen = await browser.execute(() => {
      const row = document.querySelector(".sidebar .ui-search");
      return { after: row?.previousElementSibling?.className ?? null, label: row?.querySelector(".ui-nav-label")?.textContent ?? null, chord: row?.querySelector(".ui-kbd")?.textContent ?? null };
    });
    expect(seen).toEqual({ after: "ui-word", label: "Search", chord: "⌘K" });
    await $(".sidebar .ui-search").click();
    await expect($(".palette")).toBeDisplayed();
    await browser.keys(["Escape"]);
    await expect($(".palette")).not.toBeExisting();
  });
});
