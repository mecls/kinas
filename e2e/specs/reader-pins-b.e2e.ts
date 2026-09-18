import { browser, expect } from "@wdio/globals";
import { waitForShell } from "../helpers.ts";

// Pinned and Recent, second launch (tasks/three-column-shell-build-spec.md AC-12, AC-13): a new process over the data
// folder `reader-pins-a` left behind. What was pinned is here; what was merely opened is not.

const PINNED_FILE = "pin-me-7f3a.md";

async function waitInPageWith(condition: (arg: string) => boolean, arg: string, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition, arg), { timeout, interval: 250, timeoutMsg });
}

const pinned = () =>
  browser.execute(() =>
    [...document.querySelectorAll<HTMLButtonElement>(".sidebar-pinned .sidebar-pin > .sidebar-row")].map((b) => ({
      name: b.querySelector(".sidebar-row-name")?.textContent ?? "",
      disabled: b.getAttribute("aria-disabled") === "true",
    })),
  );

describe("Pinned and Recent, after a relaunch", () => {
  before(async () => {
    await waitForShell();
  });

  it("AC-12: the pins are back, in the order they were pinned, and AC-13: Recent is empty and so not there", async () => {
    await browser.waitUntil(async () => (await pinned()).length === 2, { timeout: 20000, timeoutMsg: `the pins did not come back: ${JSON.stringify(await pinned())}` });
    expect(await pinned()).toEqual([
      { name: PINNED_FILE, disabled: false },
      { name: "docs", disabled: false },
    ]);
    // Sixteen files were opened in the first launch. None of that was kept.
    expect(await browser.execute(() => document.querySelector(".sidebar-recent"))).toBeNull();
    // Nothing is open, so there is no Files section and the panel is closed.
    expect(await browser.execute(() => ({ files: document.querySelector(".sidebar .reader-files") !== null, panel: document.querySelector<HTMLElement>(".shell")!.dataset.panel }))).toEqual({
      files: false,
      panel: "closed",
    });
  });

  it("a pin opens its file in a panel that was closed, and a pinned folder lists itself", async () => {
    await browser.execute((name: string) => [...document.querySelectorAll<HTMLButtonElement>(".sidebar-pinned .sidebar-row")].find((b) => b.querySelector(".sidebar-row-name")?.textContent === name)!.click(), PINNED_FILE);
    await waitInPageWith(
      (suffix: string) => (document.querySelector(".reader-path")?.textContent ?? "").endsWith(suffix) && document.querySelector(".reader-doc[data-rendered]") !== null,
      PINNED_FILE,
      "the pinned file never opened",
    );
    expect(await browser.execute(() => document.querySelector<HTMLElement>(".shell")!.dataset.panel)).toBe("open");
    // And now it is the one recent file.
    expect(await browser.execute(() => [...document.querySelectorAll(".sidebar-recent .sidebar-row-name")].map((n) => n.textContent))).toEqual([PINNED_FILE]);

    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".sidebar-pinned .sidebar-row")].find((b) => b.querySelector(".sidebar-row-name")?.textContent === "docs")!.click());
    await browser.waitUntil(() => browser.execute(() => [...document.querySelectorAll(".sidebar-pin-tree .tree-item")].some((b) => b.textContent?.trim() === "guide.md")), {
      timeout: 15000,
      timeoutMsg: "the pinned folder's tree never listed guide.md after the relaunch",
    });
  });
});
