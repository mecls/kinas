import { browser, $, expect } from "@wdio/globals";
import { hook, waitForShell } from "../helpers.ts";

/** A command's answer, or its refusal. */
const invoke = <T>(command: string, args?: Record<string, unknown>) =>
  browser.execute(
    (cmd: string, a: Record<string, unknown> | undefined) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(cmd, a).then(
        (v) => v ?? null,
        (e: unknown) => ({ refused: String(e) }),
      ),
    command,
    args,
  ) as Promise<T>;

/** What the bar says, part by part, and whether the popover is open — one round trip. */
const barText = () =>
  browser.execute(() => {
    const part = (name: string) => document.querySelector(`.ui-statusbar [data-part="${name}"]`);
    return {
      readings: part("readings")?.textContent ?? null,
      danger: [...document.querySelectorAll('.ui-statusbar [data-tone="danger"]')].map((r) => r.getAttribute("data-reading")),
      crew: part("crew")?.textContent ?? null,
      vps: part("vps")?.textContent ?? null,
      empty: part("empty")?.textContent ?? null,
      popover: document.querySelector(".ui-popover") !== null,
    };
  });

// The status bar (tasks/interface-polish, rules 23–25; DESIGN.md 1.13 §3.1, §4), on Home's fixtures: the window's foot
// stands on every page, across the whole window, with the sidebar shown and hidden; it says Home's three readings with
// a danger dot on Claude's session at 97 %, and the VPS; the readings open the Usage popover, Esc closes it and gives
// the keys back; the VPS opens Usage at its section — and the terminal's process never changes for any of it (ADR 0002;
// build-spec invariant 1). Full screen is the smoke test's (docs/smoke-test.md): a script cannot leave a Space it made.

/** The bar's box and the window's size, in CSS pixels. */
const geometry = () =>
  browser.execute(() => {
    const bar = document.querySelector<HTMLElement>(".ui-statusbar");
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), winW: window.innerWidth, winH: window.innerHeight };
  });

/** Along the window's foot, the window's width, 28 px (--hit). */
// WebdriverIO's expect takes no message, so the place rides in the compared value and a failure names it.
async function expectAtTheFoot(where: string): Promise<void> {
  const g = await geometry();
  const seen = g ? { where, left: g.left, width: g.width, height: g.height, bottom: g.top + g.height } : { where, missing: true };
  expect(seen).toEqual({ where, left: 0, width: g?.winW, height: 28, bottom: g?.winH });
}

const PAGES: [string, string][] = [
  ["1", "home"],
  ["2", "work"],
  ["3", "crew"],
  ["4", "usage"],
  ["5", "inbox"],
  [",", "settings"],
];

describe("the status bar", () => {
  let pid = 0;

  before(async () => {
    await waitForShell();
    pid = await hook<number>("ptyPid");
  });

  it("spans the window's foot on every page", async () => {
    for (const [key, page] of PAGES) {
      await browser.keys(["Meta", key]);
      await $(`section[data-page="${page}"]`).waitForDisplayed({ timeout: 10000 });
      await expectAtTheFoot(page);
    }
    if (process.env.KINAS_E2E_SHOTS) await browser.saveScreenshot(`${process.env.KINAS_E2E_SHOTS}/statusbar-settings.png`);
  });

  it("stays at the foot with the sidebar hidden, and again when it is shown", async () => {
    await browser.keys(["Meta", "2"]);
    await $('section[data-page="work"]').waitForDisplayed();
    await browser.keys(["Meta", "s"]);
    await $("nav.sidebar").waitForDisplayed({ reverse: true });
    await expectAtTheFoot("sidebar hidden");
    await browser.keys(["Meta", "s"]);
    await $("nav.sidebar").waitForDisplayed();
    await expectAtTheFoot("sidebar shown");
  });

  it("says Home's three readings, a dot only on the one in danger, and the VPS; no crew before its setup", async () => {
    expect(await invoke("set_hostinger_vm", { vmId: 17923, label: "srv17923.hstgr.cloud · KVM 4" })).toBeNull();
    expect(await invoke("set_convex_deployment", { url: "https://happy-otter-123.convex.cloud" })).toBeNull();
    await browser.waitUntil(async () => {
      const seen = await barText();
      return (seen.readings ?? "").includes("Ollama") && (seen.vps ?? "").includes("connected");
    }, { timeout: 120000, interval: 1000, timeoutMsg: "the bar never had its readings and its VPS" });
    const seen = await barText();
    expect(seen).toEqual({
      readings: "Claude week 24%Claude session 97%Ollama session 2.5%",
      danger: ["claude-plan/session"],
      crew: null,
      vps: "Hostinger VPSconnected",
      empty: null,
      popover: false,
    });
  });

  it("on Work, the readings open the popover; Esc closes it and the keys come back to them; the terminal is the one it was", async () => {
    await browser.keys(["Meta", "2"]);
    await $('section[data-page="work"]').waitForDisplayed();
    // The keyboard's path: the readings button has the keys, and opens the popover.
    await browser.execute(() => {
      const button = document.querySelector<HTMLButtonElement>('.ui-statusbar [data-part="readings"]')!;
      button.focus();
      button.click();
    });
    await $(".ui-popover").waitForDisplayed({ timeout: 10000, timeoutMsg: "the popover never opened" });
    const open = await browser.execute(() => ({
      blocks: [...document.querySelectorAll(".ui-popover-block")].map((b) => b.getAttribute("data-provider")),
      session: document.querySelector('.ui-popover-window[data-window="claude-plan/session"] .ui-popover-line')?.textContent ?? null,
      expanded: document.querySelector('.ui-statusbar [data-part="readings"]')?.getAttribute("aria-expanded"),
      focused: document.activeElement?.classList.contains("ui-popover") ?? false,
      foot: document.querySelector(".ui-popover-foot")?.textContent ?? null,
    }));
    expect(open.blocks).toEqual(["Claude", "Ollama", "Convex"]);
    expect(open.session).toMatch(/^97% usedresets in 1 h \d{1,2} m$/);
    expect({ expanded: open.expanded, focused: open.focused, foot: open.foot }).toEqual({ expanded: "true", focused: true, foot: "Open Usage ⌘4" });
    if (process.env.KINAS_E2E_SHOTS) await browser.saveScreenshot(`${process.env.KINAS_E2E_SHOTS}/statusbar-popover.png`);
    await browser.keys(["Escape"]);
    await $(".ui-popover").waitForExist({ reverse: true, timeout: 10000, timeoutMsg: "Esc never closed the popover" });
    const after = await browser.execute(() => ({
      focused: document.activeElement?.getAttribute("data-part") ?? null,
      page: document.querySelector<HTMLElement>("section.page:not([hidden])")?.dataset.page ?? null,
    }));
    expect(after).toEqual({ focused: "readings", page: "work" });
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("the VPS opens the Usage page at its section", async () => {
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.ui-statusbar [data-part="vps"]')!.click());
    await $('section[data-page="usage"]').waitForDisplayed({ timeout: 10000 });
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const section = document.querySelector('section[data-page="usage"] [data-section="hostinger"]');
          if (!section) return false;
          const top = section.getBoundingClientRect().top;
          return top >= 0 && top < window.innerHeight / 2;
        }),
      { timeout: 10000, timeoutMsg: "the Hostinger section never came into view" },
    );
  });

  it("never re-mounts the terminal: its process is the one it was", async () => {
    expect(await hook<number>("ptyPid")).toBe(pid);
  });
});
