import { $, browser, expect } from "@wdio/globals";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeHome } from "../helpers.ts";
import { writeSnapshot } from "../fake-firstmate/make.ts";
import { BROKEN, fleet, HEALTHY, inventory } from "./crew-reconcile.fleet.ts";

// Reconciliation, first launch (build spec AC-9): the mirror takes one task in flight whose endpoint Firstmate reports
// dead and whose worktree is gone, and one healthy; the second launch (crew-reconcile-b) reads what disagrees.

describe("reconciliation, the first launch", () => {
  it("leaves a mirror with a broken task and a healthy one", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    writeSnapshot(fakeHome(), fleet(fakeHome(), true));
    const refreshed = await browser.execute(() =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("refresh_readings").then(() => "ok"),
    );
    expect(refreshed).toBe("ok");
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim().startsWith("Crew"))!.click());
    await browser.waitUntil(
      () => browser.execute((a: string, b: string) => document.querySelector(`article.crew-card[data-task="${a}"]`) !== null && document.querySelector(`article.crew-card[data-task="${b}"]`) !== null, BROKEN, HEALTHY),
      { timeout: 30000, timeoutMsg: "the two tasks never reached the board" },
    );
    // The fake home as this launch leaves it: the second launch must change none of it.
    writeFileSync(join(process.env.KINAS_DATA_DIR!, "home-inventory.json"), JSON.stringify(inventory(fakeHome())));
  });
});
