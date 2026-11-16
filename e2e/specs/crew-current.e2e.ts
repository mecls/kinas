import { $, browser, expect } from "@wdio/globals";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_LOG, fakeHome } from "../helpers.ts";
import { setSnapshot, writeSnapshot } from "../fake-firstmate/make.ts";

// Firstmate, current (build spec §11.4, §12): the branch, in review, a held question's PR, free lanes and the fleet
// ledger, as Firstmate 427056c publishes them, read from the fake home. Each step puts a fleet in the fake home and runs
// the collector at once with Refresh readings. In `kinas-e2e-crew`, never `default`; no link is opened
// (KINAS_E2E_NO_OPEN).

const dataDir = process.env.KINAS_DATA_DIR!;
const logFrom = Number(process.env.KINAS_E2E_LOG_FROM ?? "0");
const CURRENT = "firstmate-fleet-snapshot.current.synthetic.json";
const HELD = "stock-webhook-9c2e";
const PARKED = "harbor-review-9c2e";
const RELAUNCH = "harbor-relaunch-9c2e";
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

/** The current fixture, changed by `edit` before it goes in the fake home. */
function current(edit: (snap: { backlog: { records: Record<string, unknown>[] }; tasks: Record<string, unknown>[] }) => void = () => {}): string {
  const snap = JSON.parse(readFileSync(join(fixturesDir, CURRENT), "utf8"));
  edit(snap);
  return JSON.stringify(snap);
}

const cardWord = (id: string) =>
  browser.execute((t: string) => document.querySelector(`section[data-page="crew"] article.crew-card[data-task="${t}"]`)?.getAttribute("data-word") ?? null, id);
const waitWord = (id: string, word: string) =>
  browser.waitUntil(async () => (await cardWord(id)) === word, { timeout: 30000, interval: 250, timeoutMsg: `${id} never read ${word}` });

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

  it("a task parked on review reads in review, in flight in its lane, and the waiting count does not move", async () => {
    await waitWord(PARKED, "in review");
    const parked = JSON.parse(
      (await browser.execute((t: string) => {
        const card = document.querySelector(`section[data-page="crew"] article.crew-card[data-task="${t}"]`)!;
        return JSON.stringify({
          badge: card.querySelector(".ui-badge")?.getAttribute("data-state"),
          word: card.querySelector(".ui-badge")?.textContent,
          lane: card.closest(".crew-lane")?.querySelector(".ui-lane-slots")?.textContent,
        });
      }, PARKED)) as string,
    );
    expect(parked).toEqual({ badge: "review", word: "in review", lane: "2 in flight" });
    // A relaunch that failed is reported blocked, and reads blocked.
    expect(await cardWord(RELAUNCH)).toBe("blocked");
    // The only open item is the held task: in review adds nothing to the one count.
    await browser.waitUntil(
      () => browser.execute(() => document.querySelector('section[data-page="crew"] [data-testid="crew-waiting"]')?.textContent === "1 waiting on you"),
      { timeout: 30000, interval: 250, timeoutMsg: "the waiting count was not 1" },
    );
    const sidebar = await browser.execute(
      () => [...document.querySelectorAll(".sidebar-nav button")].find((b) => b.querySelector(".ui-nav-label")?.textContent === "Inbox")?.querySelector(".ui-nav-count")?.textContent ?? "",
    );
    expect(sidebar).toBe("1");
    // The detail keeps Firstmate's line verbatim.
    await openTask(PARKED);
    const line = await browser.execute(() => document.querySelector(".crew-detail .ui-panel-b .ui-mono")?.textContent ?? "");
    expect(line.startsWith("state: paused · source: review-park · parked on review: PR https://github.com/")).toBe(true);
  });

  it("the backlog's old word parked still reads needs decision", async () => {
    writeSnapshot(
      fakeHome(),
      current((snap) => {
        const row = snap.tasks.find((t) => t.id === RELAUNCH)! as { current_state: Record<string, unknown> };
        row.current_state = { ...row.current_state, state: "parked", source: "status-log" };
      }),
    );
    await refresh();
    await waitWord(RELAUNCH, "needs decision");
    expect(await cardWord(PARKED)).toBe("in review");
    // A parked state opens no item of its own: the count is the held task's still.
    const crew = await browser.execute(() => document.querySelector('section[data-page="crew"] [data-testid="crew-waiting"]')?.textContent ?? "");
    expect(crew).toBe("1 waiting on you");
    setSnapshot(fakeHome(), CURRENT);
    await refresh();
    await waitWord(RELAUNCH, "blocked");
  });

  it("logs counts, never a task, a branch or a question", async () => {
    expect(runLog("9c2e")).toEqual([]);
    expect(runLog("fm/stock-webhook")).toEqual([]);
    expect(runLog("stock-webhook")).toEqual([]);
    expect(existsSync(join(dataDir, "firstmate", "state", "calls.log"))).toBe(true);
  });
});
