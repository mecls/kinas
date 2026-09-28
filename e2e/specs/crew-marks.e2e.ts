import { browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hook, waitForShell } from "../helpers.ts";
import { BRANCH, git, TOKEN, worktreeOf } from "./crew-marks.setup.ts";
import { COUNT_LINES } from "./tree-changes.setup.ts";

// Crew marks (tasks/crew-marks/prd.md §5): what the first mate's crew has changed in its own worktree and not pushed,
// marked on the captain's own tree with a hollow dot. Everything is read inside the page: a lookup costs seconds under
// this driver. The steps are the PRD's, numbered as it numbers them.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const worktree = worktreeOf(root);
const README = `README-${TOKEN}.md`;
/** The PRD's ceiling for a mark to appear or go (rule 18 allows 1 s; 2 s leaves room for the driver). */
const CEILING = 2000;
const LOG = join(homedir(), "Library/Logs/ai.sintralabs.kinas/kinas.log");

function kinas(...args: string[]) {
  const result = spawnSync(CLI, args, { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

interface Row {
  name: string;
  path: string;
  label: string | null;
  mark: string | null;
  crew: string | null;
  /** The crew's mark as drawn: its colour and letter, and whether its dot is the ring. */
  crewDrawn: string | null;
  crewTooltip: string | null;
  /** A crew row: a path the captain's folder lacks. */
  crewRow: boolean;
}

/** The sidebar's Files rows as the page draws them. */
const rows = () =>
  browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".sidebar .reader-files .tree-row")].map((row) => {
      const button = row.querySelector<HTMLButtonElement>(".tree-item")!;
      const crew = row.querySelector<HTMLElement>(".ui-change-mark[data-crew]");
      return {
        name: [...button.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(""),
        path: button.title,
        label: button.getAttribute("aria-label"),
        mark: row.dataset.mark ?? null,
        crew: row.dataset.crew ?? null,
        crewDrawn: crew ? `${crew.dataset.mark} ${crew.textContent} ${crew.querySelector(".ui-dot")?.getAttribute("data-kind") ?? crew.querySelector("[data-kind]")?.getAttribute("data-kind") ?? ""}`.trim() : null,
        crewTooltip: crew?.title ?? null,
        crewRow: row.dataset.crewRow !== undefined,
      };
    }),
  ) as Promise<Row[]>;

const row = async (name: string) => (await rows()).find((r) => r.name === name);
const crewMarked = async () => (await rows()).filter((r) => r.crew !== null).map((r) => `${r.name} ${r.crew}${r.crewRow ? " row" : ""}`);
const crewCaption = () => browser.execute(() => document.querySelector(".sidebar .reader-files .tree-crew")?.textContent ?? null);

/** The reader as drawn: which view shows, its summary, its rows as `kind sign text`, and the toggle, pressed with `*`. */
const reader = () =>
  browser.execute(() => {
    const doc = document.querySelector<HTMLElement>("aside.reader .reader-doc");
    return {
      view: doc?.dataset.view ?? null,
      summary: doc?.querySelector(".ui-diff-summary")?.textContent ?? null,
      rows: [...(doc?.querySelectorAll<HTMLElement>(".ui-diff-row:not([hidden])") ?? [])].map(
        (r) => `${r.dataset.kind} ${r.querySelector(".ui-diff-sign")?.textContent ?? ""} ${r.querySelector("code")?.textContent ?? ""}`,
      ),
      views: [...document.querySelectorAll<HTMLButtonElement>("aside.reader .reader-view .reader-view-button")].map((b) => `${b.getAttribute("aria-label")}${b.getAttribute("aria-pressed") === "true" ? "*" : ""}`),
    };
  });
const view = (label: string) => browser.execute((l: string) => document.querySelector<HTMLButtonElement>(`aside.reader .reader-view-button[aria-label="${l}"]`)!.click(), label);
/** Every line the reader said, debug builds only: a 6 s line can come and go between two slow driver lookups. */
const statusLog = () => hook<string>("readerStatusLog");

async function until(check: () => Promise<boolean>, what: string, timeout = CEILING) {
  await browser.waitUntil(check, { timeout, interval: 100, timeoutMsg: `${what} within ${timeout} ms: ${JSON.stringify(await rows())}` });
}

async function openInFiles(folder: string, name: string) {
  if (kinas("open", folder).code !== 0) throw new Error(`kinas open ${folder} failed`);
  const path = join(root, folder, name);
  await until(async () => (await rows()).some((r) => r.path === path), `Files listing ${folder}`, 20000);
}

describe("Crew marks", () => {
  /** The terminal pane's process at crew 1: nothing here may restart it (ADR 0002). */
  let pid = 0;
  /** Where the log stood when the spec began: crew 7 reads only what this run wrote. */
  let logFrom = 0;

  before(async () => {
    logFrom = existsSync(LOG) ? statSync(LOG).size : 0;
    await waitForShell();
  });

  it("crew 1: the captain's folder, with nothing unpushed in the crew's worktree, shows no crew mark", async () => {
    pid = await hook<number>("ptyPid");
    await openInFiles("shop", README);
    // The baseline, the pairing and the crew's first scan run in the background: give them a moment.
    await browser.pause(1000);
    expect(await crewMarked()).toEqual([]);
  });

  it("crew 2: a save in the crew's worktree marks the captain's row with a hollow M within 2 s, in the crew's words", async () => {
    writeFileSync(join(worktree, README), `# Shop ${TOKEN}\n\nWhat the remote holds.\nA line by the crew ${TOKEN}.\n`);
    await until(async () => (await row(README))?.crew === "M", `${README} crew-marked M`);
    const r = (await row(README))!;
    expect(r.mark).toBeNull();
    expect(r.label).toBe(`${README}, modified by the crew, not pushed`);
    expect(r.crewTooltip).toBe(`${README}, modified by the crew, not pushed`);
    expect(r.crewDrawn).toBe("M M ring");
    expect(await crewCaption()).toBe("The crew: 1 change not pushed");
  });

  it("crew 3: a file the crew added, which the captain's folder lacks, is a dimmed crew row with a hollow A", async () => {
    const NOTES = `notes-${TOKEN}.md`;
    writeFileSync(join(worktree, NOTES), `# Notes ${TOKEN}\n`);
    await until(async () => (await row(NOTES))?.crewRow === true, `${NOTES} as a crew row`);
    const r = (await row(NOTES))!;
    expect([r.crew, r.label]).toEqual(["A", `${NOTES}, added by the crew, not pushed — not in your folder`]);
    expect(await crewMarked()).toEqual([`${NOTES} A row`, `${README} M`]);
    expect(await crewCaption()).toBe("The crew: 2 changes not pushed");
  });

  it("crew 4: the captain edits the same file — both marks on its row, a click opens the captain's Changes, The crew's the crew's copy", async () => {
    const captains = join(root, "shop", README);
    writeFileSync(captains, `# Shop ${TOKEN}\n\nWhat the remote holds.\nA line by the captain.\n`);
    await until(async () => (await row(README))?.mark === "M", `${README} marked M by the captain`);
    const r = (await row(README))!;
    expect([r.mark, r.crew, r.crewDrawn]).toEqual(["M", "M", "M M ring"]);
    expect(r.label).toMatch(new RegExp(`^${README.replace(".", "\\.")}, modified since \\d\\d:\\d\\d, not pushed; also modified by the crew, not pushed$`));

    // The captain's own mark decides what a click opens: their Changes.
    await browser.execute((p: string) => [...document.querySelectorAll<HTMLButtonElement>(".sidebar .reader-files .tree-item")].find((b) => b.title === p)!.click(), captains);
    await until(async () => (await reader()).view === "changes" && (await reader()).summary !== null, "the reader on the captain's Changes", 10000);
    const own = await reader();
    expect(own.summary).toMatch(/^\+1 −0 since \d\d:\d\d$/);
    expect(own.rows).toEqual([`context  # Shop ${TOKEN}`, "context  ", "context  What the remote holds.", "add + A line by the captain."]);
    expect(own.views).toEqual(["Rendered", "Source", "Changes*", "The crew's"]);

    await view("The crew's");
    await until(async () => (await reader()).view === "crew", "the reader on the crew's copy", 5000);
    const crews = await reader();
    expect(crews.summary).toBe("+1 −0 The crew's copy, not pushed");
    expect(crews.rows).toEqual([`context  # Shop ${TOKEN}`, "context  ", "context  What the remote holds.", `add + A line by the crew ${TOKEN}.`]);
    expect(crews.views).toEqual(["Rendered", "Source", "Changes", "The crew's*"]);
    expect(await statusLog()).toContain("Read-only: this is the crew's copy");

    // And back: Changes is the captain's again.
    await view("Changes");
    await until(async () => (await reader()).view === "changes", "the reader back on the captain's Changes", 5000);
    expect((await reader()).rows.at(-1)).toBe("add + A line by the captain.");
    await view("The crew's");
    await until(async () => (await reader()).view === "crew", "the reader on the crew's copy again", 5000);
  });

  it("crew 5: the crew commits and pushes, and within 2 s its marks and its row go; the captain's own M stays", async () => {
    git(worktree, "add", "-A");
    git(worktree, "commit", "-q", "-m", "the crew's work");
    await browser.pause(CEILING);
    // A commit is not a push: both marks stay.
    expect((await crewMarked()).length).toBe(2);
    git(worktree, "push", "-q");
    await until(async () => (await crewMarked()).length === 0 && (await crewCaption()) === null, "the crew's marks gone after its push");
    expect((await row(README))?.mark).toBe("M");
    // The reader was on the crew's copy: it leaves it, and says why.
    await until(async () => (await reader()).view !== "crew", "the reader off the crew's copy", 5000);
    expect(await statusLog()).toContain("No changes by the crew any more");
    expect((await reader()).views).not.toContain("The crew's");
  });

  it("the timing (rule 18): the median from a save in the crew's worktree to its hollow mark on screen, over 10 saves, is under 1 s", async () => {
    // Stamped in the page as the DOM change that draws each crew mark lands, as tree-changes.e2e times its own marks —
    // never by the driver's polling, which costs more than what it would measure.
    await browser.execute(() => {
      const seen: Record<string, number> = {};
      (window as unknown as { __crewSeen: Record<string, number> }).__crewSeen = seen;
      new MutationObserver(() => {
        const at = Date.now();
        for (const row of document.querySelectorAll<HTMLElement>(".sidebar .reader-files .tree-row[data-crew]")) {
          const path = row.querySelector<HTMLButtonElement>(".tree-item")?.title;
          if (path && !(path in seen)) seen[path] = at;
        }
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-crew"] });
    });
    const saved: Record<string, number> = {};
    for (let i = 1; i <= 10; i++) {
      const name = `timed-${i}-${TOKEN}.md`;
      saved[join(root, "shop", name)] = Date.now();
      writeFileSync(join(worktree, name), `# Timed ${i} ${TOKEN}\n`);
      await until(async () => (await row(name))?.crew === "A", `${name} crew-marked A`);
      // Apart, so each save is a burst of its own and not a ride on the one before.
      await browser.pause(300);
    }
    const seen = (await browser.execute(() => (window as unknown as { __crewSeen: Record<string, number> }).__crewSeen)) as Record<string, number>;
    expect(Object.keys(saved).filter((path) => !(path in seen))).toEqual([]);
    const took = Object.entries(saved).map(([path, at]) => seen[path]! - at);
    const median = [...took].sort((a, b) => a - b).slice(4, 6).reduce((a, b) => a + b, 0) / 2;
    console.log(`crew marks timing: save to hollow mark ${took.join(", ")} ms; median ${median} ms`);
    expect(took.filter((ms) => ms < 0)).toEqual([]);
    expect(median).toBeLessThan(1000);
    expect(await crewCaption()).toBe("The crew: 10 changes not pushed");
  });

  it("crew 8, before the reload: the terminal pane is the process it was at crew 1", async () => {
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("crew 6: ↻ leaves the crew's marks alone, and a reload shows them again", async () => {
    const crewBefore = await crewMarked();
    expect(crewBefore.length).toBe(10);
    // An ignored note of the captain's, which ↻ clears; their README's M waits for a push, and stays.
    mkdirSync(join(root, "shop", "notes"), { recursive: true });
    writeFileSync(join(root, "shop", "notes", `n-${TOKEN}.md`), `# Note ${TOKEN}\n`);
    await until(async () => (await row("notes"))?.mark === "A", "the captain's ignored folder marked A");
    await browser.execute(() => document.querySelector<HTMLButtonElement>(".sidebar .reader-files .tree-refresh")!.click());
    await until(async () => (await row("notes"))?.mark === null, "the ignored folder cleared by ↻");
    expect((await row(README))?.mark).toBe("M");
    expect(await crewMarked()).toEqual(crewBefore);
    expect(await crewCaption()).toBe("The crew: 10 changes not pushed");

    // A reload drops every record, the crew's too; the folder shown again finds the crew's work again.
    await browser.execute(() => location.reload());
    // Past the old page, whose hooks would otherwise answer for the new one.
    await browser.pause(1000);
    await waitForShell(60000);
    await openInFiles("shop", README);
    await until(async () => (await crewMarked()).length === 10, "the crew's marks back after the reload", 10000);
    expect(await crewMarked()).toEqual(crewBefore);
    expect(await crewCaption()).toBe("The crew: 10 changes not pushed");
    // The captain's own marks start again from the reload: none yet.
    expect((await rows()).filter((r) => r.mark !== null)).toEqual([]);
  });

  it("crew 7, after the rest: the log holds counts alone — no fixture path, branch or text", async () => {
    const all = existsSync(LOG) ? readFileSync(LOG) : Buffer.alloc(0);
    // A log that filled during the run was rotated, and starts again from nothing.
    const written = (all.length >= logFrom ? all.subarray(logFrom) : all).toString("utf8");
    // Every name in the fixture carries the token — the worktree's path and the crew's branch too — and so does every
    // text but these.
    const found = [TOKEN, BRANCH, worktree, "What the remote holds.", "A line by the captain.", "A line by the crew"].filter((needle) => written.includes(needle));
    expect(found).toEqual([]);
    const ours = written
      .split("\n")
      .filter((line) => line.includes("tree changes:"))
      .map((line) => line.slice(line.indexOf("tree changes:")).trimEnd());
    expect(ours.filter((line) => !COUNT_LINES.some((shape) => shape.test(line)))).toEqual([]);
    expect(ours.some((line) => /^tree changes: the crew, \d+ checkouts, \d+ marks in \d+ ms$/.test(line))).toBe(true);
  });
});
