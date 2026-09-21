import { browser, $, expect } from "@wdio/globals";
import { hook, waitForHook } from "../helpers.ts";

// Settings → Appearance. The app keeps one stylesheet with two grounds, and which one draws is the WINDOW's
// appearance: Rust sets it, and the page follows through `prefers-color-scheme` with no message and no attribute.
// That last link is WebKit's, not ours, so this spec is what proves it: choosing Light must turn the media query
// and the computed tokens, and choosing Dark must turn them back. WebDriver cannot change macOS's own appearance, so
// "Follow macOS" is only checked for being stored and for drawing one of the two grounds.

const DARK = "#0b0d10";
const LIGHT = "#f4f2ec";

/** Sets a React-controlled select (the embedded driver's own select handling does not reach React's onChange). */
async function choose(value: string) {
  const found = await browser.execute((val: string) => {
    const select = document.querySelector('select[aria-label="Appearance"]');
    if (!(select instanceof HTMLSelectElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, val);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);
  if (!found) throw new Error("no Appearance select");
}

const ground = () => browser.execute(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim());
const prefersLight = () => browser.execute(() => matchMedia("(prefers-color-scheme: light)").matches);
/** A command's answer, or its refusal. Not `{ error }`: that is the shape of a WebDriver error, and the client throws it. */
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
const stored = async () => (await invoke<{ appearance: string }>("get_settings")).ok?.appearance;

async function waitForGround(expected: string) {
  await browser.waitUntil(async () => (await ground()) === expected, { timeout: 10000, timeoutMsg: `--ground never became ${expected}` });
}

describe("Settings → Appearance", () => {
  before(async () => {
    await $(".sidebar").waitForExist({ timeout: 60000 });
    await browser.keys(["Meta", ","]);
    await expect($('section[data-page="settings"]')).toBeDisplayed();
    await $('select[aria-label="Appearance"]').waitForExist({ timeout: 10000 });
  });

  it("follows macOS until told otherwise, and draws one of the two grounds", async () => {
    expect(await stored()).toBe("system");
    await expect($('select[aria-label="Appearance"]')).toHaveValue("system");
    expect([DARK, LIGHT]).toContain(await ground());
  });

  it("Light turns the page to warm white through the window, not through the page", async () => {
    await choose("light");
    await waitForGround(LIGHT);
    expect(await prefersLight()).toBe(true);
    expect(await stored()).toBe("light");
    // The page was told nothing: no attribute carries the choice.
    expect(await browser.execute(() => document.documentElement.getAttributeNames().join(","))).not.toContain("theme");
    expect(await browser.execute(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
  });

  it("the terminal, which is never remounted, takes the new ground on the one that is running", async () => {
    await waitForHook("terminalBackground");
    await browser.waitUntil(async () => (await hook<string | null>("terminalBackground")) === LIGHT, { timeout: 10000, timeoutMsg: "the pane kept its dark theme" });
  });

  it("Dark turns it back, pane included", async () => {
    await choose("dark");
    await waitForGround(DARK);
    expect(await prefersLight()).toBe(false);
    expect(await stored()).toBe("dark");
    await browser.waitUntil(async () => (await hook<string | null>("terminalBackground")) === DARK, { timeout: 10000, timeoutMsg: "the pane kept its light theme" });
  });

  it("refuses anything but the three choices, and keeps what was stored", async () => {
    const result = await invoke("set_appearance", { value: "sepia" });
    expect(result.refused).toContain("unknown appearance sepia");
    expect(await stored()).toBe("dark");
    expect(await ground()).toBe(DARK);
  });

  it("goes back to following macOS", async () => {
    await choose("system");
    await browser.waitUntil(async () => (await stored()) === "system", { timeout: 10000 });
    expect([DARK, LIGHT]).toContain(await ground());
  });
});
