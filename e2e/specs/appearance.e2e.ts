import { browser, $, expect } from "@wdio/globals";
import { hexToRgb, okmix } from "../../app/src/styles/color.ts";
import { toHex } from "../../app/src/theme.ts";
import { hook, waitForHook } from "../helpers.ts";

// Settings → Appearance. The app keeps one stylesheet with two grounds, and which one draws is the WINDOW's
// appearance: Rust sets it, and the page follows through `prefers-color-scheme` with no message and no attribute.
// That last link is WebKit's, not ours, so this spec is what proves it: choosing Light must turn the media query
// and the computed tokens, and choosing Dark must turn them back. WebDriver cannot change macOS's own appearance, so
// "Follow macOS" is only checked for being stored and for drawing one of the two grounds.
//
// Since the design system (2026-09-22) the tokens are DESIGN.md's: --bg is the ground, --term-bg the pane's, and the
// accent is a second choice on the same page — stored by Rust, painted by the page as one property on the root, and
// derived by the dark theme through a color-mix the tests compute the same way. Neither choice touches the PTY.

const DARK = "#14171e";
const LIGHT = "#f4f2ec";
const PANE_DARK = "#10192b";
const PANE_LIGHT = "#f4f2ec";

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

const ground = () => browser.execute(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
/** A token as painted — a probe's computed colour. WebKit reports a color-mix(in oklab) as `oklab(L a b)`, which
 * the page's own `toHex` (theme.ts) converts; here the raw string comes back and the spec converts it the same way. */
const paintedRaw = (name: string) =>
  browser.execute((n: string) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `var(${n})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, name);
const painted = async (name: string) => toHex(await paintedRaw(name));
const viewportBackground = () => browser.execute(() => getComputedStyle(document.querySelector(".xterm-viewport")!).backgroundColor);
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
const storedAccent = async () => (await invoke<{ accent: string | null }>("get_settings")).ok?.accent;

async function waitForGround(expected: string) {
  await browser.waitUntil(async () => (await ground()) === expected, { timeout: 10000, timeoutMsg: `--bg never became ${expected}` });
}

/** Clicks a swatch of the Accent field, or types a colour into its input (a React-controlled control, like the select). */
async function pickAccent(hex: string) {
  const found = await browser.execute((val: string) => {
    const input = document.querySelector('input[aria-label="Accent"]');
    if (!(input instanceof HTMLInputElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, val);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, hex);
  if (!found) throw new Error("no Accent input");
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
    await browser.waitUntil(async () => (await hook<string | null>("terminalBackground")) === PANE_LIGHT, { timeout: 10000, timeoutMsg: "the pane kept its dark theme" });
    // xterm.css paints the viewport #000, which shows below the last whole row: on warm white, a black bar.
    expect(await viewportBackground()).toBe("rgb(244, 242, 236)");
  });

  it("Dark turns it back, pane included", async () => {
    await choose("dark");
    await waitForGround(DARK);
    expect(await prefersLight()).toBe(false);
    expect(await stored()).toBe("dark");
    await browser.waitUntil(async () => (await hook<string | null>("terminalBackground")) === PANE_DARK, { timeout: 10000, timeoutMsg: "the pane kept its light theme" });
    expect(await viewportBackground()).toBe("rgb(16, 25, 43)");
  });

  it("an accent chosen in Settings is painted at once, stored, derived for the dark theme, and the PTY never notices", async () => {
    const pid = await hook<number>("ptyPid");
    expect(await storedAccent()).toBeNull();
    expect(await painted("--accent")).not.toBe("#5b3fb8");
    await $('button[aria-label="Accent Violet"]').click();
    await browser.waitUntil(async () => (await storedAccent()) === "#5b3fb8", { timeout: 10000, timeoutMsg: "the accent was not stored" });
    // Dark is showing: the accent is the brand colour lightened 32 % toward white in OKLab (tokens.css). The page's
    // own maths (styles/color.ts, what the Accent field and the token tests judge by) must land where WebKit does —
    // within a step of rounding per channel, or the field would pass shades the page paints differently.
    const webkit = hexToRgb(await painted("--accent"));
    const ours = hexToRgb(okmix("#5b3fb8", "#ffffff", 0.32));
    const off = Math.max(...[0, 1, 2].map((i) => Math.abs(webkit[i]! - ours[i]!)));
    expect(`WebKit ${webkit.join(",")} vs ours ${ours.join(",")}: off by ${off}${off <= 2 ? ", within rounding" : ", TOO FAR"}`).toMatch(/within rounding$/);
    expect(await browser.execute(() => document.documentElement.style.getPropertyValue("--brand-accent"))).toBe("#5b3fb8");
    expect(await browser.execute(() => document.documentElement.getAttributeNames().join(","))).not.toContain("theme");
    expect(await $('[data-testid="accent-contrast"]').getText()).toMatch(/^Light [\d.]+:1, dark [\d.]+:1, passes$/);
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("a shade that would not read is not saved; the field offers one that does", async () => {
    await pickAccent("#ffe066");
    await expect($('[data-testid="accent-contrast"]')).toHaveText(expect.stringContaining("Kinas would offer #"));
    expect(await storedAccent()).toBe("#5b3fb8");
    await $('[data-testid="accent-contrast"] button').click();
    await browser.waitUntil(async () => (await storedAccent()) !== "#5b3fb8", { timeout: 10000, timeoutMsg: "the offer was not stored" });
    const offered = await storedAccent();
    expect(offered).toMatch(/^#[0-9a-f]{6}$/);
    expect(await $('[data-testid="accent-contrast"]').getText()).toMatch(/passes$/);
  });

  it("Rust refuses an accent the field could not have sent", async () => {
    const before = await storedAccent();
    const result = await invoke("set_accent", { value: "blue" });
    expect(result.refused).toContain("accent must be #rrggbb");
    expect((await invoke("set_accent", { value: "#5B3FB8" })).refused).toContain("accent must be #rrggbb");
    expect(await storedAccent()).toBe(before);
  });

  it("the Blue swatch is the brand's own and clears the choice", async () => {
    await $('button[aria-label="Accent Blue"]').click();
    await browser.waitUntil(async () => (await storedAccent()) === null, { timeout: 10000, timeoutMsg: "the accent was not cleared" });
    expect(await browser.execute(() => document.documentElement.style.getPropertyValue("--brand-accent"))).toBe("");
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
