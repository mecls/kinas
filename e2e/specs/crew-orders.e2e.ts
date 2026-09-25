import { $, browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, fakeHome, herdr, herdrSnapshot, typeLine } from "../helpers.ts";
import { writeSnapshot } from "../fake-firstmate/make.ts";

// The order log (build spec AC-8, §6.10): a line typed in the Work pane while a worker's pane is focused is an `order`
// on that worker's task within a second, timed in the page; a line typed at the first mate is no row at all; a token in
// a line is redacted before it is stored. The log counts, never the words. In `kinas-e2e-crew`, never `default`.

const SESSION = "kinas-e2e-crew";
const dataDir = process.env.KINAS_DATA_DIR!;
const db = join(dataDir, "kinas.sqlite");
const sql = (query: string) => execFileSync("/usr/bin/sqlite3", [db, query], { encoding: "utf8" }).trim();
const logFrom = Number(process.env.KINAS_E2E_LOG_FROM ?? "0");
const runLog = (needle: string) =>
  existsSync(APP_LOG) ? readFileSync(APP_LOG).subarray(logFrom).toString("utf8").split("\n").filter((l) => l.includes(needle)) : [];
const workerPane = () => readFileSync(join(dataDir, "worker-pane.txt"), "utf8").trim();
const TASK = "shop-health-9c2e";

const orders = () => sql(`SELECT text FROM crew_events WHERE task_id = '${TASK}' AND kind = 'order' ORDER BY id`).split("\n").filter(Boolean);
const focusWorkspace = (label: (l: string) => boolean) => herdr(SESSION, "workspace", "focus", herdrSnapshot(SESSION).workspaces.find((w) => label(w.label))!.workspace_id);

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

const go = (label: string) =>
  browser.execute((l: string) => [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim().startsWith(l))!.click(), label);

describe("the order log", () => {
  it("AC-8: an order is a row within a second, and only from a worker's pane", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    await go("Crew");
    const fleet = JSON.stringify({
      schema: "fm-fleet-snapshot.v1",
      generated: new Date().toISOString(),
      backlog: { records: [{ structured: true, id: TASK, title: "Add a health check to the shop 9c2e", kind: "ship", state: "in_flight", repo: "shop-9c2e" }] },
      tasks: [
        {
          id: TASK,
          kind: "ship",
          harness: "claude",
          project: "__FM_HOME__/projects/shop-9c2e",
          current_state: { state: "working", source: "status-log", detail: "running 9c2e", observed_at: new Date().toISOString() },
          endpoint: { target: `${SESSION}:${workerPane()}`, exists: true, status: "unknown" },
          hints: { pending_decision: false, blocked_event: false, open_decisions: [] },
        },
      ],
      main_inventory: { orphan_in_flight: [] },
    });
    writeSnapshot(fakeHome(), fleet);
    const refreshed = await browser.execute(() =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("refresh_readings").then(() => "ok"),
    );
    expect(refreshed).toBe("ok");
    await waitInPage(
      () => [...(document.querySelector('article.crew-card[data-task="shop-health-9c2e"]')?.querySelectorAll("button") ?? [])].some((b) => b.textContent === "Open its pane"),
      "the worker's card never had its pane",
    );
    // The task's detail in the panel, where its timeline shows the orders; the panel stays beside the Work page.
    await browser.execute(() => (document.querySelector('article.crew-card[data-task="shop-health-9c2e"]') as HTMLElement).click());
    await waitInPage(() => document.querySelector('.crew-detail[data-task="shop-health-9c2e"] .ui-timeline') !== null, "the detail never opened");
    await go("Work");
    await waitInPage(() => !document.querySelector('section[data-page="work"]')!.hasAttribute("hidden"), "the Work page never showed");

    // At the worker: timed in the page, from the Enter to the row on the timeline.
    focusWorkspace((l) => l.startsWith("└ shop-health"));
    await browser.execute(() => {
      const w = window as unknown as { __orderAt?: number | null; __typedAt?: number };
      w.__orderAt = null;
      const seen = () => [...document.querySelectorAll(".crew-detail .ui-timeline-text")].some((t) => t.textContent?.startsWith("deploy the thing 9c2e"));
      const observer = new MutationObserver(() => {
        if (seen()) {
          w.__orderAt = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document.querySelector(".crew-detail")!, { childList: true, subtree: true, characterData: true });
      w.__typedAt = performance.now();
    });
    await typeLine("deploy the thing 9c2e");
    await waitInPage(() => (window as unknown as { __orderAt?: number | null }).__orderAt != null, "the order never reached the timeline");
    const ms = await browser.execute(() => {
      const w = window as unknown as { __orderAt: number; __typedAt: number };
      return w.__orderAt - w.__typedAt;
    });
    console.log(`crew e2e: an order was on the timeline ${Math.round(ms)} ms after its Enter`);
    expect(ms).toBeLessThan(1000);
    const tag = await browser.execute(() =>
      [...document.querySelectorAll(".crew-detail .ui-timeline-text")].find((t) => t.textContent?.startsWith("deploy the thing 9c2e"))?.querySelector(".ui-tag")?.textContent,
    );
    expect(tag).toBe("order");

    // At the first mate: no row.
    focusWorkspace((l) => l === "firstmate");
    await typeLine("hello");
    await browser.pause(2000);
    expect(orders()).toEqual(["deploy the thing 9c2e"]);

    // Back at the worker, with a token in the line.
    focusWorkspace((l) => l.startsWith("└ shop-health"));
    await typeLine("token Bearer abc123");
    await browser.waitUntil(() => orders().length === 2, { timeout: 10000, timeoutMsg: "the second order never became a row" });
    expect(orders()).toEqual(["deploy the thing 9c2e", "token [redacted]"]);
    await waitInPage(() => [...document.querySelectorAll(".crew-detail .ui-timeline-text")].some((t) => t.textContent?.startsWith("token [redacted]")), "the redacted order never showed");

    expect(runLog("crew: order recorded").length).toBe(2);
    for (const needle of ["deploy the thing", "abc123", "hello", "9c2e"]) expect(runLog(needle)).toEqual([]);
  });
});
