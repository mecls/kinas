import { browser, $, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { hook, typeLine, waitForShell, waitForTerminal } from "../helpers.ts";

const db = join(process.env.KINAS_DATA_DIR!, "kinas.sqlite");
const sql = (query: string) => execFileSync("/usr/bin/sqlite3", [db, query], { encoding: "utf8" }).trim();

/** What the palette shows: the box's text and each group's row keys. One round trip. */
const shown = () =>
  browser.execute(() => ({
    query: document.querySelector<HTMLInputElement>(".palette-input")?.value ?? null,
    focused: document.activeElement?.className ?? null,
    groups: [...document.querySelectorAll(".ui-palette-group")].map((g) => `${g.getAttribute("data-group")}: ${[...g.querySelectorAll(".ui-palette-row")].map((r) => r.getAttribute("data-key")).join(", ")}`),
  }));

/** Opens the palette, types `query`, and waits for the row keyed `key` (or a key it matches); a miss says what the
 * palette showed instead. */
async function find(query: string, key: string | RegExp) {
  await browser.keys(["Meta", "k"]);
  await expect($(".palette")).toBeDisplayed();
  // The e2e build's driver (tauri-plugin-wdio-webdriver 1.4.0) types a key action's characters by script and inserts
  // none for a space, " " or U+E00D alike ("ollama key" arrived "ollamakey"); its element send-keys appends the text.
  await $(".palette-input").addValue(query);
  let last: Awaited<ReturnType<typeof shown>> | null = null;
  await browser.waitUntil(
    async () => {
      last = await shown();
      return last.groups.some((g) => g.split(/[:,] /).some((k) => (typeof key === "string" ? k === key : key.test(k))));
    },
    { timeout: 20000, interval: 500, timeoutMsg: `"${query}" never listed ${key}` },
  ).catch((e: Error) => {
    throw new Error(`${e.message}; the palette showed ${JSON.stringify(last)}`);
  });
}

// AC-7's palette half and §3.7: ⌘K opens the palette, Status shows the same text as `kinas status`, Esc
// closes it, and from the terminal the next keystroke reaches the shell without a click (R31).

describe("the command palette", () => {
  it("opens with ⌘K and lists exactly the palette commands", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    // Right after launch the first chord can land before the window's listeners are attached; press until open.
    await browser.waitUntil(
      async () => {
        await browser.keys(["Meta", "k"]);
        return (await $(".palette").isExisting()) || (await browser.pause(500), await $(".palette").isExisting());
      },
      { timeout: 20000, interval: 1000, timeoutMsg: "⌘K never opened the palette" },
    );
    await expect($(".palette")).toBeDisplayed();
    // The interface polish (rule 15): a group shows its five best, then "N more", which opens it in place. Read in one
    // round trip each: every WebDriver command here can cost the harness seconds, and the case has 120 s.
    const commandRows = () =>
      browser.execute(() => ({
        more: document.querySelector('[data-more="command"]')?.textContent ?? null,
        ids: [...document.querySelectorAll('.ui-palette-row[data-kind="command"]')].map((row) => row.getAttribute("data-command")),
      }));
    expect(await commandRows()).toEqual({ more: "6 more", ids: ["status", "refresh", "files.refresh", "go.home", "go.usage"] });
    await $('[data-more="command"]').click();
    const { more, ids } = await commandRows();
    expect(more).toBeNull();
    // keymap.md, 2026-09-22: Home joined the palette; Crew, Inbox and Reader were click-only. 2026-09-23 (tree changes):
    // "Refresh files", the Files header's ↻ for the keyboard. 2026-09-24: Go to Crew and Go to the first mate (the first
    // mate); the Inbox joins with its slice.
    // 2026-09-25: Go to Inbox (the first mate, slice 5).
    expect(ids).toEqual(["status", "refresh", "files.refresh", "go.home", "go.usage", "go.work", "go.crew", "go.inbox", "go.firstmate", "sidebar", "settings"]);
  });

  it("Refresh files with no folder in Files says so and stays open", async () => {
    await $('[data-command="files.refresh"]').click();
    await expect($('[data-testid="palette-output"]')).toHaveText("No folder in Files to refresh");
    await expect($(".palette")).toBeDisplayed();
  });

  it("runs Status and shows the status lines", async () => {
    await $('[data-command="status"]').click();
    await expect($('[data-testid="palette-output"]')).toBeDisplayed();
    await expect($('[data-testid="palette-output"]')).toHaveText(expect.stringContaining("Claude             not connected"));
    await expect($('[data-testid="palette-output"]')).toHaveText(expect.stringContaining("This Mac"));
  });

  it("closes with Esc", async () => {
    await browser.keys(["Escape"]);
    await expect($(".palette")).not.toBeExisting();
  });

  it("from the terminal, Esc hands focus back so the shell gets the next line", async () => {
    await browser.keys(["Meta", "2"]);
    await waitForShell();
    await hook("focusTerminal");
    await browser.keys(["Meta", "k"]);
    await expect($(".palette")).toBeDisplayed();
    await browser.keys(["Escape"]);
    await expect($(".palette")).not.toBeExisting();
    await browser.waitUntil(async () => (await hook<boolean>("terminalFocused")) === true, { timeoutMsg: "focus did not return to the terminal" });
    await typeLine("echo BACK''_IN_SHELL");
    await waitForTerminal(/^BACK_IN_SHELL\s*$/m);
  });

  it("Go to Usage navigates and closes the palette", async () => {
    await browser.keys(["Meta", "k"]);
    await $('[data-command="go.usage"]').click();
    await expect($(".palette")).not.toBeExisting();
    await expect($('section[data-page="usage"]')).toBeDisplayed();
  });

  // The interface polish (tasks/interface-polish), slice 1, AC-1's first half: a file found by name opens in the reader
  // from the keyboard alone, and the terminal's process is the one it was.
  it("finds a file by name and Enter opens it in the reader", async () => {
    const pid = await hook<number>("ptyPid");
    await browser.keys(["Meta", "k"]);
    await expect($(".palette")).toBeDisplayed();
    await browser.keys([..."readme"]);
    const row = $('.ui-palette-row[data-file$="/README.md"]');
    await row.waitForDisplayed({ timeout: 10000, timeoutMsg: "the Files group never listed README.md" });
    // No command is called "readme", so the file is the first row and Enter acts on it.
    await expect(row).toHaveAttribute("aria-selected", "true");
    await browser.keys(["Enter"]);
    await expect($(".palette")).not.toBeExisting();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelector('aside.reader .ui-tab[aria-selected="true"] .ui-tab-name')?.textContent ?? null)) === "README.md",
      { timeout: 10000, timeoutMsg: "the reader never showed README.md" },
    );
    if (process.env.KINAS_E2E_SHOTS) await browser.saveScreenshot(`${process.env.KINAS_E2E_SHOTS}/palette-opened-a-file.png`);
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  // Slice 2, rule 15: the index folds accents, so a name the Mac stored decomposed is found typed plainly, with its
  // path under the projects folder beside it and its matched letters marked.
  it("finds a name whatever its accents, and shows where it lies", async () => {
    await browser.keys(["Meta", "k"]);
    await expect($(".palette")).toBeDisplayed();
    await browser.keys([..."reuniao"]);
    const row = $('.ui-palette-row[data-kind="file"]');
    await row.waitForDisplayed({ timeout: 10000, timeoutMsg: "the Files group never listed the meeting notes" });
    const seen = await browser.execute(() => {
      const r = document.querySelector('.ui-palette-row[data-kind="file"]');
      return {
        label: document.querySelector('[data-group="file"] .ui-palette-label')?.textContent,
        name: r?.querySelector(".ui-palette-name")?.textContent?.normalize("NFC"),
        marked: r?.querySelector(".ui-palette-name b")?.textContent?.normalize("NFC"),
        detail: r?.querySelector(".ui-palette-detail")?.textContent?.normalize("NFC"),
        foot: document.querySelector(".ui-palette-foot")?.textContent,
      };
    });
    expect(seen).toEqual({ label: "Files", name: "Reunião de março.md", marked: "Reunião", detail: "atas/Reunião de março.md", foot: "↵ OpenEsc Close↑↓ Move" });
    if (process.env.KINAS_E2E_SHOTS) await browser.saveScreenshot(`${process.env.KINAS_E2E_SHOTS}/palette-accents.png`);
    await browser.keys(["Escape"]);
    await expect($(".palette")).not.toBeExisting();
  });

  // Slice 3, Journey D and rule 16: a setting found by words from its section and its label opens Settings scrolled to
  // it, its control holding the keys.
  it("a setting opens Settings at its row, its control focused", async () => {
    await find("ollama key", "setting:ollama.key");
    const row = await browser.execute(() => {
      const r = document.querySelector('.ui-palette-row[data-key="setting:ollama.key"]');
      return { name: r?.querySelector(".ui-palette-name")?.textContent, detail: r?.querySelector(".ui-palette-detail")?.textContent, selected: r?.getAttribute("aria-selected") };
    });
    expect(row).toEqual({ name: "API key", detail: "Ollama Cloud", selected: "true" });
    await browser.keys(["Enter"]);
    await expect($(".palette")).not.toBeExisting();
    await expect($('section[data-page="settings"]')).toBeDisplayed();
    await browser.waitUntil(async () => (await browser.execute(() => document.activeElement?.getAttribute("aria-label") ?? null)) === "Ollama Cloud API key", {
      timeout: 15000,
      timeoutMsg: "the Ollama key's field never took the focus",
    });
    if (process.env.KINAS_E2E_SHOTS) await browser.saveScreenshot(`${process.env.KINAS_E2E_SHOTS}/palette-setting.png`);
  });

  // Slice 3, rule 16: a task the board shows is found by its title and opens its detail in the right panel. The task is
  // written into the crew's mirror as the collector would, and the window's focus has the crew read again.
  it("a task opens its detail in the right panel", async () => {
    sql(
      "INSERT INTO crew_tasks (org_id, id, title, kind, state, snapshot_generated, first_seen_at, last_seen_at) " +
        "SELECT id, 'ledger-9c2e', 'Ledger reconcile 9c2e', 'ship', 'working', '2026-11-16T00:00:00Z', 0, 0 FROM orgs LIMIT 1",
    );
    await browser.execute(() => window.dispatchEvent(new Event("focus")));
    await find("ledger", "task:ledger-9c2e");
    await browser.keys(["Enter"]);
    await expect($(".palette")).not.toBeExisting();
    await browser.waitUntil(
      () => browser.execute(() => document.querySelector('aside.shell-panel[data-occupant="task"]:not([hidden]) .crew-detail[data-task="ledger-9c2e"]') !== null),
      { timeout: 15000, interval: 250, timeoutMsg: "the task's detail never opened in the panel" },
    );
    if (process.env.KINAS_E2E_SHOTS) await browser.saveScreenshot(`${process.env.KINAS_E2E_SHOTS}/palette-task.png`);
  });

  // Slice 4, Journey B and rule 18: this spec's pane is a plain shell, so no Herdr is attached. Workspaces says why in one
  // line, and every other group answers as before.
  it("with no Herdr, Workspaces says why in one line and the rest still answer", async () => {
    await find("readme", /^file:.*\/README\.md$/);
    const seen = await browser.execute(() => {
      const ws = document.querySelector('[data-group="workspace"]');
      return {
        state: ws?.getAttribute("data-state") ?? null,
        note: ws?.querySelector(".ui-palette-note")?.textContent ?? null,
        rows: ws?.querySelectorAll(".ui-palette-row").length ?? null,
        files: document.querySelectorAll('[data-group="file"] .ui-palette-row').length,
        order: [...document.querySelectorAll(".ui-palette-group")].map((g) => g.getAttribute("data-group")).filter((g) => g === "file" || g === "workspace"),
      };
    });
    expect(seen).toEqual({ state: "failed", note: "Herdr is not running, so no workspace can be searched.", rows: 0, files: 1, order: ["file", "workspace"] });
    if (process.env.KINAS_E2E_SHOTS) await browser.saveScreenshot(`${process.env.KINAS_E2E_SHOTS}/palette-no-herdr.png`);
    await browser.keys(["Escape"]);
    await expect($(".palette")).not.toBeExisting();
  });

  // Slice 4, rule 14: before anything is typed, Recent lists what was opened, newest first — here the task, the setting
  // and README.md this spec opened — then Commands.
  it("an empty box shows Recent, newest first, then Commands", async () => {
    await browser.keys(["Meta", "k"]);
    await expect($(".palette")).toBeDisplayed();
    await browser.waitUntil(async () => (await shown()).groups.some((g) => g.startsWith("recent: ")), { timeout: 15000, timeoutMsg: "Recent never showed" });
    const seen = await shown();
    const recent = seen.groups.find((g) => g.startsWith("recent: "))!.slice("recent: ".length).split(", ");
    expect(recent.slice(0, 2)).toEqual(["recent:task:ledger-9c2e", "recent:setting:ollama.key"]);
    expect(recent.some((k) => /^recent:file:.*\/README\.md$/.test(k))).toBe(true);
    expect(seen.groups.map((g) => g.split(":")[0])).toEqual(["recent", "command"]);
    if (process.env.KINAS_E2E_SHOTS) await browser.saveScreenshot(`${process.env.KINAS_E2E_SHOTS}/palette-recent.png`);
    await browser.keys(["Escape"]);
  });
});
