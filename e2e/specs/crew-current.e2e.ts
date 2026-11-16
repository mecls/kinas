import { $, browser, expect } from "@wdio/globals";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_LOG, fakeHome } from "../helpers.ts";
import { setCapacity, setSnapshot, writeConfig, writeSnapshot } from "../fake-firstmate/make.ts";

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

/** A sidebar page by its label; the Inbox's button carries its count beside the label. */
const go = (label: string) =>
  browser.execute(
    (l: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")]
        .find((b) => (b.querySelector(".ui-nav-label")?.textContent ?? b.textContent?.trim()) === l)!
        .click(),
    label,
  );

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

  it("a held question's PR: its quiet line, its three lines, Open the PR, and Approve's line unchanged", async () => {
    const clipboardFile = join(dataDir, "clipboard.txt");
    await go("Inbox");
    const sel = `section[data-page="inbox"] li.inbox-item[data-task="${HELD}"][data-key="${HELD}"]`;
    await browser.waitUntil(() => browser.execute((q: string) => document.querySelector(q) !== null, sel), { timeout: 30000, timeoutMsg: "the held item never reached the Inbox" });
    const item = JSON.parse(
      (await browser.execute((q: string) => {
        const el = document.querySelector(q)!;
        const span = el.querySelector(".ui-inbox-question > span") as HTMLElement;
        const lineHeight = parseFloat(getComputedStyle(span).lineHeight);
        return JSON.stringify({
          verb: el.getAttribute("data-verb"),
          context: el.querySelector(".ui-inbox-context")?.textContent,
          buttons: [...el.querySelectorAll("button")].map((b) => b.textContent),
          lines: span.textContent?.split("\n").length,
          renderedLines: Math.round(span.getBoundingClientRect().height / lineHeight),
        });
      }, sel)) as string,
    );
    expect(item.verb).toBe("captain-hold");
    expect(item.context).toMatch(/^Held for you · Stock webhook 9c2e · PR #91 · (just now|\d+ (min|h|d) ago)$/);
    expect(item.buttons).toEqual(["Open the PR", "DenyD", "AnswerR", "ApproveA"]);
    expect(item.lines).toBe(3);
    expect(item.renderedLines).toBeGreaterThanOrEqual(3);

    // Open the PR: Rust opens the URL it stored for this task — here the debug build's logged skip, with no URL in it.
    const skipped = runLog("a link was not opened").length;
    await browser.execute((q: string) => [...document.querySelector(q)!.querySelectorAll("button")].find((b) => b.textContent === "Open the PR")!.click(), sel);
    await browser.waitUntil(async () => runLog("a link was not opened").length > skipped, { timeout: 15000, timeoutMsg: "Open the PR never reached the opener" });
    expect(runLog("/pull/91")).toEqual([]);
    // The PR adds nothing to the count.
    const sidebar = await browser.execute(
      () => [...document.querySelectorAll(".sidebar-nav button")].find((b) => b.querySelector(".ui-nav-label")?.textContent === "Inbox")?.querySelector(".ui-nav-count")?.textContent ?? "",
    );
    expect(sidebar).toBe("1");

    // The detail: PR #91 and Open the PR in the held task's PR section.
    await go("Crew");
    await openTask(HELD);
    await waitInPage(() => [...document.querySelectorAll(".crew-detail button")].some((b) => b.textContent === "Open the PR"), "the detail never offered Open the PR");
    const before = runLog("a link was not opened").length;
    await browser.execute(() => [...document.querySelectorAll(".crew-detail button")].find((b) => b.textContent === "Open the PR")!.click());
    await browser.waitUntil(async () => runLog("a link was not opened").length > before, { timeout: 15000, timeoutMsg: "the detail's Open the PR never reached the opener" });
    expect(await browser.execute(() => document.querySelector('[data-testid="crew-detail-error"]') === null)).toBe(true);

    // Approve puts the same line it always did on the clipboard, and goes to the first mate.
    await go("Inbox");
    await browser.execute((q: string) => [...document.querySelector(q)!.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Approve"))!.click(), sel);
    await browser.waitUntil(() => existsSync(clipboardFile) && readFileSync(clipboardFile, "utf8") === `On ${HELD}: Approved — go ahead.`, {
      timeout: 15000,
      timeoutMsg: "the approval never reached the clipboard",
    });
    await waitInPage(() => !document.querySelector('section[data-page="work"]')!.hasAttribute("hidden"), "the approval never ended on the Work page");
    await browser.pause(500);
  });

  it("free lanes: none without a cap, the count with one, a held dispatch, and never a run with a quota provider", async () => {
    const home = fakeHome();
    const capacityCalls = () =>
      (existsSync(join(home, "state", "calls.log")) ? readFileSync(join(home, "state", "calls.log"), "utf8") : "").split("\n").filter((l) => l.startsWith("fm-capacity.sh")).length;
    const caption = () => browser.execute(() => document.querySelector('section[data-page="crew"] .ui-section-head .ui-caption')?.textContent ?? "");
    const usageLanes = () =>
      browser.execute(() => {
        const row = document.querySelector('section[data-page="usage"] [data-section="crew"] [data-metric="crew-lanes"]');
        return row ? `${row.querySelector(".ui-metric-label")?.textContent} · ${row.querySelector(".ui-metric-value")?.textContent?.replace(/\s+/g, " ").trim()}` : null;
      });

    // No config/lane-capacity: the script never runs, and nothing about lanes is drawn.
    await go("Crew");
    setSnapshot(home, CURRENT);
    await refresh();
    await waitWord(PARKED, "in review");
    expect(capacityCalls()).toBe(0);
    expect(await caption()).not.toContain("lanes");

    // A cap of 4: the count in the caption, and Usage's Lanes row.
    writeConfig(home, "lane-capacity", "4\n");
    setCapacity(home, "crew-capacity.cap4.synthetic.json");
    await refresh();
    await browser.waitUntil(async () => (await caption()).includes(" · 2 of 4 lanes free"), { timeout: 30000, interval: 250, timeoutMsg: "the caption never said 2 of 4 lanes free" });
    expect(capacityCalls()).toBe(1);
    await go("Usage");
    await browser.waitUntil(async () => (await usageLanes()) === "Lanes · 2 of 4 in use", { timeout: 30000, interval: 250, timeoutMsg: "Usage never said 2 of 4 in use" });

    // Held: Firstmate's reasons, in its words, after the count.
    await go("Crew");
    setCapacity(home, "crew-capacity.held.synthetic.json");
    await refresh();
    await browser.waitUntil(async () => (await caption()).includes("0 of 4 lanes free · dispatch held · memory: 8% free, cpu: load 9.10 on 8 cores"), {
      timeout: 30000,
      interval: 250,
      timeoutMsg: "the caption never said the dispatch is held",
    });
    const held = await browser.execute(() => document.querySelector('section[data-page="crew"] .ui-section-head .crew-held')?.textContent ?? null);
    expect(held?.startsWith("dispatch held · memory: 8% free")).toBe(true);

    // Another contract: one line under the board, and the last good reading stays.
    setCapacity(home, "crew-capacity.v2.synthetic.json");
    await refresh();
    await waitInPage(
      () => [...document.querySelectorAll('[data-testid="crew-note"]')].some((p) => p.textContent === "Lane capacity: unsupported contract fm-lane-capacity.v2 · showing the last reading"),
      "the unsupported contract was never said under the board",
    );
    expect(await caption()).toContain("0 of 4 lanes free");

    // A quota provider: the script would run quota-axi, so it is never run, and nothing about lanes is drawn.
    const ran = capacityCalls();
    writeConfig(home, "lane-capacity", "4\nquota-provider claude\n");
    setCapacity(home, "crew-capacity.cap4.synthetic.json");
    await refresh();
    await refresh();
    await browser.waitUntil(async () => !(await caption()).includes("lanes"), { timeout: 30000, interval: 250, timeoutMsg: "the lanes stayed with a quota provider" });
    expect(capacityCalls()).toBe(ran);
  });

  it("Settings says which of Firstmate's options are on, and that the first mate turns them on", async () => {
    const home = fakeHome();
    const options = () =>
      browser.execute(() =>
        JSON.stringify(
          [...document.querySelectorAll('section[data-page="settings"] [data-section="crew"] table.crew-options tbody tr')].map((tr) => [
            tr.getAttribute("data-option-row"),
            tr.querySelector(".ui-badge")?.textContent,
          ]),
        ),
      );
    // The quota provider from the last case is still set.
    await go("Home");
    await go("Settings");
    await browser.waitUntil(async () => (await options()).includes("checks quota"), { timeout: 30000, interval: 250, timeoutMsg: "Settings never showed the options" });
    expect(JSON.parse(await options())).toEqual([
      ["park-on-review", "off"],
      ["fleet-ledger", "off"],
      ["lane-capacity", "checks quota — Kinas does not run it"],
    ]);
    const help = await browser.execute(() => document.querySelector('[data-testid="crew-options-help"]')?.textContent ?? "");
    expect(help).toBe("Turn these on or off by asking the first mate.");

    writeConfig(home, "park-on-review", "");
    writeConfig(home, "fleet-ledger", "");
    writeConfig(home, "lane-capacity", "auto\n");
    await go("Home");
    await go("Settings");
    await browser.waitUntil(async () => (await options()).includes('"auto"'), { timeout: 30000, interval: 250, timeoutMsg: "Settings never read the new options" });
    expect(JSON.parse(await options())).toEqual([
      ["park-on-review", "on"],
      ["fleet-ledger", "on"],
      ["lane-capacity", "auto"],
    ]);
    writeConfig(home, "lane-capacity", "4\n");
    await go("Home");
    await go("Settings");
    await browser.waitUntil(async () => (await options()).includes('"cap 4"'), { timeout: 30000, interval: 250, timeoutMsg: "Settings never read cap 4" });
    // Back to none for the cases after this one; Kinas wrote none of these files — the spec did, as the captain would.
    for (const name of ["park-on-review", "fleet-ledger", "lane-capacity"] as const) writeConfig(home, name, null);
  });

  it("logs counts, never a task, a branch or a question", async () => {
    expect(runLog("9c2e")).toEqual([]);
    expect(runLog("fm/stock-webhook")).toEqual([]);
    expect(runLog("stock-webhook")).toEqual([]);
    expect(existsSync(join(dataDir, "firstmate", "state", "calls.log"))).toBe(true);
  });
});
