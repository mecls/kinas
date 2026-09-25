import { $, browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeHome, logLines } from "../helpers.ts";
import { writeSnapshot } from "../fake-firstmate/make.ts";
import { BROKEN, fleet, HEALTHY, inventory } from "./crew-reconcile.fleet.ts";

// Reconciliation, second launch (build spec AC-9; §7 Reconcile rows): over the data folder crew-reconcile-a left, the
// Inbox's Reconcile group lists exactly the broken task's two lines and none for the healthy one; nothing counts them;
// the fake home is unchanged; both rows and their events survived the relaunch; and once a snapshot leaves the broken
// task out, its lines are gone. Nothing is repaired.

const dataDir = process.env.KINAS_DATA_DIR!;
const sql = (query: string) => execFileSync("/usr/bin/sqlite3", [join(dataDir, "kinas.sqlite"), query], { encoding: "utf8" }).trim();

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

const reconcile = async () =>
  JSON.parse((await browser.execute(() => JSON.stringify([...document.querySelectorAll('section[data-page="inbox"] .inbox-reconcile li')].map((li) => li.textContent)))) as string) as string[];

describe("reconciliation, the relaunch", () => {
  it("AC-9: lists what disagrees, counts none of it, and repairs nothing", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    const before = JSON.parse(readFileSync(join(dataDir, "home-inventory.json"), "utf8")) as string[];
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim().startsWith("Inbox"))!.click());
    await waitInPage(() => document.querySelectorAll('section[data-page="inbox"] .inbox-reconcile li').length > 0, "the Reconcile group never showed");
    const worktree = join(fakeHome(), "treehouse", BROKEN);
    expect(await reconcile()).toEqual([`${BROKEN} title: Firstmate's endpoint kinas-e2e-crew:w-${BROKEN}:p1 is dead`, `${BROKEN} title: worktree ${worktree} is gone`]);
    const caption = await browser.execute(() => document.querySelector('section[data-page="inbox"] [data-section="reconcile"] .ui-caption')?.textContent);
    expect(caption).toBe("information — nothing here is repaired");

    // Not counted: no waiting count anywhere.
    const count = await browser.execute(() => [...document.querySelectorAll(".sidebar-nav button")].find((b) => b.querySelector(".ui-nav-label")?.textContent === "Inbox")?.querySelector(".ui-nav-count")?.textContent ?? "");
    expect(count).toBe("");
    // Both rows survived the relaunch with their events, and the fake home is as the first launch left it.
    expect(sql(`SELECT count(*) FROM crew_tasks WHERE id IN ('${BROKEN}', '${HEALTHY}')`)).toBe("2");
    expect(Number(sql(`SELECT count(*) FROM crew_events WHERE task_id = '${BROKEN}'`))).toBeGreaterThan(0);
    expect(inventory(fakeHome())).toEqual(before);

    // A snapshot without the broken task: its lines go (it is gone, not in flight).
    writeSnapshot(fakeHome(), fleet(fakeHome(), false));
    expect(
      await browser.execute(() =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("refresh_readings").then(() => "ok"),
      ),
    ).toBe("ok");
    await waitInPage(() => document.querySelector('section[data-page="inbox"] .inbox-reconcile') === null, "the broken task's lines never went");
    expect(sql(`SELECT gone_at IS NOT NULL FROM crew_tasks WHERE id = '${BROKEN}'`)).toBe("1");
    expect(logLines(BROKEN)).toEqual([]);
  });
});
