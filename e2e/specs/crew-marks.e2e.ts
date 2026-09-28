import { browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitForShell } from "../helpers.ts";
import { git, TOKEN, worktreeOf } from "./crew-marks.setup.ts";

// Crew marks (tasks/crew-marks/prd.md §5): what the first mate's crew has changed in its own worktree and not pushed,
// marked on the captain's own tree with a hollow dot. Everything is read inside the page: a lookup costs seconds under
// this driver. The steps are the PRD's, numbered as it numbers them.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const worktree = worktreeOf(root);
const README = `README-${TOKEN}.md`;
/** The PRD's ceiling for a mark to appear or go (rule 18 allows 1 s; 2 s leaves room for the driver). */
const CEILING = 2000;

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

async function until(check: () => Promise<boolean>, what: string, timeout = CEILING) {
  await browser.waitUntil(check, { timeout, interval: 100, timeoutMsg: `${what} within ${timeout} ms: ${JSON.stringify(await rows())}` });
}

async function openInFiles(folder: string, name: string) {
  if (kinas("open", folder).code !== 0) throw new Error(`kinas open ${folder} failed`);
  const path = join(root, folder, name);
  await until(async () => (await rows()).some((r) => r.path === path), `Files listing ${folder}`, 20000);
}

describe("Crew marks", () => {
  before(async () => {
    await waitForShell();
  });

  it("crew 1: the captain's folder, with nothing unpushed in the crew's worktree, shows no crew mark", async () => {
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

  it("crew 5: the crew commits and pushes, and within 2 s its marks and its row go", async () => {
    git(worktree, "add", "-A");
    git(worktree, "commit", "-q", "-m", "the crew's work");
    await browser.pause(CEILING);
    // A commit is not a push: both marks stay.
    expect((await crewMarked()).length).toBe(2);
    git(worktree, "push", "-q");
    await until(async () => (await crewMarked()).length === 0 && (await crewCaption()) === null, "the crew's marks gone after its push");
  });
});
