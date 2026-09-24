import { $, browser, expect } from "@wdio/globals";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeHome, logLines } from "../helpers.ts";
import { setSnapshot } from "../fake-firstmate/make.ts";

// The crew's collector, end to end (build spec AC-3, slice 1's tracer bullet): Firstmate files a task — the spec swaps
// the fake home's snapshot and touches data/backlog.md, as Firstmate's own writes do — and the Crew page shows it as a
// card within 5 s, timed in the page. The log carries the count and never the task.

const TITLE = "Add a health check to the shop 9c2e";

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

describe("the crew's collector", () => {
  it("shows the empty fleet on the Crew page", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    // A click in the page: the sidebar's Crew row.
    await browser.execute(() => {
      const row = [...document.querySelectorAll<HTMLButtonElement>(".sidebar-nav button")].find((b) => b.textContent?.trim() === "Crew");
      row!.click();
    });
    await waitInPage(
      () => document.querySelector('section[data-page="crew"] .crew[data-crew="running"] .ui-empty')?.textContent?.includes("No tasks") === true,
      "the Crew page never showed the empty fleet",
    );
    const title = await browser.execute(() => [...document.querySelectorAll(".sidebar-nav button")].find((b) => b.textContent?.trim() === "Crew")?.getAttribute("title"));
    expect(title).toBe("Crew (⌘3)");
  });

  it("AC-3: a filed task is a card within 5 s of the backlog's touch", async () => {
    // The snapshot runs at most once per 5 s, and showing the page just ran it: wait that gap out, so what is timed is
    // a task filed between runs, not the gap.
    await browser.pause(5500);
    await browser.execute(() => {
      const w = window as unknown as { __crewCardAt?: number | null };
      w.__crewCardAt = null;
      const observer = new MutationObserver(() => {
        if (document.querySelector('section[data-page="crew"] article.crew-card[data-word="queued"]')) {
          w.__crewCardAt = Date.now();
          observer.disconnect();
        }
      });
      observer.observe(document.querySelector('section[data-page="crew"]')!, { childList: true, subtree: true, attributes: true });
    });
    const home = fakeHome();
    setSnapshot(home, "crew-snapshot.queued.synthetic.json");
    const touched = Date.now();
    appendFileSync(join(home, "data", "backlog.md"), "- [ ] shop-health-9c2e\n");
    await waitInPage(() => document.querySelector('section[data-page="crew"] article.crew-card[data-word="queued"]') !== null, "the queued card never showed");
    const seenAt = await browser.execute(() => (window as unknown as { __crewCardAt?: number | null }).__crewCardAt ?? 0);
    console.log(`crew e2e: a filed task was a card ${seenAt - touched} ms after the backlog's touch`);
    expect(seenAt - touched).toBeLessThan(5000);

    const card = await browser.execute(() => {
      const el = document.querySelector('section[data-page="crew"] article.crew-card[data-word="queued"]')!;
      return { task: el.getAttribute("data-task"), title: el.querySelector(".ui-card-title")?.textContent, badge: el.querySelector(".ui-badge")?.textContent };
    });
    expect(card).toEqual({ task: "shop-health-9c2e", title: TITLE, badge: "queued" });
    const lane = await browser.execute(() => document.querySelector('section[data-page="crew"] .crew-lane')?.getAttribute("data-project"));
    expect(lane).toBe("shop-9c2e");
    // KINAS_E2E_SHOT=<file.png>: keep a picture of the board for a person to look at (slice 1's "show the captain").
    if (process.env.KINAS_E2E_SHOT) await browser.saveScreenshot(process.env.KINAS_E2E_SHOT);
  });

  it("logs the count, never the task, and runs no script but the snapshot", async () => {
    expect(logLines("crew: snapshot 1 tasks, 0 decisions in ").length).toBeGreaterThan(0);
    expect(logLines("9c2e")).toEqual([]);
    const calls = readFileSync(join(fakeHome(), "state", "calls.log"), "utf8").trim().split("\n");
    expect(calls.length).toBeGreaterThan(1);
    expect(new Set(calls)).toEqual(new Set(["fm-fleet-snapshot.sh --json"]));
  });
});
