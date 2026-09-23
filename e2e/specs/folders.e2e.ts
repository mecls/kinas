import { browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Folder views (tasks/folder-views/prd.md §5; DESIGN.md §3.1, 1.3): a client folder hidden from the sidebar and Home
// by a right-click and shown again, hidden and removed and restored from Settings, and a folder added through the
// sheet — which folders.setup.ts answers through KINAS_E2E_PICK_FOLDER. Every read and click is one script in the page:
// each WebDriver lookup costs seconds, and a notice lasts six.

const dataDir = process.env.KINAS_DATA_DIR!;
const root = realpathSync(join(dataDir, "root"));
const pickFile = join(dataDir, "pick.txt");
const db = join(dataDir, "kinas.sqlite");
const shared = JSON.parse(readFileSync(join(process.cwd(), "fixtures/projects-discovery.json"), "utf8")) as { names: string[] };

const sql = (query: string) => execFileSync("/usr/bin/sqlite3", [db, query], { encoding: "utf8" }).trim();
const stored = (key: string) => JSON.parse(sql(`SELECT value FROM settings WHERE key = '${key}'`) || "[]") as string[];

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

/** The sidebar's client folders, name → colour, in order. */
const sidebar = () =>
  browser.execute(() => [...document.querySelectorAll(".sidebar-folders li")].map((li) => [li.querySelector(".ui-nav-label")?.textContent ?? "", li.getAttribute("data-cat") ?? ""])) as Promise<[string, string][]>;

/** Home's Overnight rows, by name. */
const overnight = () =>
  browser.execute(() => [...document.querySelectorAll('section[data-page="home"] [data-section="overnight"] [data-folder]')].map((r) => r.getAttribute("data-folder") ?? "")) as Promise<string[]>;

async function waitForRows(count: number, what: string) {
  await browser.waitUntil(async () => (await sidebar()).length === count, { timeout: 15000, interval: 250, timeoutMsg: `the sidebar never listed ${count} folders ${what}` });
}

/**
 * Right-clicks a client folder (or the heading, for null) and returns what the menu offers, a divider as "—", and
 * whether WebKit's own menu was kept away. The menu renders after the script that right-clicked, so a second waits.
 */
async function rightClick(name: string | null) {
  const prevented = await browser.execute((n: string | null) => {
    const target =
      n === null
        ? document.querySelector<HTMLElement>(".sidebar-folders .ui-nav-h")!
        : [...document.querySelectorAll<HTMLElement>(".sidebar-folders li")].find((li) => li.querySelector(".ui-nav-label")?.textContent === n)!;
    const r = target.getBoundingClientRect();
    // `dispatchEvent` is false when a handler called preventDefault: the row keeps WebKit's menu away.
    return !target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 4 }));
  }, name);
  // The menu is labelled with its folder, or "Client folders" on the heading: waiting for that label is waiting for
  // this right-click's menu, never one still closing from the last.
  const label = name ?? "Client folders";
  await browser.waitUntil(() => browser.execute((l: string) => document.querySelector(`.sidebar-menu [role="menu"][aria-label="${l}"] [role="menuitem"]`) !== null, label), {
    timeout: 10000,
    interval: 250,
    timeoutMsg: `the menu for ${label} never opened`,
  });
  const items = (await browser.execute(() =>
    [...document.querySelectorAll('.sidebar-menu [role="menuitem"], .sidebar-menu [role="separator"]')].map((e) => (e.getAttribute("role") === "separator" ? "—" : (e.textContent ?? "").trim())),
  )) as string[];
  return { prevented, items };
}

/** Clicks a menu item and waits for the notice at the foot of the sidebar, in one script: it lasts six seconds. */
const chooseAndHear = (label: string) =>
  browser.execute(
    (wanted: string) =>
      new Promise<string | null>((resolve) => {
        const before = document.querySelector(".sidebar-notice")?.textContent ?? null;
        const item = [...document.querySelectorAll<HTMLButtonElement>('.sidebar-menu [role="menuitem"]')].find((b) => b.textContent?.trim() === wanted);
        if (!item) return resolve(`no item ${wanted}`);
        item.click();
        const started = Date.now();
        const look = () => {
          const now = document.querySelector(".sidebar-notice")?.textContent ?? null;
          if ((now !== null && now !== before) || Date.now() - started > 8000) resolve(now);
          else window.setTimeout(look, 50);
        };
        look();
      }),
    label,
  ) as Promise<string | null>;

/** Clicks a control in Settings → Client folders by its aria-label. */
const clickInFolders = (label: string) =>
  browser.execute((l: string) => {
    const el = document.querySelector<HTMLButtonElement>(`[data-section="folders"] [aria-label="${l}"]`);
    el?.click();
    return el !== null;
  }, label);

const settingsLists = () =>
  browser.execute(() => ({
    listed: [...document.querySelectorAll('[data-section="folders"] ul[aria-label="Client folders"] li[data-folder]')].map((li) => li.getAttribute("data-folder") ?? ""),
    removed: [...document.querySelectorAll('[data-section="folders"] ul[aria-label="Removed folders"] li[data-folder]')].map((li) => li.getAttribute("data-folder") ?? ""),
    note: document.querySelector('[data-section="folders"] .settings-message')?.textContent ?? null,
  })) as Promise<{ listed: string[]; removed: string[]; note: string | null }>;

describe("folder views (tasks/folder-views/prd.md)", () => {
  let colours: Record<string, string> = {};

  before(async () => {
    await waitForRows(shared.names.length, "at launch");
    colours = Object.fromEntries(await sidebar());
    expect(Object.keys(colours)).toEqual(shared.names);
  });

  it("a right-click on a folder offers Hide and Add at the rows' size, keeps WebKit's menu away, and Esc closes it", async () => {
    const menu = await rightClick("acme");
    expect(menu).toEqual({ prevented: true, items: ["Hide from sidebar", "Add a client folder…"] });
    // The items are the sidebar rows' size, and the first — focused so the menu takes the keys — shows by its ground,
    // not a ring. Both slipped when the menu joined the library: base.css's ui- rules outranked the item's own.
    const look = await browser.execute(() => {
      const item = getComputedStyle(document.querySelector(".sidebar-menu .ui-menu-item")!);
      const row = getComputedStyle(document.querySelector(".sidebar-folders .ui-nav")!);
      return { item: item.fontSize, row: row.fontSize, ring: item.outlineStyle };
    });
    expect(look).toEqual({ item: look.row, row: "13px", ring: "none" });
    await browser.keys(["Escape"]);
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".sidebar-menu") === null), { timeout: 10000, interval: 250, timeoutMsg: "Esc did not close the menu" });
    expect(await browser.execute(() => document.querySelector('section[data-page="home"]')?.hasAttribute("hidden"))).toBe(false);
  });

  it("Hide takes a folder off the sidebar and Home, repaints no other, and is kept by path", async () => {
    await rightClick("acme");
    expect(await chooseAndHear("Hide from sidebar")).toBe("Hid acme from the sidebar");
    await waitForRows(5, "after hiding acme");
    const after = await sidebar();
    expect(after.map(([n]) => n)).toEqual(shared.names.filter((n) => n !== "acme"));
    for (const [name, cat] of after) expect(`${name} ${cat}`).toBe(`${name} ${colours[name]}`);
    await browser.waitUntil(async () => (await overnight()).length === 5, { timeout: 10000, interval: 250, timeoutMsg: "Home still lists acme" });
    expect(await overnight()).not.toContain("acme");
    // By path, where the walk found it: the fixture keeps acme in clients/.
    expect(stored("folder_hidden")).toEqual([join(root, "clients/acme")]);
  });

  it("the heading's menu has no Hide, and Show brings a hidden folder back", async () => {
    const onHeading = await rightClick(null);
    expect(onHeading.items).toEqual(["Add a client folder…", "—", "Show acme"]);
    await browser.keys(["Escape"]);
    const onApp = await rightClick("app");
    expect(onApp.items).toEqual(["Hide from sidebar", "Add a client folder…", "—", "Show acme"]);
    expect(await chooseAndHear("Show acme")).toBe("acme is back in the sidebar");
    await waitForRows(6, "after showing acme");
    expect(Object.fromEntries(await sidebar())).toEqual(colours);
    expect(stored("folder_hidden")).toEqual([]);
  });

  it("Settings hides with its switch, removes into the Removed list, and Restore brings the folder back shown", async () => {
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.sidebar button[aria-label="Settings"]')!.click());
    await browser.waitUntil(async () => (await settingsLists()).listed.length === 6, { timeout: 10000, interval: 250, timeoutMsg: "Settings never listed the six folders" });

    expect(await clickInFolders("hub is in the sidebar")).toBe(true);
    await waitForRows(5, "after hub's switch went off");
    expect((await settingsLists()).listed).toHaveLength(6);

    expect(await clickInFolders("Remove hub from Kinas")).toBe(true);
    await browser.waitUntil(async () => (await settingsLists()).removed.length === 1, { timeout: 10000, interval: 250, timeoutMsg: "hub never reached the Removed list" });
    const removed = await settingsLists();
    expect(removed).toEqual({ listed: shared.names.filter((n) => n !== "hub"), removed: ["hub"], note: "Removed hub. Restore it below." });
    expect(stored("folder_removed")).toEqual([join(root, "hub")]);

    expect(await clickInFolders("Restore hub")).toBe(true);
    await waitForRows(6, "after restoring hub");
    await browser.waitUntil(async () => (await settingsLists()).removed.length === 0, { timeout: 10000, interval: 250, timeoutMsg: "hub stayed in the Removed list" });
    expect(
      await browser.execute(() => document.querySelector('[data-section="folders"] [aria-label="hub is in the sidebar"]')?.getAttribute("aria-checked")),
    ).toBe("true");
    expect({ hidden: stored("folder_hidden"), removed: stored("folder_removed") }).toEqual({ hidden: [], removed: [] });
    expect(Object.fromEntries(await sidebar())).toEqual(colours);
  });

  it("Add a client folder… takes a folder with no .git, lists it once, and says nothing on Cancel", async () => {
    writeFileSync(pickFile, "");
    await rightClick("app");
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>('.sidebar-menu [role="menuitem"]')].find((b) => b.textContent?.trim() === "Add a client folder…")!.click());
    // Cancel changes nothing: still six, and nothing stored.
    await browser.pause(1000);
    expect((await sidebar()).length).toBe(6);
    expect(stored("folder_added")).toEqual([]);

    writeFileSync(pickFile, join(root, "plain"));
    await rightClick("app");
    expect(await chooseAndHear("Add a client folder…")).toBe("Added plain");
    await waitForRows(7, "after adding plain");
    expect((await sidebar()).map(([n]) => n)).toContain("plain");
    expect(stored("folder_added")).toEqual([join(root, "plain")]);

    await rightClick("app");
    expect(await chooseAndHear("Add a client folder…")).toBe("plain is already in the sidebar");
    expect((await sidebar()).length).toBe(7);
  });

  it("refuses a folder outside the projects folder, the folder itself, and a path Rust never listed", async () => {
    writeFileSync(pickFile, dirname(root));
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>('[data-section="folders"] button')].find((b) => b.textContent?.trim() === "Add a folder…")!.click());
    await browser.waitUntil(async () => ((await settingsLists()).note ?? "").startsWith("Choose a folder inside the projects folder ("), {
      timeout: 10000,
      interval: 250,
      timeoutMsg: "the refusal never showed under Client folders",
    });

    writeFileSync(pickFile, root);
    expect((await invoke("add_client_folder")).refused).toBe("That is the projects folder itself — choose a folder inside it");
    expect((await invoke("set_folder_hidden", { path: join(dirname(root), "elsewhere"), hidden: true })).refused).toBe("Not a client folder");
    expect((await sidebar()).length).toBe(7);
    expect(stored("folder_added")).toEqual([join(root, "plain")]);
  });
});
