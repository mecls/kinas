import { browser, $, expect } from "@wdio/globals";
import { hook, waitForShell } from "../helpers.ts";

// The status bar (tasks/interface-polish, rules 23–24; DESIGN.md 1.11 §3.1), slice 1: the window's foot stands on every
// page, across the whole window, with the sidebar shown and hidden — and the terminal's process never changes for it
// (ADR 0002; build-spec invariant 1). Slice 6 adds the readings' tones, the crew, the VPS, the popover and full screen.

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

  it("never re-mounts the terminal: its process is the one it was", async () => {
    expect(await hook<number>("ptyPid")).toBe(pid);
  });
});
