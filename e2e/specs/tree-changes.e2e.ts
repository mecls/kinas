import { browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hook, typeLine, waitForShell } from "../helpers.ts";
import { README_TEXT, TOKEN } from "./tree-changes.setup.ts";

// Tree changes (tasks/tree-changes/prd.md §5): marks in the sidebar's tree as files are written, deleted and put
// back, with their words, roll-ups and the caption; then Refresh and a reload clear them, and the terminal pane is the
// same process throughout. Everything is read inside the page: a lookup costs seconds under this driver. The steps are
// the PRD's, numbered as it numbers them; the ones about the Changes view arrive with it.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const repo = join(root, "repo");
const README = `README-${TOKEN}.md`;
const NEW = `new-${TOKEN}.md`;
const OLD = `old-${TOKEN}.md`;
/** The PRD's ceiling for a mark to appear or go (rule 7 allows 1 s; 2 s leaves room for the driver). */
const CEILING = 2000;
/** Set it to keep the proof: `KINAS_E2E_SHOTS=<folder> bun e2e/run.ts tree-changes`. */
const SHOTS = process.env.KINAS_E2E_SHOTS;

function kinas(...args: string[]) {
  const result = spawnSync(CLI, args, { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

interface Row {
  name: string;
  path: string;
  label: string | null;
  mark: string | null;
  rollup: string | null;
  gone: boolean;
  /** The mark as drawn: its colour (`data-mark`) and its letter or count. */
  drawn: string | null;
  tooltip: string | null;
}

/** The sidebar's Files rows as the page draws them, nested ones included, in order. */
const rows = () =>
  browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".sidebar .reader-files .tree-row")].map((row) => {
      const button = row.querySelector<HTMLButtonElement>(".tree-item")!;
      const mark = row.querySelector<HTMLElement>(".ui-change-mark");
      return {
        name: [...button.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(""),
        path: button.title,
        label: button.getAttribute("aria-label"),
        mark: row.dataset.mark ?? null,
        rollup: row.dataset.rollup ?? null,
        gone: row.dataset.gone !== undefined,
        drawn: mark ? `${mark.dataset.mark} ${mark.textContent}` : null,
        tooltip: mark?.title ?? null,
      };
    }),
  ) as Promise<Row[]>;

const row = async (name: string) => (await rows()).find((r) => r.name === name);
const caption = () => browser.execute(() => document.querySelector(".sidebar .reader-files .tree-since")?.textContent ?? null);
const marked = async () => (await rows()).filter((r) => r.mark !== null || r.rollup !== null).map((r) => `${r.name} ${r.drawn}${r.gone ? " gone" : ""}`);

async function until(check: () => Promise<boolean>, what: string, timeout = CEILING) {
  await browser.waitUntil(check, { timeout, interval: 100, timeoutMsg: `${what} within ${timeout} ms: ${JSON.stringify(await rows())}` });
}

/** The baseline time the caption names. */
async function since(): Promise<string> {
  const line = await caption();
  const time = /since (\d\d:\d\d)$/.exec(line ?? "")?.[1];
  if (!time) throw new Error(`the caption says ${JSON.stringify(line)}`);
  return time;
}

/** Files on `folder`, once its tree lists `name` — by path: `repo` and `plain` both hold a README of that name. */
/** The reader's Changes view, as drawn: whether it shows, its summary, its rows as `kind sign text`, its refusal. */
const changes = () =>
  browser.execute(() => {
    const doc = document.querySelector<HTMLElement>("aside.reader .reader-doc");
    return {
      showing: doc?.dataset.view === "changes",
      summary: doc?.querySelector(".ui-diff-summary")?.textContent ?? null,
      rows: [...(doc?.querySelectorAll<HTMLElement>(".ui-diff-row:not([hidden])") ?? [])].map(
        (r) => `${r.dataset.kind} ${r.querySelector(".ui-diff-sign")?.textContent ?? ""} ${r.querySelector("code")?.textContent ?? ""}`,
      ),
      refusal: doc?.querySelector(".ui-diff-refusal")?.textContent ?? null,
      views: [...document.querySelectorAll<HTMLButtonElement>("aside.reader .reader-view .reader-view-button")].map((b) => `${b.getAttribute("aria-label")}${b.getAttribute("aria-pressed") === "true" ? "*" : ""}`),
    };
  });

/** Clicks a row of the sidebar's Files by its button's title (the path). */
const clickRow = (path: string) =>
  browser.execute((p: string) => [...document.querySelectorAll<HTMLButtonElement>(".sidebar .reader-files .tree-item")].find((b) => b.title === p)!.click(), path);

/** Local HH:MM, as the caption says it. */
const clock = (ms: number) => {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
};

/** The sidebar's Files has no mark, no caption and no deleted row. */
async function unmarked() {
  return browser.execute(() => ({
    marks: document.querySelectorAll(".sidebar .reader-files .ui-change-mark").length,
    caption: document.querySelector(".sidebar .reader-files .tree-since")?.textContent ?? null,
    gone: document.querySelectorAll(".sidebar .reader-files .tree-row[data-gone]").length,
  }));
}

async function openInFiles(folder: string, name: string) {
  if (kinas("open", folder).code !== 0) throw new Error(`kinas open ${folder} failed`);
  const path = join(root, folder, name);
  await until(async () => (await rows()).some((r) => r.path === path), `Files listing ${folder}`, 20000);
}

describe("Tree changes", () => {
  /** The terminal pane's process at step 1: nothing here may restart it (ADR 0002). */
  let pid = 0;

  before(async () => {
    await waitForShell();
  });

  it("1: a folder just shown in Files has no marks and no caption", async () => {
    pid = await hook<number>("ptyPid");
    await openInFiles("repo", README);
    // Its baseline is taken in the background; give it a moment, so the writes below land after it.
    await browser.pause(500);
    expect(await marked()).toEqual([]);
    expect(await caption()).toBeNull();
  });

  it("2: a new file is A within 2 s, with its words, and the head says 1 change since the tree was shown", async () => {
    writeFileSync(join(repo, NEW), `# New ${TOKEN}\n`);
    await until(async () => (await row(NEW))?.mark === "A", `${NEW} marked A`);
    const at = await since();
    expect(await caption()).toBe(`1 change since ${at}`);
    expect(await row(NEW)).toEqual({ name: NEW, path: join(repo, NEW), label: `${NEW}, added since ${at}`, mark: "A", rollup: null, gone: false, drawn: "A A", tooltip: `${NEW}, added since ${at}` });
  });

  it("3 (the mark): a line appended in the pane is M, and the button's text and title are what they were", async () => {
    await typeLine(`printf 'A line from the pane.\\n' >> '${join(repo, README)}'`);
    await until(async () => (await row(README))?.mark === "M", `${README} marked M`);
    const r = (await row(README))!;
    expect([r.name, r.path, r.drawn]).toEqual([README, join(repo, README), "M M"]);
    expect(await caption()).toBe(`2 changes since ${await since()}`);
  });

  it("3 (the view): the marked row opens the reader on Changes — +1 −0, the new line with its + — and the toggle switches", async () => {
    await clickRow(join(repo, README));
    await until(async () => (await changes()).showing && (await changes()).summary !== null, "the reader on Changes", 10000);
    const at = await since();
    const view = await changes();
    expect(view.summary).toBe(`+1 −0 since ${at}`);
    expect(view.rows).toEqual([`context  # Repo ${TOKEN}`, "context  ", "context  The committed text.", "add + A line from the pane."]);
    expect(view.views).toEqual(["Rendered", "Source", "Changes*"]);
    // Rendered leaves Changes; Changes comes back to it.
    await browser.execute(() => document.querySelector<HTMLButtonElement>('aside.reader .reader-view-button[aria-label="Rendered"]')!.click());
    await until(async () => !(await changes()).showing, "the reader back on Rendered", 5000);
    expect((await changes()).views).toEqual(["Rendered*", "Source", "Changes"]);
    await browser.execute(() => document.querySelector<HTMLButtonElement>('aside.reader .reader-view-button[aria-label="Changes"]')!.click());
    await until(async () => (await changes()).showing, "the reader on Changes again", 5000);
    if (SHOTS) await browser.saveScreenshot(join(SHOTS, "tree-changes-slice-5.png"));
  });

  it("4 (marks and roll-up): a file deleted in a collapsed folder rolls up as a red 1; expanded, it is struck through with D", async () => {
    rmSync(join(repo, "docs", OLD));
    await until(async () => (await row("docs"))?.rollup === "1", "docs rolled up");
    const at = await since();
    expect(await row("docs")).toMatchObject({ drawn: "D 1", label: `docs, 1 change inside since ${at}`, mark: null, gone: false });
    expect(await caption()).toBe(`3 changes since ${at}`);

    await browser.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".sidebar .reader-files .tree-dir")].find((b) => b.title.endsWith("/repo/docs"))!.click(),
    );
    await until(async () => (await row(OLD)) !== undefined, `${OLD} drawn in docs`, 5000);
    expect(await row(OLD)).toEqual({ name: OLD, path: join(repo, "docs", OLD), label: `${OLD}, deleted since ${at}`, mark: "D", rollup: null, gone: true, drawn: "D D", tooltip: `${OLD}, deleted since ${at}` });
    if (SHOTS) await browser.saveScreenshot(join(SHOTS, "tree-changes-slice-2.png"));
  });

  it("5: the file written back to its old text loses its M within 2 s, and the reader drops to its usual view", async () => {
    expect((await changes()).showing).toBe(true);
    const at = await since();
    writeFileSync(join(repo, README), README_TEXT);
    await until(async () => (await row(README))?.mark === null, `${README} unmarked`);
    expect(await caption()).toBe(`2 changes since ${await since()}`);
    await until(async () => !(await changes()).showing, "the reader off Changes", 5000);
    expect((await changes()).views).toEqual(["Rendered*", "Source"]);
    const said = await hook<string>("readerStatusLog");
    expect(said.split("\n")).toContain(`No changes since ${at} any more`);
  });

  it("6: made and removed while Files showed another folder is no row; the deletion is still there", async () => {
    await openInFiles("plain", `README-${TOKEN}.md`);
    expect(await marked()).toEqual([]);
    rmSync(join(repo, NEW));
    await browser.pause(500);
    await openInFiles("repo", README);
    await until(async () => (await row(NEW)) === undefined, `${NEW} gone without a row`);
    expect(await marked()).toEqual(["docs D 1"]);
    expect(await caption()).toBe(`1 change since ${await since()}`);
  });

  it("9: a write under node_modules or to a dot-file makes no mark", async () => {
    writeFileSync(join(repo, "node_modules", `x-${TOKEN}.md`), `# Hidden, changed ${TOKEN}\n`);
    writeFileSync(join(repo, `.hidden-${TOKEN}.md`), `# Hidden ${TOKEN}\n`);
    // Then one that does mark, so waiting for it proves the others had their chance.
    writeFileSync(join(repo, `after-${TOKEN}.md`), `# After ${TOKEN}\n`);
    await until(async () => (await row(`after-${TOKEN}.md`))?.mark === "A", "the control file marked A");
    // Folders first, as the tree sorts; docs is collapsed again, since Files was on plain in between.
    expect(await marked()).toEqual(["docs D 1", `after-${TOKEN}.md A A`]);
  });

  it("AC-5 (a big file): Kinas kept no copy of a file over 4 MB, so its Changes view says why instead of a diff", async () => {
    await openInFiles("plain", `big-${TOKEN}.md`);
    const big = join(root, "plain", `big-${TOKEN}.md`);
    writeFileSync(big, `# Big ${TOKEN}, now small\n`);
    await until(async () => (await rows()).some((r) => r.path === big && r.mark === "M"), "the big file marked M");
    await clickRow(big);
    await until(async () => (await changes()).refusal !== null, "the big file's refusal", 10000);
    const plainSince = await since();
    expect(await changes()).toMatchObject({ showing: true, summary: null, rows: [] });
    expect((await changes()).refusal).toBe(`Kinas kept no copy of this file from ${plainSince}, so there is nothing to compare — it is larger than 4 MB`);
    expect((await rows()).find((r) => r.path === big)?.mark).toBe("M");
    await openInFiles("repo", README);
  });

  it("7: ↻ clears the tree — marks, caption, deleted rows — and a later write counts from the refresh", async () => {
    const button = () =>
      browser.execute(() => {
        const b = document.querySelector<HTMLButtonElement>(".sidebar .reader-files .sidebar-section-head .tree-refresh");
        return b ? { label: b.getAttribute("aria-label"), title: b.title, marked: b.dataset.marked !== undefined, opacity: getComputedStyle(b).opacity } : null;
      });
    // While the tree has marks, the ↻ is in sight without pointing at the head.
    expect(await button()).toEqual({ label: "Refresh repo", title: "Refresh repo: clear its changes and start counting again", marked: true, opacity: "1" });
    // Expanded, so the deleted row is on screen to be cleared.
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".sidebar .reader-files .tree-dir")].find((b) => b.title.endsWith("/repo/docs"))!.click());
    await until(async () => (await row(OLD))?.gone === true, `${OLD} drawn struck through`, 5000);

    const pressed = Date.now();
    await browser.execute(() => document.querySelector<HTMLButtonElement>(".sidebar .reader-files .tree-refresh")!.click());
    // Field by field: an object's key order does not survive the WebDriver wire.
    await until(async () => {
      const u = await unmarked();
      return u.marks === 0 && u.caption === null && u.gone === 0;
    }, "the tree cleared");
    expect((await button())?.marked).toBe(false);

    await browser.pause(500);
    writeFileSync(join(repo, `later-${TOKEN}.md`), `# Later ${TOKEN}\n`);
    await until(async () => (await row(`later-${TOKEN}.md`))?.mark === "A", "a write after the refresh marked A");
    expect([clock(pressed), clock(pressed + 60_000)]).toContain(await since());
    expect(await marked()).toEqual([`later-${TOKEN}.md A A`]);
  });

  it("12: the terminal pane is the process it was at step 1", async () => {
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("13, last: a window reload clears every record; the folder shown again is unmarked, from a new baseline", async () => {
    expect((await marked()).length).toBeGreaterThan(0);
    await browser.execute(() => location.reload());
    // Past the old page, whose hooks would otherwise answer for the new one.
    await browser.pause(1000);
    await waitForShell(60000);
    const reloaded = Date.now();
    await openInFiles("repo", README);
    await browser.pause(500);
    expect(await unmarked()).toEqual({ marks: 0, caption: null, gone: 0 });
    writeFileSync(join(repo, `after-reload-${TOKEN}.md`), `# After the reload ${TOKEN}\n`);
    await until(async () => (await row(`after-reload-${TOKEN}.md`))?.mark === "A", "a write after the reload marked A");
    expect([clock(reloaded - 60_000), clock(reloaded), clock(reloaded + 60_000)]).toContain(await since());
    expect(await marked()).toEqual([`after-reload-${TOKEN}.md A A`]);
  });
});
