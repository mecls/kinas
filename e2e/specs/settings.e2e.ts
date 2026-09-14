import { browser, $, expect } from "@wdio/globals";

// AC-3 (Journey B): with nothing connected the gauges say so and no request is made; saving a key in Settings
// makes exactly one request and the Ollama gauges appear. Settings also shows the Claude hook lines.

const stub = process.env.KINAS_E2E_STUB_URL!;
const stubRequests = async () => ((await (await fetch(`${stub}/__count`)).json()) as { requests: number }).requests;

/** Sets a React-controlled input's value (WebDriver typing doubles characters in the embedded driver). */
async function fill(selector: string, value: string) {
  await browser.execute(
    (sel: string, val: string) => {
      const input = document.querySelector(sel) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
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
    await expect($(".sheet")).toBeDisplayed();
    await expect($('[data-testid="hook-status"]')).toHaveText(expect.stringContaining("never seen"));
    await expect($(".hook-line code*=claude-rate-limits.json")).toBeExisting();
    await expect($('[data-testid="cli-link"]')).toHaveText(expect.stringContaining("not linked"));
  });

  it("saves the key, polls once, and the Ollama gauges appear", async () => {
    await fill('input[aria-label="Ollama Cloud API key"]', "ollama-FAKE-typed-key");
    await $("button=Save").click();
    await expect($(".sheet-message")).toHaveText("Saved");
    await browser.keys(["Escape"]);
    await $('.gauge[data-subscription="ollama-cloud"][data-window="session"]').waitForExist({ timeout: 60000 });
    await expect($('.gauge[data-subscription="ollama-cloud"][data-window="session"]')).toHaveText(expect.stringContaining("97% left"));
    expect(await stubRequests()).toBe(1);
  });

  it("⌘, reopens Settings, and the key shows as saved without revealing it", async () => {
    await browser.keys(["Meta", ","]);
    await expect($(".sheet")).toBeDisplayed();
    await expect($('input[aria-label="Ollama Cloud API key"]')).toHaveAttribute("placeholder", "A key is saved");
    await expect($('input[aria-label="Ollama Cloud API key"]')).toHaveValue("");
  });
});
