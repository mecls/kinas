import { browser, $, expect } from "@wdio/globals";
import { hook, typeLine, waitForShell, waitForTerminal } from "../helpers.ts";

// AC-7's palette half and §3.7: ⌘K opens the palette, Status shows the same text as `kinas status`, Esc
// closes it, and from the terminal the next keystroke reaches the shell without a click (R31).

describe("the command palette", () => {
  it("opens with ⌘K and lists exactly the palette commands", async () => {
    await $('section[data-page="usage"]').waitForDisplayed({ timeout: 60000 });
    await browser.keys(["Meta", "k"]);
    await expect($(".palette")).toBeDisplayed();
    const ids = await $$(".palette-item").map((item) => item.getAttribute("data-command"));
    expect(ids).toEqual(["status", "refresh", "go.usage", "go.work", "settings"]);
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
