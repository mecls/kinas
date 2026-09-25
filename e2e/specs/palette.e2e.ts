import { browser, $, expect } from "@wdio/globals";
import { hook, typeLine, waitForShell, waitForTerminal } from "../helpers.ts";

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
    const ids = await $$(".palette-item").map((item) => item.getAttribute("data-command"));
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
});
