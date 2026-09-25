import { $, browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fakeHome } from "../helpers.ts";
import { writeSnapshot } from "../fake-firstmate/make.ts";

// Home's night (build spec AC-15, the Home half; §6.12): the caption from the end of the last session, a folder's row
// counting only its tasks with activity inside that window, a quiet folder saying so, selecting a row opening the
// task that waits in the panel; Waiting on you with three items and All 5 in Inbox; and one count — five — on Home,
// the sidebar, the Crew page and the menu-bar title. R on a compact item opens it on the Inbox with its box open.

const dataDir = process.env.KINAS_DATA_DIR!;
const db = join(dataDir, "kinas.sqlite");
const sql = (query: string) => execFileSync("/usr/bin/sqlite3", [db, query], { encoding: "utf8" }).trim();
const H = 3_600_000;

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

const invoke = async (command: string): Promise<string> =>
  (await browser.execute(
    (cmd: string) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(cmd).then(
        (v) => `ok:${String(v)}`,
        (e: unknown) => `refused:${String(e)}`,
      ),
    command,
  )) as string;

const decision = (key: string) => ({ key, verb: "needs-decision", summary: `${key}? 9c2e` });
const task = (id: string, state: string, backlog: string, decisions: ReturnType<typeof decision>[] = []) => ({
  record: { structured: true, id, title: `${id} title`, kind: "ship", state: backlog, repo: "alpha-9c2e" },
  row: {
    id,
    kind: "ship",
    harness: "claude",
    project: "__FM_HOME__/projects/alpha-9c2e",
    current_state: { state, source: "status-log", detail: "9c2e", observed_at: new Date().toISOString() },
    endpoint: { target: null, exists: false, status: "unknown" },
    hints: { pending_decision: decisions.length > 0, blocked_event: false, open_decisions: decisions },
  },
});

describe("Home: the crew's night", () => {
  it("AC-15, the Home half: the caption, the rows, Waiting on you and one count", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    const tasks = [
      task("a1-9c2e", "parked", "in_flight", [decision("k1"), decision("k2"), decision("k3")]),
      task("a2-9c2e", "parked", "in_flight", [decision("k4"), decision("k5")]),
      task("a3-9c2e", "done", "done"),
      task("a0-9c2e", "done", "done"),
    ];
    writeSnapshot(
      fakeHome(),
      JSON.stringify({
        schema: "fm-fleet-snapshot.v1",
        generated: new Date().toISOString(),
        backlog: { records: tasks.map((t) => t.record) },
        tasks: tasks.map((t) => t.row),
        main_inventory: { orphan_in_flight: [] },
      }),
    );
    expect(await invoke("refresh_readings")).toBe("ok:null");
    await browser.waitUntil(() => sql("SELECT count(*) FROM crew_decisions WHERE closed_at IS NULL") === "5", { timeout: 30000, timeoutMsg: "five decisions never reached the mirror" });

    // The night began ten hours ago; a0 finished two hours before that, outside it.
    const now = Date.now();
    const org = "(SELECT id FROM orgs LIMIT 1)";
    sql(`INSERT OR REPLACE INTO settings (org_id, key, value) VALUES (${org}, 'window_session_end_at', '${now - 10 * H}')`);
    sql(`UPDATE crew_tasks SET first_seen_at = ${now - 13 * H}, done_at = ${now - 12 * H} WHERE id = 'a0-9c2e'`);
    sql(`UPDATE crew_events SET at = ${now - 12 * H} WHERE task_id = 'a0-9c2e'`);
    expect(await invoke("refresh_readings")).toBe("ok:null");

    await waitInPage(() => /^since \d\d:\d\d( yesterday)?, (9|10) h \d+ m$/.test(document.querySelector('[data-section="overnight"] .ui-caption')?.textContent ?? ""), "the caption never said since when");
    await waitInPage(() => document.querySelector('[data-section="overnight"] [data-folder="alpha-9c2e"] .ui-segbar') !== null, "alpha's row never drew its night");
    const rows = JSON.parse(
      (await browser.execute(() =>
        JSON.stringify(
          [...document.querySelectorAll('[data-section="overnight"] .ui-progress-row')].map((r) => ({
            folder: r.getAttribute("data-folder"),
            event: r.querySelector(".ui-progress-event")?.textContent,
            badges: [...r.querySelectorAll(".ui-badge")].map((b) => b.textContent),
            target: r.getAttribute("data-target"),
          })),
        ),
      )) as string,
    );
    expect(rows[0].folder).toBe("alpha-9c2e");
    expect(rows[0].badges).toEqual(["2 needs decision", "1 done"]);
    expect(rows[0].event).toMatch(/^Needs decision: k\d\? 9c2e \d\d:\d\d$/);
    expect(["a1-9c2e", "a2-9c2e"]).toContain(rows[0].target);
    expect(rows[1]).toEqual({ folder: "quiet-9c2e", event: "No work overnight in this folder.", badges: [], target: null });

    // Waiting on you: three of five, and the way to the rest.
    const waiting = JSON.parse(
      (await browser.execute(() => {
        const s = document.querySelector('[data-section="waiting"]')!;
        return JSON.stringify({ items: s.querySelectorAll("li.inbox-item").length, action: s.querySelector(".ui-section-action")?.textContent, compact: s.querySelector('.ui-inbox-item[data-compact="true"]') !== null });
      })) as string,
    );
    expect(waiting).toEqual({ items: 3, action: "All 5 in Inbox", compact: true });

    // One count.
    const counts = JSON.parse(
      (await browser.execute(() => {
        const inbox = [...document.querySelectorAll(".sidebar-nav button")].find((b) => b.querySelector(".ui-nav-label")?.textContent === "Inbox");
        return JSON.stringify({
          home: document.querySelector('[data-testid="home-waiting"]')?.textContent,
          sidebar: inbox?.querySelector(".ui-nav-count")?.textContent,
          crew: document.querySelector('[data-testid="crew-waiting"]')?.textContent,
        });
      })) as string,
    );
    expect(counts).toEqual({ home: "5 waiting on you", sidebar: "5", crew: "5 waiting on you" });
    expect((await invoke("tray_title")).endsWith(" · 5")).toBe(true);

    // Selecting alpha's row opens the task that waits in the panel.
    const target = rows[0].target as string;
    await browser.execute(() => (document.querySelector('[data-section="overnight"] [data-folder="alpha-9c2e"]') as HTMLElement).click());
    await browser.waitUntil(
      () => browser.execute((t: string) => document.querySelector(`aside.shell-panel[data-occupant="task"]:not([hidden]) .crew-detail[data-task="${t}"]`) !== null, target),
      { timeout: 15000, timeoutMsg: "the waiting task never opened in the panel" },
    );
    const decisionBlock = await browser.execute(() => document.querySelectorAll(".crew-detail .crew-decision").length);
    expect(decisionBlock).toBeGreaterThan(0);

    // R on a compact item: the Inbox, with that item's box open and holding the keys.
    const first = JSON.parse(
      (await browser.execute(() => {
        const li = document.querySelector('[data-section="waiting"] li.inbox-item')!;
        (li.querySelector(".ui-inbox-item") as HTMLElement).focus();
        return JSON.stringify({ task: li.getAttribute("data-task"), key: li.getAttribute("data-key") });
      })) as string,
    );
    await browser.keys("r");
    await browser.waitUntil(
      () =>
        browser.execute(
          (t: string, k: string) =>
            !document.querySelector('section[data-page="inbox"]')!.hasAttribute("hidden") &&
            document.querySelector(`section[data-page="inbox"] li.inbox-item[data-task="${t}"][data-key="${k}"] textarea`) === document.activeElement,
          first.task,
          first.key,
        ),
      { timeout: 15000, timeoutMsg: "R never opened the item on the Inbox with its box" },
    );
  });
});
