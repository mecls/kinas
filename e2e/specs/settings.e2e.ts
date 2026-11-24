import { browser, $, $$, expect } from "@wdio/globals";

// AC-3 (Journey B): with nothing connected the gauges say so and no request is made; saving a key in Settings
// makes exactly one request and the Ollama gauges appear. Settings also shows the Claude hook lines. Settings is a
// page: the gear at the foot of the sidebar and ⌘, open it, Esc goes back, and its shortcuts can be rebound.

const stub = process.env.KINAS_E2E_STUB_URL!;
const stubRequests = async () => ((await (await fetch(`${stub}/__count`)).json()) as { requests: number }).requests;

/** Sets a React-controlled input's value (WebDriver typing doubles characters in the embedded driver). */
async function fill(selector: string, value: string) {
  const found = await browser.execute(
    (sel: string, val: string) => {
      const input = document.querySelector(sel);
      if (!(input instanceof HTMLInputElement)) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    selector,
    value,
  );
  if (!found) throw new Error(`no <input> matches ${selector}`);
}

/** Home is the first screen (keymap.md, 2026-09-22); the gauges live on Usage, ⌘4 away. The first chord after launch
 * can land before the window's listeners are attached, so it is pressed until the page shows. */
async function goToUsage() {
  await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
  await browser.waitUntil(
    async () => {
      await browser.keys(["Meta", "4"]);
      return $('section[data-page="usage"]').isDisplayed();
    },
    { timeout: 30000, timeoutMsg: "⌘4 never showed the Usage page" },
  );
}

describe("nothing connected, then a key", () => {
  before(goToUsage);

  it("shows Connect Claude Code and Add API key, and makes no request", async () => {
    await $('.usage-empty[data-subscription="claude-plan"]').waitForExist({ timeout: 60000 });
    await expect($('.usage-empty[data-subscription="claude-plan"] .ui-button')).toHaveText("Connect Claude Code");
    await expect($('.usage-empty[data-subscription="ollama-cloud"] .ui-button')).toHaveText("Add API key");
    await browser.pause(3000);
    expect(await stubRequests()).toBe(0);
  });

  it("opens Settings from Add API key, with the Claude hook lines and status", async () => {
    await $('.usage-empty[data-subscription="ollama-cloud"] .ui-button').click();
    await expect($('section[data-page="settings"]')).toBeDisplayed();
    await expect($('[data-testid="hook-status"]')).toHaveText(expect.stringContaining("never seen"));
    // The embedded WebKit driver rejects text selectors mixed with CSS, so read the lines instead.
    const lines = await $$(".hook-line code").map((code) => code.getText());
    expect(lines).toHaveLength(3);
    expect(lines.join("\n")).toContain("claude-rate-limits.json");
    expect(lines.join("\n")).not.toContain("refreshInterval");
    await expect($('[data-testid="cli-link"]')).toHaveText(expect.stringContaining("not linked"));
  });

  it("saves the key, polls once, and the Ollama gauges appear", async () => {
    await fill('input[aria-label="Ollama Cloud API key"]', "ollama-FAKE-typed-key");
    await $("button=Save").click();
    await expect($('[data-section="ollama"] .settings-message')).toHaveText("Saved");
    // Esc goes back to the page Settings was opened from.
    await browser.keys(["Escape"]);
    await expect($('section[data-page="usage"]')).toBeDisplayed();
    await $('section[data-page="usage"] [data-subscription="ollama-cloud"][data-window="session"]').waitForExist({ timeout: 60000 });
    await expect($('section[data-page="usage"] [data-subscription="ollama-cloud"][data-window="session"]')).toHaveText(expect.stringContaining("2.5% used"));
    expect(await stubRequests()).toBe(1);
  });

  it("⌘, reopens Settings, and the key shows as saved without revealing it", async () => {
    await browser.keys(["Meta", ","]);
    await expect($('section[data-page="settings"]')).toBeDisplayed();
    await expect($('input[aria-label="Ollama Cloud API key"]')).toHaveAttribute("placeholder", "A key is saved");
    await expect($('input[aria-label="Ollama Cloud API key"]')).toHaveValue("");
  });
});

describe("Settings from the sidebar, and its shortcuts", () => {
  it("the Settings row in the sidebar opens Settings", async () => {
    await browser.keys(["Escape"]);
    await expect($('section[data-page="usage"]')).toBeDisplayed();
    await $('.sidebar button[aria-label="Settings"]').click();
    await expect($('section[data-page="settings"]')).toBeDisplayed();
    await expect($('.sidebar button[aria-label="Settings"]')).toHaveAttribute("aria-current", "page");
  });

  it("refuses another action's chord and says whose it is", async () => {
    await $('[data-shortcut="sidebar"] .button').click();
    await expect($('[data-shortcut="sidebar"] .shortcut-chord')).toHaveText("Press a chord…");
    await browser.keys(["Meta", "1"]);
    await expect($('[data-section="shortcuts"] .settings-message')).toHaveText("⌘1 is already the shortcut for Go to Home");
    await expect($('[data-shortcut="sidebar"] .shortcut-chord')).toHaveText("⌘S");
    // Recording ran nothing: still on Settings.
    await expect($('section[data-page="settings"]')).toBeDisplayed();
  });

  it("rebinds Hide or show the sidebar to ⌘B, and ⌘S no longer toggles it", async () => {
    await $('[data-shortcut="sidebar"] .button').click();
    await browser.keys(["Meta", "b"]);
    await expect($('[data-shortcut="sidebar"] .shortcut-chord')).toHaveText("⌘B");
    await browser.keys(["Meta", "b"]);
    await expect($(".sidebar")).not.toBeDisplayed();
    await browser.keys(["Meta", "s"]);
    await browser.pause(500);
    expect(await $(".sidebar").isDisplayed()).toBe(false);
    await browser.keys(["Meta", "b"]);
    await expect($(".sidebar")).toBeDisplayed();
  });

  it("R1b: refuses a projects folder that does not exist, and stores one that does", async () => {
    const field = 'input[aria-label="Projects folder"]';
    const blur = () =>
      browser.execute((sel: string) => {
        const input = document.querySelector<HTMLInputElement>(sel)!;
        input.focus();
        input.blur();
      }, field);
    const stored = () =>
      browser.execute(() =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<{ projects_root: string }> } }).__TAURI_INTERNALS__.invoke("get_settings").then((s) => s.projects_root),
      );
    const before = await stored();

    await fill(field, "/nowhere/at/all");
    await blur();
    await expect($('[data-section="projects"] .settings-message')).toHaveText(expect.stringContaining("does not exist"));
    expect(await stored()).toBe(before);

    await fill(field, "/private/tmp");
    await blur();
    await browser.waitUntil(async () => (await stored()) === "/private/tmp", { timeout: 10000, timeoutMsg: "the projects folder was not stored" });
    // Put it back, so the rest of the run sees the folder it started with.
    await fill(field, before);
    await blur();
    await browser.waitUntil(async () => (await stored()) === before, { timeout: 10000, timeoutMsg: "the projects folder was not restored" });
  });

  it("refuses a blank editor for Open in editor, and stores a real one", async () => {
    const field = 'input[aria-label="Editor for Open in editor"]';
    const blur = () =>
      browser.execute((sel: string) => {
        const input = document.querySelector<HTMLInputElement>(sel)!;
        input.focus();
        input.blur();
      }, field);
    const stored = () =>
      browser.execute(() =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<{ reader_editor: string }> } }).__TAURI_INTERNALS__.invoke("get_settings").then((s) => s.reader_editor),
      );

    await expect($(field)).toHaveValue("vim");
    await fill(field, "   ");
    await blur();
    await expect($('[data-section="reader"] .settings-message')).toHaveText("the editor command is empty");
    expect(await stored()).toBe("vim");

    await fill(field, "nvim -R");
    await blur();
    await browser.waitUntil(async () => (await stored()) === "nvim -R", { timeout: 10000, timeoutMsg: "the editor was not stored" });
  });

  // Convex (prd-convex-usage.md §3 Configure, R2, R3).
  it("saves a Convex deploy key without ever reading it back, and refuses a deployment URL with a path", async () => {
    const keyField = 'input[aria-label="Convex deploy key"]';
    const urlField = 'input[aria-label="Convex deployment URL"]';
    const settings = () =>
      browser.execute(() =>
        (
          window as unknown as {
            __TAURI_INTERNALS__: { invoke: (c: string) => Promise<{ convex_key_saved: boolean; convex_deployment_url: string; convex_plan: string }> };
          }
        ).__TAURI_INTERNALS__.invoke("get_settings"),
      );
    const blurUrl = () =>
      browser.execute((sel: string) => {
        const input = document.querySelector<HTMLInputElement>(sel)!;
        input.focus();
        input.blur();
      }, urlField);

    // R2: the field says whether a key is saved; it never holds one.
    await expect($(keyField)).toHaveAttribute("placeholder", "No key saved");
    await fill(keyField, "convex-FAKE-typed-deploy-key");
    // By label, not by text: there are two "Save" buttons on this page and `button=Save` matches Ollama's.
    await $('button[aria-label="Save Convex deploy key"]').click();
    await expect($('[data-section="convex"] .settings-message')).toHaveText("Saved");
    await browser.waitUntil(async () => (await settings()).convex_key_saved, { timeout: 10000, timeoutMsg: "the deploy key was not saved" });
    await expect($(keyField)).toHaveAttribute("placeholder", "A key is saved");
    // Cleared on submit, and `get_settings` answers with a boolean — the key itself has no way back out.
    await expect($(keyField)).toHaveValue("");

    // R3: a URL carrying a path is refused. The reader appends `/api/v1/get_current_usage`, so storing one
    // would make every request 404 for ever with nothing on screen to say why.
    const before = (await settings()).convex_deployment_url;
    await fill(urlField, "https://happy-otter-123.convex.cloud/api/v1");
    await blurUrl();
    await expect($('[data-section="convex"] .settings-message')).toHaveText(expect.stringContaining("no path"));
    expect((await settings()).convex_deployment_url).toBe(before);

    await fill(urlField, "http://happy-otter-123.convex.cloud");
    await blurUrl();
    await expect($('[data-section="convex"] .settings-message')).toHaveText(expect.stringContaining("https://"));
    expect((await settings()).convex_deployment_url).toBe(before);

    // The plan only chooses which allowances the gauges divide by (R6).
    await expect($('select[aria-label="Convex plan"]')).toHaveValue("starter");
  });
});

// The interface polish, slice 9 (rules 32–35): the section list beside the rows, Settings' own search, and the rows.
// Reads are one script each: every WebDriver command here costs seconds (usage.e2e.ts).
describe("Settings' section list and search", () => {
  const page = () =>
    browser.execute(() => {
      const root = document.querySelector('section[data-page="settings"]')!;
      const shownBlocks = [...root.querySelectorAll(".settings-block:not([hidden])")].map((b) => b.getAttribute("data-block"));
      const shownRows = [...root.querySelectorAll(".ui-setting-row:not([hidden])")].filter((r) => !r.closest("[hidden]")).map((r) => r.getAttribute("data-setting"));
      return {
        current: root.querySelector('.settings-nav-item[aria-current="true"]')?.getAttribute("data-nav") ?? null,
        dimmed: [...root.querySelectorAll(".settings-nav-item[data-dim]")].length,
        shownBlocks,
        shownRows,
        empty: root.querySelector('[data-testid="settings-no-match"]')?.textContent ?? null,
      };
    });

  /** Sets the search box as typing would (the driver's key actions drop spaces; React reads the input event). */
  const search = (q: string) =>
    browser.execute((value: string) => {
      const input = document.querySelector<HTMLInputElement>('section[data-page="settings"] input[aria-label="Search settings"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, q);

  it("lists every section in its group, and a click scrolls the page to it and marks it", async () => {
    await browser.keys(["Meta", ","]);
    await $('section[data-page="settings"] .settings-nav').waitForDisplayed({ timeout: 15000 });
    const nav = await browser.execute(() =>
      [...document.querySelectorAll('section[data-page="settings"] .settings-nav-group')].map((g) => `${g.querySelector(".settings-nav-label")?.textContent}: ${[...g.querySelectorAll(".settings-nav-item")].map((i) => i.textContent).join(", ")}`),
    );
    expect(nav).toEqual([
      "Providers: Claude Code, Ollama Cloud, Convex, Hostinger VPS",
      // DESIGN.md 1.14 (the factory in the cloud): Where agents run is the Crew group's first section.
      "Crew: Where agents run, Firstmate",
      "Workspace: Projects folder, Client folders, Organisation",
      "Interface: Appearance, Keyboard shortcuts, Global hotkey, Menu bar, Reader",
      "System: Launch at login, kinas CLI",
    ]);
    await browser.execute(() => (document.querySelector('section[data-page="settings"] [data-nav="reader"]') as HTMLElement).click());
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const page = document.querySelector<HTMLElement>('section[data-page="settings"]')!;
          const block = page.querySelector<HTMLElement>('[data-block="reader"]')!;
          const top = block.getBoundingClientRect().top - page.getBoundingClientRect().top;
          return top >= -2 && top < page.clientHeight / 2;
        }),
      { timeout: 10000, timeoutMsg: "the Reader section never came to the top" },
    );
    expect((await page()).current).toBe("reader");
  });

  it("a search keeps the rows whose label or description matches, and their sections; none says so", async () => {
    await search("deploy");
    await browser.waitUntil(async () => (await page()).shownBlocks.length === 1, { timeout: 10000, timeoutMsg: "the search never narrowed the page" });
    const one = await page();
    expect({ blocks: one.shownBlocks, rows: one.shownRows }).toEqual({ blocks: ["convex"], rows: ["convex.key", "convex.url"] });
    expect(one.dimmed).toBe(15);
    if (process.env.KINAS_E2E_SHOTS) await browser.saveScreenshot(`${process.env.KINAS_E2E_SHOTS}/settings-search.png`);
    await search("zzz");
    await browser.waitUntil(async () => (await page()).empty !== null, { timeout: 10000, timeoutMsg: "no match was never said" });
    expect((await page()).empty).toBe("No setting matches “zzz”.");
    await search("");
    await browser.waitUntil(async () => (await page()).shownBlocks.length === 16, { timeout: 10000, timeoutMsg: "clearing the search never brought every section back" });
    expect((await page()).dimmed).toBe(0);
  });

  it("every setting is a row with its label and one line, and the shell lines stay open while nothing is received", async () => {
    const rows = await browser.execute(() =>
      [...document.querySelectorAll('section[data-page="settings"] .ui-setting-row')].map((r) => ({
        id: r.getAttribute("data-setting"),
        label: r.querySelector(".ui-setting-label")?.textContent ?? "",
        desc: r.querySelector(".ui-setting-desc")?.textContent ?? "",
      })),
    );
    // Where agents run's four rows (place.where, place.target, place.label, place.reachable) among them.
    expect(rows).toHaveLength(31);
    expect(rows.every((r) => r.label !== "" && r.desc !== "")).toBe(true);
    // Rule 35: the connection is never seen here, so the three lines are open, not folded.
    const lines = await browser.execute(() => ({
      lines: document.querySelectorAll('[data-setting="claude.lines"] .hook-line').length,
      fold: [...document.querySelectorAll('[data-setting="claude.lines"] button')].some((b) => b.textContent === "Show the lines"),
    }));
    expect(lines).toEqual({ lines: 3, fold: false });
  });
});
