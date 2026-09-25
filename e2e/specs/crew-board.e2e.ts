import { $, browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeHome, herdr, herdrSnapshot, logLines } from "../helpers.ts";
import { writeSnapshot } from "../fake-firstmate/make.ts";
import { setGhAnswer } from "../stub-tools/make.ts";

// The board by repository, a task's pane, PR and checks, the detail in the right panel and back to the reader, done and
// gone (build spec AC-4, AC-6, AC-7; §4 Crew page, Task detail, Usage). Each fleet is built here as Firstmate prints one;
// Refresh readings runs the collector at once and asks `gh` again, so no step waits out the schedule. In
// `kinas-e2e-crew`, never `default`; `gh` is the stub, answering fixtures/crew-gh-<n>.json.

const SESSION = "kinas-e2e-crew";
const dataDir = process.env.KINAS_DATA_DIR!;
const tools = join(dataDir, "tools");
const db = join(dataDir, "kinas.sqlite");
const sql = (query: string) => execFileSync("/usr/bin/sqlite3", [db, query], { encoding: "utf8" }).trim();
const workerPane = () => readFileSync(join(dataDir, "worker-pane.txt"), "utf8").trim();

const SHOP = "shop-health-9c2e";
const SHOP_TITLE = "Add a health check to the shop 9c2e";
const PR_URL = "https://github.com/acme-9c2e/shop-9c2e/pull/123";

interface Spec {
  id: string;
  title: string;
  project: string;
  backlog: "queued" | "in_flight" | "done";
  state?: string;
  harness?: string;
  target?: string;
  pr?: string;
  worktree?: boolean;
}

/** One task as Firstmate prints it: a structured backlog record, and a `tasks[]` row once it is spawned. */
function fleet(tasks: Spec[]): string {
  const records = tasks.map((t) => ({
    structured: true,
    id: t.id,
    title: t.title,
    kind: "ship",
    state: t.backlog,
    repo: t.project,
    pr_url: t.backlog === "done" ? (t.pr ?? null) : null,
    body_excerpt: `Delivery: direct-pr ${t.id}.`,
    captain_actionable: false,
  }));
  const rows = tasks
    .filter((t) => t.state)
    .map((t) => ({
      id: t.id,
      kind: "ship",
      harness: t.harness ?? "claude",
      mode: "direct-pr",
      yolo: "off",
      project: `__FM_HOME__/projects/${t.project}`,
      backend: "herdr",
      paths: { worktree: { path: `__FM_HOME__/../treehouse/${t.project}/1`, present: t.worktree ?? true }, report: { path: null, present: false } },
      current_state: { state: t.state, source: "status-log", detail: "running the tests 9c2e", observed_at: new Date().toISOString() },
      endpoint: { target: t.target ?? null, exists: !!t.target, status: "unknown" },
      pr: { url: t.pr ?? null },
      hints: { pending_decision: false, blocked_event: false, open_decisions: [] },
    }));
  return JSON.stringify({ schema: "fm-fleet-snapshot.v1", generated: new Date().toISOString(), backlog: { records }, tasks: rows, main_inventory: { orphan_in_flight: [] } });
}

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

/** Refresh readings: the collector runs now and asks `gh` about every PR again. */
async function refresh() {
  const answer = (await browser.execute(() =>
    (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("refresh_readings").then(
      () => "ok",
      (e: unknown) => String(e),
    ),
  )) as string;
  expect(answer).toBe("ok");
}

/** Puts this fleet in the fake home and runs the collector on it. */
async function file(tasks: Spec[]) {
  writeSnapshot(fakeHome(), fleet(tasks));
  await refresh();
}

const go = (label: string) =>
  browser.execute((l: string) => [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim() === l)!.click(), label);

/** The card's parts as the page draws them, as one JSON string (WebDriver mangles some returned objects). */
async function card(id: string): Promise<{ word: string; meta: string; pr: string | null; pane: boolean; selected: boolean } | null> {
  const json = (await browser.execute((task: string) => {
    const el = document.querySelector(`section[data-page="crew"] article.crew-card[data-task="${task}"]`);
    if (!el) return "null";
    return JSON.stringify({
      word: el.getAttribute("data-word"),
      meta: el.querySelector(".crew-meta")?.textContent ?? "",
      pr: el.querySelector(".crew-pr")?.textContent ?? null,
      pane: [...el.querySelectorAll("button")].some((b) => b.textContent === "Open its pane"),
      selected: el.getAttribute("data-selected") === "true",
    });
  }, id)) as string;
  return JSON.parse(json);
}

const cardWord = (id: string, word: string) =>
  browser.waitUntil(
    () =>
      browser.execute(
        (t: string, w: string) => document.querySelector(`section[data-page="crew"] article.crew-card[data-task="${t}"]`)?.getAttribute("data-word") === w,
        id,
        word,
      ),
    { timeout: 30000, interval: 250, timeoutMsg: `${id} never read ${word}` },
  );

describe("the board, the PR and the task detail", () => {
  it("AC-7: lanes by repository, and Usage counts them", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    await go("Crew");
    await file([
      { id: "a1-9c2e", title: "Alpha in flight 9c2e", project: "alpha-9c2e", backlog: "in_flight", state: "working" },
      { id: "a2-9c2e", title: "Alpha queued 9c2e", project: "alpha-9c2e", backlog: "queued" },
      { id: "b1-9c2e", title: "Beta in flight 9c2e", project: "beta-9c2e", backlog: "in_flight", state: "working" },
      { id: "g1-9c2e", title: "Gamma in flight 9c2e", project: "gamma-9c2e", backlog: "in_flight", state: "working" },
      { id: "d1-9c2e", title: "Delta in flight 9c2e", project: "delta-9c2e", backlog: "in_flight", state: "working", harness: "pi" },
    ]);
    await waitInPage(() => document.querySelectorAll('section[data-page="crew"] .crew-lane').length === 4, "the board never had four lanes");
    const lanes = JSON.parse(
      (await browser.execute(() =>
        JSON.stringify(
          [...document.querySelectorAll('section[data-page="crew"] .crew-lane')].map((l) => ({
            name: l.querySelector(".ui-lane-head > span:not(.ui-chip):not(.ui-lane-slots):not(.ui-tag)")?.textContent,
            chip: l.querySelector(".ui-lane-head .ui-chip") !== null,
            repo: l.getAttribute("data-repo"),
            counts: l.querySelector(".ui-lane-slots")?.textContent ?? "",
          })),
        ),
      )) as string,
    );
    expect(lanes).toEqual([
      { name: "alpha-9c2e", chip: true, repo: "o/alpha-9c2e", counts: "1 in flight · 1 queued" },
      { name: "beta-9c2e", chip: true, repo: "o/beta-9c2e", counts: "1 in flight" },
      { name: "delta-9c2e", chip: false, repo: null, counts: "1 in flight" },
      { name: "gamma-9c2e", chip: false, repo: "o/gamma-9c2e", counts: "1 in flight" },
    ]);

    await go("Usage");
    await waitInPage(() => document.querySelector('section[data-page="usage"] [data-section="crew"]') !== null, "Usage never showed the crew");
    const rows = JSON.parse(
      (await browser.execute(() =>
        JSON.stringify(
          [...document.querySelectorAll('section[data-page="usage"] [data-section="crew"] .ui-metric-row')].map(
            (r) => `${r.querySelector(".ui-metric-label")?.textContent} · ${r.querySelector(".ui-metric-value")?.textContent?.replace(/\s+/g, " ").trim()}`,
          ),
        ),
      )) as string,
    );
    expect(rows).toEqual(["claude · 3 in flight", "pi · 1 in flight", "Queued · 1 task"]);

    // Every task done: nothing in flight or queued, and the section is gone.
    await file([
      { id: "a1-9c2e", title: "Alpha in flight 9c2e", project: "alpha-9c2e", backlog: "done" },
      { id: "a2-9c2e", title: "Alpha queued 9c2e", project: "alpha-9c2e", backlog: "done" },
      { id: "b1-9c2e", title: "Beta in flight 9c2e", project: "beta-9c2e", backlog: "done" },
      { id: "g1-9c2e", title: "Gamma in flight 9c2e", project: "gamma-9c2e", backlog: "done" },
      { id: "d1-9c2e", title: "Delta in flight 9c2e", project: "delta-9c2e", backlog: "done" },
    ]);
    await waitInPage(() => document.querySelector('section[data-page="usage"] [data-section="crew"]') === null, "the Crew section stayed with nothing running");
  });

  it("AC-4: a working task has its pane, its PR and its checks", async () => {
    await go("Crew");
    const target = `${SESSION}:${workerPane()}`;
    await file([{ id: SHOP, title: SHOP_TITLE, project: "shop-9c2e", backlog: "in_flight", state: "working", target }]);
    await cardWord(SHOP, "working");
    await waitInPage(
      () => [...(document.querySelector('article.crew-card[data-task="shop-health-9c2e"]')?.querySelectorAll("button") ?? [])].some((b) => b.textContent === "Open its pane"),
      "Open its pane never showed for the worker",
    );
    const working = await card(SHOP);
    expect(working?.meta).toMatch(/^ship · claude · working \d+ min$/);
    expect(working?.pr).toBeNull();
    const lane = await browser.execute(() => document.querySelector('article.crew-card[data-task="shop-health-9c2e"]')?.closest(".crew-lane")?.getAttribute("data-repo"));
    expect(lane).toBe("acme-9c2e/shop-9c2e");

    // Open its pane: Herdr focuses the worker's workspace, and the Work page shows.
    const workerWorkspace = herdrSnapshot(SESSION).panes.find((p) => p.pane_id === workerPane())!.workspace_id;
    expect(herdrSnapshot(SESSION).focused_workspace_id).not.toBe(workerWorkspace);
    await browser.execute(() => [...document.querySelector('article.crew-card[data-task="shop-health-9c2e"]')!.querySelectorAll("button")].find((b) => b.textContent === "Open its pane")!.click());
    await browser.waitUntil(() => herdrSnapshot(SESSION).focused_workspace_id === workerWorkspace, { timeout: 15000, timeoutMsg: "Herdr never focused the worker's workspace" });
    await waitInPage(() => !document.querySelector('section[data-page="work"]')!.hasAttribute("hidden"), "the Work page never showed");

    // The PR: four checks, one failing — CI red; then all green and mergeable — ready, with no click.
    await go("Crew");
    setGhAnswer(tools, 1);
    await file([{ id: SHOP, title: SHOP_TITLE, project: "shop-9c2e", backlog: "in_flight", state: "working", target, pr: PR_URL }]);
    await cardWord(SHOP, "CI red");
    expect((await card(SHOP))?.pr).toBe("PR #123 · checks 3/4 · 1 failing");
    setGhAnswer(tools, 2);
    await refresh();
    await cardWord(SHOP, "ready");
    expect((await card(SHOP))?.pr).toBe("PR #123 · checks 4/4 · mergeable");

    expect(sql(`SELECT kind, text FROM crew_events WHERE task_id = '${SHOP}' AND kind IN ('pr', 'checks') ORDER BY id`).split("\n")).toEqual([
      "pr|PR #123 opened",
      "checks|checks 3/4 · 1 failing",
      "checks|checks 4/4",
    ]);
    expect(logLines("crew: gh 1 PRs in ").length).toBeGreaterThan(0);
  });

  it("the detail in the right panel, the brief in the reader, and back", async () => {
    const brief = join(fakeHome(), "data", SHOP, "brief.md");
    mkdirSync(join(fakeHome(), "data", SHOP), { recursive: true });
    writeFileSync(brief, "# The brief 9c2e\n\nAdd a health check.\n");
    await refresh();
    await browser.execute(() => (document.querySelector('article.crew-card[data-task="shop-health-9c2e"]') as HTMLElement).click());
    await waitInPage(
      () => document.querySelector('aside.shell-panel[data-occupant="task"]:not([hidden]) .crew-detail[data-task="shop-health-9c2e"] .ui-panel-h h3') !== null,
      "the detail never opened in the panel",
    );
    await waitInPage(() => document.querySelector('[data-testid="crew-detail-pr"]')?.textContent === "PR #123 · open · mergeable · approved", "the detail's PR line never read as GitHub says");
    const detail = JSON.parse(
      (await browser.execute(() => {
        const d = document.querySelector(".crew-detail")!;
        return JSON.stringify({
          title: d.querySelector(".ui-panel-h h3")?.textContent,
          crumb: d.querySelector(".ui-panel-crumb span:not(.ui-chip)")?.textContent,
          badge: d.querySelector(".ui-panel-h .ui-badge")?.textContent,
          state: d.querySelector(".ui-panel-b .ui-mono")?.textContent,
          checks: d.querySelectorAll(".ui-checks li").length,
          timeline: ["PR #123 opened", "checks 3/4 · 1 failing", "checks 4/4"].every((x) => [...d.querySelectorAll(".ui-timeline-text")].some((t) => t.textContent === x)),
          worktree: d.querySelector('[data-testid="crew-detail-worktree"]')?.textContent,
          selected: document.querySelector('article.crew-card[data-task="shop-health-9c2e"]')?.getAttribute("data-selected"),
          label: document.querySelector("aside.shell-panel")?.getAttribute("aria-label"),
        });
      })) as string,
    );
    expect(detail).toEqual({
      title: SHOP_TITLE,
      crumb: "shop-9c2e",
      badge: "ready",
      state: "state: working · source: status-log · running the tests 9c2e",
      checks: 4,
      timeline: true,
      worktree: "present",
      selected: "true",
      label: "Task",
    });

    // Open the brief: the reader takes the panel, through the click door, and the task leaves it.
    await browser.execute(() => [...document.querySelectorAll(".crew-detail button")].find((b) => b.textContent === "Open the brief")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await waitInPage(
      () => document.querySelector('aside.shell-panel[data-occupant="reader"]:not([hidden]) .reader-frame') !== null && document.querySelector(".crew-detail")!.hasAttribute("hidden"),
      "the brief never took the panel",
    );
    await waitInPage(() => document.querySelector("aside.shell-panel")?.textContent?.includes("The brief 9c2e") === true, "the reader never showed the brief");
    // And back: a card puts the task in the panel again, and the reader keeps its tab.
    await browser.execute(() => (document.querySelector('article.crew-card[data-task="shop-health-9c2e"]') as HTMLElement).click());
    await waitInPage(() => document.querySelector('aside.shell-panel[data-occupant="task"]:not([hidden])') !== null, "the task never came back to the panel");
    const tabs = await browser.execute(() => document.querySelectorAll("aside.shell-panel .ui-tabstrip [role=tab]").length);
    expect(tabs).toBeGreaterThan(0);
  });

  it("AC-6: done and gone are visible, and the mirror keeps the row", async () => {
    // Done, its worktree gone and its pane closed.
    herdr(SESSION, "workspace", "close", herdrSnapshot(SESSION).panes.find((p) => p.pane_id === workerPane())!.workspace_id);
    await file([{ id: SHOP, title: SHOP_TITLE, project: "shop-9c2e", backlog: "done", state: "done", pr: PR_URL, worktree: false }]);
    await cardWord(SHOP, "done");
    const done = await card(SHOP);
    expect(done?.meta).toMatch(/^ship · claude · done in \d+ min$/);
    expect(done?.pane).toBe(false);
    await waitInPage(() => document.querySelector('[data-testid="crew-detail-worktree"]')?.textContent === "gone", "the detail's worktree never read gone");

    // Gone from the snapshot.
    await file([]);
    await waitInPage(() => document.querySelector('[data-testid="crew-detail-gone"]')?.textContent === "No longer in the fleet snapshot", "the detail never said the task left");
    const row = sql(`SELECT done_at IS NOT NULL, gone_at IS NOT NULL FROM crew_tasks WHERE id = '${SHOP}'`);
    expect(row).toBe("1|1");

    // × closes the panel.
    await browser.execute(() => (document.querySelector('.crew-detail button[aria-label="Close the panel"]') as HTMLButtonElement).click());
    await waitInPage(() => document.querySelector("aside.shell-panel")!.hasAttribute("hidden"), "× never closed the panel");
  });

  it("logs counts and PR numbers, never a task", async () => {
    expect(logLines("9c2e")).toEqual([]);
    expect(logLines("shop-health")).toEqual([]);
  });
});
