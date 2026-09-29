import { $, browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fakeHome, hook } from "../helpers.ts";
import { writeSnapshot } from "../fake-firstmate/make.ts";

// Done work clears (tasks/crew-done-clears/prd.md §5): a finished task — done or gone — stays while a page shows it,
// and leaves at that page's next load; a done task whose PR is still open stays until it is merged or closed. Each
// fleet is built here as Firstmate prints one, and Refresh readings runs the collector at once, so no step waits out
// the schedule. `gh` is the stub. The steps are the PRD's, numbered as it numbers them.

const dataDir = process.env.KINAS_DATA_DIR!;
const db = join(dataDir, "kinas.sqlite");
const sql = (query: string) => execFileSync("/usr/bin/sqlite3", [db, query], { encoding: "utf8" }).trim();

interface Spec {
  id: string;
  title: string;
  project: string;
  backlog: "queued" | "in_flight" | "done";
  state?: string;
  pr?: string;
}

/** One task as Firstmate prints it: a structured backlog record, and a `tasks[]` row while it is spawned. */
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
      harness: "claude",
      mode: "direct-pr",
      yolo: "off",
      project: `__FM_HOME__/projects/${t.project}`,
      backend: "herdr",
      paths: { worktree: { path: `__FM_HOME__/../treehouse/${t.project}/1`, present: true }, report: { path: null, present: false } },
      current_state: { state: t.state, source: "status-log", detail: "running the tests 9c2e", observed_at: new Date().toISOString() },
      pr: { url: t.pr ?? null },
      hints: { pending_decision: false, blocked_event: false, open_decisions: [] },
    }));
  return JSON.stringify({ schema: "fm-fleet-snapshot.v1", generated: new Date().toISOString(), backlog: { records }, tasks: rows, main_inventory: { orphan_in_flight: [] } });
}

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

/** Refresh readings: the collector runs now, asks `gh` about every PR again, and the pages read the crew afresh. */
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

/** The Crew page's cards, in order, as `id word`. */
const cards = async () =>
  JSON.parse(
    (await browser.execute(() =>
      JSON.stringify([...document.querySelectorAll('section[data-page="crew"] article.crew-card')].map((c) => `${c.getAttribute("data-task")} ${c.getAttribute("data-word")}`)),
    )) as string,
  ) as string[];

const cardWord = (id: string, word: string) =>
  browser.waitUntil(async () => (await cards()).includes(`${id} ${word}`), { timeout: 30000, interval: 250, timeoutMsg: `${id} never read ${word}` });

/** Waits for a page to stamp a task: it showed it finished. */
const stamped = (id: string, column: "board_seen_at" | "overnight_seen_at") =>
  browser.waitUntil(() => sql(`SELECT ${column} IS NOT NULL FROM crew_tasks WHERE id = '${id}'`) === "1", { timeout: 15000, interval: 250, timeoutMsg: `${id}'s ${column} never set` });

const A1 = { id: "a1-9c2e", title: "Alpha one 9c2e", project: "alpha-9c2e" };
const A2 = { id: "a2-9c2e", title: "Alpha two 9c2e", project: "alpha-9c2e" };

describe("Done work clears", () => {
  before(async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    // The test window sits off screen, where WebKit calls it hidden, and a hidden window stamps nothing: count it shown.
    expect(await hook<boolean>("crewAssumeShown")).toBe(true);
  });

  it("clears 1: a task that turns done while the Crew page shows it keeps its card through the page's re-reads", async () => {
    await go("Crew");
    await file([
      { ...A1, backlog: "in_flight", state: "working" },
      { ...A2, backlog: "in_flight", state: "working" },
    ]);
    await cardWord(A1.id, "working");
    await file([
      { ...A1, backlog: "done" },
      { ...A2, backlog: "in_flight", state: "working" },
    ]);
    await cardWord(A1.id, "done");
    await stamped(A1.id, "board_seen_at");
    // Two re-reads and a focus: the page's list never loses a card it has drawn (rule 3).
    await refresh();
    await refresh();
    await browser.execute(() => window.dispatchEvent(new Event("focus")));
    await browser.pause(1500);
    expect(await cards()).toEqual([`${A2.id} working`, `${A1.id} done`]);
  });

  it("clears 2: Home and back to Crew — the done card is gone, and its lane with it when it was the last", async () => {
    await go("Home");
    await go("Crew");
    await browser.waitUntil(async () => !(await cards()).some((c) => c.startsWith(A1.id)), { timeout: 15000, interval: 250, timeoutMsg: `${A1.id}'s card stayed after a new load` });
    expect(await cards()).toEqual([`${A2.id} working`]);

    // The lane's last task: seen done, then a new load — no card, and no lane.
    await file([
      { ...A1, backlog: "done" },
      { ...A2, backlog: "done" },
    ]);
    await cardWord(A2.id, "done");
    await stamped(A2.id, "board_seen_at");
    await go("Home");
    await go("Crew");
    await waitInPage(() => document.querySelectorAll('section[data-page="crew"] .crew-lane').length === 0, "the lane stayed with nothing left in it");
    // Nothing deleted: the mirror keeps both rows (rule 11).
    expect(sql("SELECT count(*) FROM crew_tasks WHERE id IN ('a1-9c2e', 'a2-9c2e')")).toBe("2");
  });
});
