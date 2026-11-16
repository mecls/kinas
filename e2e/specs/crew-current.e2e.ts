import { $, browser, expect } from "@wdio/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, fakeHome } from "../helpers.ts";
import { setSnapshot } from "../fake-firstmate/make.ts";

// Firstmate, current (build spec §11.4, §12): the branch, in review, a held question's PR, free lanes and the fleet
// ledger, as Firstmate 427056c publishes them, read from the fake home. Each step puts a fleet in the fake home and runs
// the collector at once with Refresh readings. In `kinas-e2e-crew`, never `default`; no link is opened
// (KINAS_E2E_NO_OPEN).

const dataDir = process.env.KINAS_DATA_DIR!;
const logFrom = Number(process.env.KINAS_E2E_LOG_FROM ?? "0");
const CURRENT = "firstmate-fleet-snapshot.current.synthetic.json";
const HELD = "stock-webhook-9c2e";

/** This run's log lines that contain `needle`: the log is shared by every run of Kinas. */
const runLog = (needle: string) =>
  existsSync(APP_LOG) ? readFileSync(APP_LOG).subarray(logFrom).toString("utf8").split("\n").filter((l) => l.includes(needle)) : [];

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

/** Refresh readings: the collector runs now. */
async function refresh() {
  const answer = (await browser.execute(() =>
    (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("refresh_readings").then(
      () => "ok",
      (e: unknown) => String(e),
    ),
  )) as string;
  expect(answer).toBe("ok");
}

const go = (label: string) =>
  browser.execute((l: string) => [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim() === l)!.click(), label);

/** Opens a card's task in the right panel. */
async function openTask(id: string) {
  await waitInPage(() => document.querySelector("section[data-page=\"crew\"] article.crew-card") !== null, "the board never drew a card");
  await browser.execute((t: string) => (document.querySelector(`section[data-page="crew"] article.crew-card[data-task="${t}"]`) as HTMLElement).click(), id);
  await browser.waitUntil(
    () => browser.execute((t: string) => document.querySelector(`aside.shell-panel[data-occupant="task"]:not([hidden]) .crew-detail[data-task="${t}"]`) !== null, id),
    { timeout: 30000, interval: 250, timeoutMsg: `the detail of ${id} never opened` },
  );
}

describe("Firstmate, current", () => {
  it("a task's branch shows under its state line", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    await go("Crew");
    setSnapshot(fakeHome(), CURRENT);
    await refresh();
    await openTask(HELD);
    await waitInPage(() => document.querySelector('[data-testid="task-branch"]')?.textContent === "branch fm/stock-webhook", "the detail never named the branch");
    // The line sits right under Firstmate's state line, in the State section.
    const order = await browser.execute(() => {
      const branch = document.querySelector('[data-testid="task-branch"]')!;
      return branch.previousElementSibling?.querySelector(".ui-mono")?.textContent?.startsWith("state: ") ?? false;
    });
    expect(order).toBe(true);
  });

  it("logs counts, never a task, a branch or a question", async () => {
    expect(runLog("9c2e")).toEqual([]);
    expect(runLog("fm/stock-webhook")).toEqual([]);
    expect(runLog("stock-webhook")).toEqual([]);
    expect(existsSync(join(dataDir, "firstmate", "state", "calls.log"))).toBe(true);
  });
});
