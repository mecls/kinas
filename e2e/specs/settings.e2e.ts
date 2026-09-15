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

describe("nothing connected, then a key", () => {
  it("shows Connect Claude Code and Add API key, and makes no request", async () => {
    await $('.gauge-empty[data-subscription="claude-plan"]').waitForExist({ timeout: 60000 });
    await expect($('.gauge-empty[data-subscription="claude-plan"] .button')).toHaveText("Connect Claude Code");
    await expect($('.gauge-empty[data-subscription="ollama-cloud"] .button')).toHaveText("Add API key");
    await browser.pause(3000);
    expect(await stubRequests()).toBe(0);
  });

  it("opens Settings from Add API key, with the Claude hook lines and status", async () => {
    await $('.gauge-empty[data-subscription="ollama-cloud"] .button').click();
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
    await $('.gauge[data-subscription="ollama-cloud"][data-window="session"]').waitForExist({ timeout: 60000 });
    await expect($('.gauge[data-subscription="ollama-cloud"][data-window="session"]')).toHaveText(expect.stringContaining("2.5% used"));
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
  it("the gear at the foot of the sidebar opens Settings", async () => {
    await browser.keys(["Escape"]);
    await expect($('section[data-page="usage"]')).toBeDisplayed();
    await $('.rail button[aria-label="Settings"]').click();
    await expect($('section[data-page="settings"]')).toBeDisplayed();
    await expect($('.rail button[aria-label="Settings"]')).toHaveAttribute("aria-current", "page");
  });

  it("refuses another action's chord and says whose it is", async () => {
    await $('[data-shortcut="sidebar"] .button').click();
    await expect($('[data-shortcut="sidebar"] .shortcut-chord')).toHaveText("Press a chord…");
    await browser.keys(["Meta", "1"]);
    await expect($('[data-section="shortcuts"] .settings-message')).toHaveText("⌘1 is already the shortcut for Go to Usage");
    await expect($('[data-shortcut="sidebar"] .shortcut-chord')).toHaveText("⌘S");
    // Recording ran nothing: still on Settings.
    await expect($('section[data-page="settings"]')).toBeDisplayed();
  });

  it("rebinds Hide or show the sidebar to ⌘B, and ⌘S no longer toggles it", async () => {
    await $('[data-shortcut="sidebar"] .button').click();
    await browser.keys(["Meta", "b"]);
    await expect($('[data-shortcut="sidebar"] .shortcut-chord')).toHaveText("⌘B");
    await browser.keys(["Meta", "b"]);
    await expect($(".rail")).not.toBeDisplayed();
    await browser.keys(["Meta", "s"]);
    await browser.pause(500);
    expect(await $(".rail").isDisplayed()).toBe(false);
    await browser.keys(["Meta", "b"]);
    await expect($(".rail")).toBeDisplayed();
  });
});
