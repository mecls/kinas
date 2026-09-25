import { $, browser, expect } from "@wdio/globals";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { APP_LOG, fakeHome, herdr, herdrSnapshot } from "../helpers.ts";
import { writeSnapshot } from "../fake-firstmate/make.ts";
import { removeStubTool, restoreNpmStubTool } from "../stub-tools/make.ts";

// The Inbox (build spec AC-5, AC-12, AC-14; §6.2–6.4, §6.12): an answer is a line on the clipboard (here a file) for
// the first mate's pane, and Kinas runs no Firstmate script but the snapshot, writes nothing under its home and types
// nothing into any pane; the item stays, Copied, and still counts, until the snapshot stops listing it. One count on
// the sidebar, the Crew page and the menu-bar title. In `kinas-e2e-crew`, never `default`.

const SESSION = "kinas-e2e-crew";
const dataDir = process.env.KINAS_DATA_DIR!;
const tools = join(dataDir, "tools");
const clipboardFile = join(dataDir, "clipboard.txt");
const standIn = join(dataDir, "standin");
const logFrom = Number(process.env.KINAS_E2E_LOG_FROM ?? "0");
const workerPane = () => readFileSync(join(dataDir, "worker-pane.txt"), "utf8").trim();

const TASK = "export-csv-9c2e";
const KEY = "api-shape-9c2e";
const QUESTION = "REST or GraphQL for the export listing 9c2e?";
const HELD_LIVE = "held-live-9c2e";
const HELD_GONE = "held-gone-9c2e";

/** This run's log lines that contain `needle`: the log is shared by every run of Kinas. */
const runLog = (needle: string) =>
  existsSync(APP_LOG) ? readFileSync(APP_LOG).subarray(logFrom).toString("utf8").split("\n").filter((l) => l.includes(needle)) : [];
const clipboard = () => (existsSync(clipboardFile) ? readFileSync(clipboardFile, "utf8") : null);
const calls = () => readFileSync(join(fakeHome(), "state", "calls.log"), "utf8").trim().split("\n");
const standInStdin = () => readFileSync(join(standIn, "stdin.log"), "utf8");
const standInRuns = () => readFileSync(join(standIn, "argv.log"), "utf8").trim().split("\n").filter(Boolean);
const workspaces = (label: string) => herdrSnapshot(SESSION).workspaces.filter((w) => w.label === label);
const focusedLabel = () => {
  const s = herdrSnapshot(SESSION);
  return s.workspaces.find((w) => w.workspace_id === s.focused_workspace_id)?.label ?? null;
};
const focusElsewhere = () => herdr(SESSION, "workspace", "focus", workspaces("elsewhere")[0]!.workspace_id);

/** Every file under the fake home but the calls log, with its size and modification time (AC-5's inventory). */
function inventory(): string[] {
  const home = fakeHome();
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const s = statSync(path);
      if (s.isDirectory()) walk(path);
      else if (relative(home, path) !== join("state", "calls.log")) out.push(`${relative(home, path)} ${s.size} ${s.mtimeMs}`);
    }
  };
  walk(home);
  return out.sort();
}

interface Spec {
  id: string;
  title: string;
  backlog: "in_flight" | "done";
  state?: string;
  target?: string;
  decisions?: { key: string; summary: string }[];
  held?: string;
  body?: string;
}

function fleet(tasks: Spec[]): string {
  const records = tasks.map((t) => ({
    structured: true,
    id: t.id,
    title: t.title,
    kind: "ship",
    state: t.backlog,
    repo: "shop-9c2e",
    captain_actionable: !!t.held,
    hold_reason: t.held ?? null,
    body_excerpt: t.body ?? null,
  }));
  const rows = tasks
    .filter((t) => t.state)
    .map((t) => ({
      id: t.id,
      kind: "ship",
      harness: "claude",
      project: `__FM_HOME__/projects/shop-9c2e`,
      current_state: { state: t.state, source: "status-log", detail: "waiting 9c2e", observed_at: new Date().toISOString() },
      // A worker Firstmate has not recorded has no endpoint facts; `exists: false` would say its pane went away, a
      // Reconcile line (slice 9).
      ...(t.target ? { endpoint: { target: t.target, exists: true, status: "unknown" } } : {}),
      paths: { worktree: { path: null, present: true } },
      pr: { url: null },
      hints: {
        pending_decision: (t.decisions ?? []).length > 0,
        blocked_event: false,
        open_decisions: (t.decisions ?? []).map((d) => ({ key: d.key, verb: "needs-decision", summary: d.summary })),
      },
    }));
  return JSON.stringify({ schema: "fm-fleet-snapshot.v1", generated: new Date().toISOString(), backlog: { records }, tasks: rows, main_inventory: { orphan_in_flight: [] } });
}

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

async function file(tasks: Spec[]) {
  writeSnapshot(fakeHome(), fleet(tasks));
  expect(await invoke("refresh_readings")).toBe("ok:null");
}

const go = (label: string) =>
  browser.execute((l: string) => [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim().startsWith(l))!.click(), label);

/** The one count where the captain sees it: the sidebar's Inbox, the Crew page's button, the menu-bar title. */
async function counts(): Promise<{ sidebar: string; crew: string; tray: string }> {
  const page = JSON.parse(
    (await browser.execute(() => {
      const inbox = [...document.querySelectorAll(".sidebar-nav button")].find((b) => b.querySelector(".ui-nav-label")?.textContent === "Inbox");
      return JSON.stringify({
        sidebar: inbox?.querySelector(".ui-nav-count")?.textContent ?? "",
        crew: document.querySelector('section[data-page="crew"] [data-testid="crew-waiting"]')?.textContent ?? "",
      });
    })) as string,
  );
  return { ...page, tray: (await invoke("tray_title")).replace(/^ok:/, "") };
}

const itemSel = (task: string, key: string) => `section[data-page="inbox"] li.inbox-item[data-task="${task}"][data-key="${key}"]`;

/** Focuses an inbox item, as a click on it does, once the Inbox shows and the item has the focus, and presses a key. */
async function press(task: string, key: string, k: string) {
  await waitInPage(() => !document.querySelector('section[data-page="inbox"]')!.hasAttribute("hidden"), "the Inbox never showed");
  await browser.waitUntil(
    () => browser.execute((sel: string) => {
      const el = document.querySelector(`${sel} .ui-inbox-item`) as HTMLElement | null;
      el?.focus();
      return el !== null && document.activeElement === el;
    }, itemSel(task, key)),
    { timeout: 15000, interval: 250, timeoutMsg: `the item ${task} never took the focus` },
  );
  await browser.keys(k);
}

/** Types into the item's open box, then Enter: Copy and go. */
async function typeAndCopy(text: string) {
  await waitInPage(() => document.activeElement?.classList.contains("inbox-answer") === true, "the answer box never took the keys");
  // The words go in as a paste would — this WebDriver drops Space (and sends it to a pane as an F-key) — then a real
  // Enter, which is the key under test.
  await browser.execute((t: string) => {
    const box = document.activeElement as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, t);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await browser.keys("Enter");
}

/**
 * An answer's flow ends with the Work page showing and the terminal holding the keys, after the launcher: the
 * clipboard file is written before that. The next step waits for it, or its keys would land in the pane.
 */
async function answered() {
  await waitInPage(() => !document.querySelector('section[data-page="work"]')!.hasAttribute("hidden"), "the answer never ended on the Work page");
  await browser.pause(500);
}

const copiedLine = (task: string, key: string) => browser.execute((sel: string) => document.querySelector(`${sel} .inbox-copied`)?.textContent ?? null, itemSel(task, key));

describe("the Inbox", () => {
  it("AC-5: A copies the line, goes to the first mate, and Kinas ran and wrote nothing", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    await go("Inbox");
    await file([{ id: TASK, title: "Export listing as CSV 9c2e", backlog: "in_flight", state: "parked", decisions: [{ key: KEY, summary: QUESTION }] }]);
    await browser.waitUntil(() => browser.execute((sel: string) => document.querySelector(sel) !== null, itemSel(TASK, KEY)), { timeout: 30000, timeoutMsg: "the decision never reached the Inbox" });
    const item = JSON.parse(
      (await browser.execute((sel: string) => {
        const el = document.querySelector(sel)!;
        return JSON.stringify({ verb: el.getAttribute("data-verb"), question: el.querySelector(".ui-inbox-question")?.textContent, context: el.querySelector(".ui-inbox-context")?.textContent, buttons: [...el.querySelectorAll("button")].map((b) => b.textContent) });
      }, itemSel(TASK, KEY))) as string,
    );
    expect(item).toEqual({ verb: "needs-decision", question: QUESTION, context: `Export listing as CSV 9c2e · ${KEY} · just now`, buttons: ["DenyD", "AnswerR", "ApproveA"] });
    await go("Crew");
    await waitInPage(() => document.querySelector('[data-testid="crew-waiting"]')?.textContent === "1 waiting on you", "Crew never said 1 waiting on you");
    const one = await counts();
    expect([one.sidebar, one.crew, / · 1$/.test(one.tray)]).toEqual(["1", "1 waiting on you", true]);
    await go("Inbox");

    focusElsewhere();
    expect(focusedLabel()).toBe("elsewhere");
    const before = inventory();
    const callsBefore = calls().length;
    await press(TASK, KEY, "a");

    const line = `On ${TASK} (${KEY}): Approved — go ahead.`;
    await browser.waitUntil(() => clipboard() === line, { timeout: 15000, timeoutMsg: `the clipboard never held the approval; it holds ${clipboard()}` });
    await browser.waitUntil(() => focusedLabel() === "firstmate", { timeout: 15000, timeoutMsg: "Herdr never focused the first mate" });
    await waitInPage(() => !document.querySelector('section[data-page="work"]')!.hasAttribute("hidden"), "the Work page never showed");
    await waitInPage(() => document.body.textContent?.includes("Your answer is on the clipboard — paste it into the first mate's pane.") === true, "the notice never said what to paste");
    expect(standInStdin()).toBe("");
    expect(standInRuns()).toEqual(["0"]);
    expect(new Set(calls())).toEqual(new Set(["fm-fleet-snapshot.sh --json"]));
    expect(calls().length).toBeGreaterThanOrEqual(callsBefore);
    expect(inventory()).toEqual(before);

    await go("Inbox");
    await browser.waitUntil(async () => /^Copied \d\d:\d\d — paste it into the first mate's pane$/.test((await copiedLine(TASK, KEY)) ?? ""), { timeout: 15000, timeoutMsg: "the item never read Copied" });
    await go("Crew");
    const still = await counts();
    expect([still.sidebar, still.crew, / · 1$/.test(still.tray)]).toEqual(["1", "1 waiting on you", true]);

    // Firstmate closes it in its chat: the next snapshot leaves it out, and every count drops.
    await go("Inbox");
    await file([{ id: TASK, title: "Export listing as CSV 9c2e", backlog: "in_flight", state: "working" }]);
    await browser.waitUntil(() => browser.execute((sel: string) => document.querySelector(sel) === null, itemSel(TASK, KEY)), { timeout: 15000, timeoutMsg: "the item never left" });
    await waitInPage(() => document.querySelector('section[data-page="inbox"]')?.textContent?.includes("Nothing waiting on you.") === true, "the Inbox never said nothing waits");
    const after = await counts();
    expect(after.sidebar).toBe("");
    expect(after.tray.includes(" · ")).toBe(false);

    expect(runLog("crew: answer copied").length).toBe(1);
    for (const needle of ["9c2e", "Approved"]) expect(runLog(needle)).toEqual([]);

    // Reopened, then Answer with REST-9c2e.
    await file([{ id: TASK, title: "Export listing as CSV 9c2e", backlog: "in_flight", state: "parked", decisions: [{ key: KEY, summary: QUESTION }] }]);
    await browser.waitUntil(() => browser.execute((sel: string) => document.querySelector(sel) !== null, itemSel(TASK, KEY)), { timeout: 30000, timeoutMsg: "the reopened decision never came back" });
    expect(await copiedLine(TASK, KEY)).toBeNull();
    await press(TASK, KEY, "r");
    await typeAndCopy("REST-9c2e");
    await browser.waitUntil(() => clipboard() === `On ${TASK} (${KEY}): REST-9c2e`, { timeout: 15000, timeoutMsg: `the answer never reached the clipboard; it holds ${clipboard()}` });
    await answered();
    expect(standInStdin()).toBe("");
  });

  it("AC-12: the first mate stopped, then not launchable", async () => {
    for (const w of workspaces("firstmate")) herdr(SESSION, "workspace", "close", w.workspace_id);
    await go("Inbox");
    await browser.waitUntil(() => browser.execute((sel: string) => document.querySelector(sel) !== null, itemSel(TASK, KEY)), { timeout: 15000, timeoutMsg: "the decision is not in the Inbox" });
    await press(TASK, KEY, "d");
    await typeAndCopy("not before Monday-9c2e");
    await browser.waitUntil(() => clipboard() === `On ${TASK} (${KEY}): Denied — not before Monday-9c2e`, { timeout: 15000, timeoutMsg: `the denial never reached the clipboard; it holds ${clipboard()}` });
    await browser.waitUntil(() => workspaces("firstmate").length === 1, { timeout: 15000, timeoutMsg: "the launcher never made the first mate's workspace" });
    await browser.waitUntil(() => standInRuns().length === 2, { timeout: 15000, timeoutMsg: "the stand-in never started in the new workspace" });
    expect(standInRuns()).toEqual(["0", "0"]);
    await answered();
    expect(standInStdin()).toBe("");
    await go("Crew");
    expect((await counts()).crew).toBe("1 waiting on you");

    // Stopped again, and a required tool gone: the line is still copied; nothing is launched.
    for (const w of workspaces("firstmate")) herdr(SESSION, "workspace", "close", w.workspace_id);
    removeStubTool(tools, "tasks-axi");
    expect(await invoke("refresh_readings")).toBe("ok:null");
    const callsBefore = calls();
    await go("Inbox");
    await press(TASK, KEY, "a");
    await browser.waitUntil(() => clipboard() === `On ${TASK} (${KEY}): Approved — go ahead.`, { timeout: 15000, timeoutMsg: "the approval never reached the clipboard" });
    await waitInPage(() => document.body.textContent?.includes("tasks-axi isn't installed — run kinas crew setup") === true, "the notice never named the missing tool");
    expect(workspaces("firstmate")).toEqual([]);
    expect(new Set(calls())).toEqual(new Set(["fm-fleet-snapshot.sh --json"]));
    expect(calls().length).toBeGreaterThanOrEqual(callsBefore.length);
    expect(await copiedLine(TASK, KEY)).toMatch(/^Copied \d\d:\d\d/);
    await go("Crew");
    expect((await counts()).crew).toBe("1 waiting on you");
    restoreNpmStubTool(tools, "tasks-axi");
    expect(await invoke("refresh_readings")).toBe("ok:null");
  });

  it("AC-14: held tasks take the same actions, keyed by the task", async () => {
    await go("Inbox");
    await file([
      { id: HELD_LIVE, title: "Land the readme 9c2e", backlog: "in_flight", state: "done", target: `${SESSION}:${workerPane()}`, held: "Approve landing branch fm/held-live-9c2e? 9c2e" },
      { id: HELD_GONE, title: "Merge the payouts fix 9c2e", backlog: "in_flight", held: "Merge before the freeze? 9c2e", body: `Origin: ${TASK}` },
    ]);
    await browser.waitUntil(
      () => browser.execute((a: string, b: string) => document.querySelector(a) !== null && document.querySelector(b) !== null, itemSel(HELD_LIVE, HELD_LIVE), itemSel(HELD_GONE, HELD_GONE)),
      { timeout: 30000, timeoutMsg: "the held tasks never reached the Inbox" },
    );
    const held = JSON.parse(
      (await browser.execute(() =>
        JSON.stringify(
          [...document.querySelectorAll('section[data-page="inbox"] [data-section="held"] li.inbox-item')].map((el) => ({
            verb: el.getAttribute("data-verb"),
            context: el.querySelector(".ui-inbox-context")?.textContent?.replace(/ · just now$/, ""),
            buttons: [...el.querySelectorAll("button")].map((b) => b.textContent),
          })),
        ),
      )) as string,
    );
    expect(held).toHaveLength(2);
    for (const h of held) {
      expect(h.verb).toBe("captain-hold");
      expect(h.buttons).toEqual(["DenyD", "AnswerR", "ApproveA"]);
    }

    focusElsewhere();
    await press(HELD_GONE, HELD_GONE, "a");
    await browser.waitUntil(() => clipboard() === `On ${HELD_GONE}: Approved — go ahead.`, { timeout: 15000, timeoutMsg: `the held approval never reached the clipboard; it holds ${clipboard()}` });
    await browser.waitUntil(() => focusedLabel() === "firstmate", { timeout: 20000, timeoutMsg: "the first mate was never focused" });
    await answered();

    await go("Inbox");
    await press(HELD_LIVE, HELD_LIVE, "r");
    await typeAndCopy("ok-9c2e");
    await browser.waitUntil(() => clipboard() === `On ${HELD_LIVE}: ok-9c2e`, { timeout: 15000, timeoutMsg: `the held answer never reached the clipboard; it holds ${clipboard()}` });
    await answered();
    expect(new Set(calls())).toEqual(new Set(["fm-fleet-snapshot.sh --json"]));
    expect(standInStdin()).toBe("");
    expect(runLog("9c2e")).toEqual([]);
  });
});
