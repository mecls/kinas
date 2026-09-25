import { browser, expect } from "@wdio/globals";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hook, openReaderMenu, runReaderMenuItem, typeLine, waitForShell } from "../helpers.ts";
import { BRANCH, git, OLD_TEXT, PUSHING_TEXT, README_TEXT, TOKEN } from "./tree-changes.setup.ts";

// Tree changes (tasks/tree-changes/prd.md §5): marks in the sidebar's tree as files are written, deleted and put
// back, with their words, roll-ups and the caption; then Refresh and a reload clear them, and the terminal pane is the
// same process throughout. Everything is read inside the page: a lookup costs seconds under this driver. The steps are
// the PRD's, numbered as it numbers them; the ones about the Changes view arrive with it.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const repo = join(root, "repo");
/** A repository with a remote, its branch pushed with -u (tasks/tree-changes-push/prd.md). */
const pushing = join(root, "pushing");
const README = `README-${TOKEN}.md`;
const NEW = `new-${TOKEN}.md`;
const OLD = `old-${TOKEN}.md`;
/** The PRD's ceiling for a mark to appear or go (rule 7 allows 1 s; 2 s leaves room for the driver). */
const CEILING = 2000;
/** Set it to keep the proof: `KINAS_E2E_SHOTS=<folder> bun e2e/run.ts tree-changes`. */
const SHOTS = process.env.KINAS_E2E_SHOTS;
const LOG = join(homedir(), "Library/Logs/ai.sintralabs.kinas/kinas.log");
/** Every line tree changes may write (rule 26): counts, durations and an error's kind — never a path, never text. */
const COUNT_LINES = [
  /^tree changes: baseline taken in \d+ ms, \d+ copies, \d+ bytes$/,
  /^tree changes: rescanned \d+ entries in \d+ ms$/,
  /^tree changes: a slow walk, \d+ entries in \d+ ms$/,
  /^tree changes: exported \d+ bytes in \d+ ms$/,
  /^tree changes: could not watch a folder \([a-z ]+\)$/,
  // Tree changes clear on push.
  /^tree changes: a push cleared \d+ marks in \d+ ms$/,
  /^tree changes: a refresh cleared \d+ marks, \d+ left, in \d+ ms$/,
  /^tree changes: could not watch a repository's refs \([a-z ]+\)$/,
];

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

/** The real clipboard, read and put back as reader-panel.e2e does: this spec copies a deleted file's text onto it. */
const utf8 = { ...process.env, LANG: "en_US.UTF-8" };
const pbpaste = () => execFileSync("/usr/bin/pbpaste", { encoding: "utf8", env: utf8 });
const pbcopy = (text: string) => execFileSync("/usr/bin/pbcopy", { input: text, env: utf8 });

/** The reader's ▾ menu, item by item: label, whether it is disabled, and why. */
const menuItems = async () => {
  await openReaderMenu();
  return browser.execute(() =>
    [...document.querySelectorAll<HTMLButtonElement>('.reader-menu [role="menuitem"]')].map((b) => `${b.textContent?.trim()}${b.getAttribute("aria-disabled") === "true" ? ` (${b.getAttribute("title")})` : ""}`),
  ) as Promise<string[]>;
};

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
  /** Where the log stood when the spec began: step 11 reads only what this run wrote. */
  let logFrom = 0;
  /** When `push 1` pushed: `push 2`'s mark counts from then. */
  let pushedAt = 0;

  before(async () => {
    logFrom = existsSync(LOG) ? statSync(LOG).size : 0;
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

  it("4 (the click) and AC-2: the deleted row opens on what it said then; Copy and Download rescue it; the rest says it was deleted", async () => {
    await clickRow(join(repo, "docs", OLD));
    const lead = () => browser.execute(() => document.querySelector("aside.reader .ui-diff-lead")?.textContent ?? null);
    await until(async () => (await changes()).showing && (await lead()) !== null, "the deleted file on Changes", 10000);
    const at = await since();
    const view = await changes();
    expect(await lead()).toBe(`Deleted since ${at} — what it said then`);
    expect(view.summary).toBe(`+0 −5 since ${at}`);
    expect(view.rows).toEqual(OLD_TEXT.trimEnd().split("\n").map((line) => `remove − ${line}`));
    expect(view.views).toEqual(["Changes*"]);
    expect(await browser.execute(() => document.querySelector(".reader-path")?.textContent)).toBe(`repo/docs/${OLD}`);

    const saved = pbpaste();
    try {
      await browser.execute(() => document.querySelector<HTMLButtonElement>(".reader-copy-main")!.click());
      await browser.waitUntil(() => pbpaste() === OLD_TEXT, { timeout: 10000, timeoutMsg: "the clipboard never held the deleted file's text" });
    } finally {
      pbcopy(saved);
    }

    expect(await menuItems()).toEqual(["Download as .md", "Print as PDF (This file was deleted)", "Open in editor (This file was deleted)", "Pin (This file was deleted)"]);
    const to = process.env.KINAS_E2E_EXPORT_TO!;
    await runReaderMenuItem("Download as .md");
    await browser.waitUntil(() => existsSync(to), { timeout: 10000, timeoutMsg: "Download never wrote the deleted file's text" });
    expect(readFileSync(to, "utf8")).toBe(OLD_TEXT);
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

  it("the timing (rule 7): the median from a write on disk to its mark on screen, over 10 writes, is under 1 s", async () => {
    // Stamped in the page, as the DOM change that draws each mark lands — never by the driver's polling, which costs
    // more than what it would measure, and not at an animation frame, which WebKit does not run for a window that is
    // off screen, as the e2e window may be. Date.now on both sides: the spec and the page share the Mac's clock.
    await browser.execute(() => {
      const seen: Record<string, number> = {};
      (window as unknown as { __markSeen: Record<string, number> }).__markSeen = seen;
      new MutationObserver(() => {
        const at = Date.now();
        for (const row of document.querySelectorAll<HTMLElement>(".sidebar .reader-files .tree-row[data-mark]")) {
          const path = row.querySelector<HTMLButtonElement>(".tree-item")?.title;
          if (path && !(path in seen)) seen[path] = at;
        }
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-mark"] });
    });
    const written: Record<string, number> = {};
    for (let i = 1; i <= 10; i++) {
      const path = join(repo, `timed-${i}-${TOKEN}.md`);
      written[path] = Date.now();
      writeFileSync(path, `# Timed ${i} ${TOKEN}\n`);
      await until(async () => (await rows()).some((r) => r.path === path && r.mark === "A"), `timed-${i} marked A`);
      // Apart, so each write is a burst of its own and not a ride on the one before.
      await browser.pause(300);
    }
    const seen = (await browser.execute(() => (window as unknown as { __markSeen: Record<string, number> }).__markSeen)) as Record<string, number>;
    expect(Object.keys(written).filter((path) => !(path in seen))).toEqual([]);
    const took = Object.entries(written).map(([path, at]) => seen[path]! - at);
    const median = [...took].sort((a, b) => a - b).slice(4, 6).reduce((a, b) => a + b, 0) / 2;
    console.log(`tree changes timing: write to mark ${took.join(", ")} ms; median ${median} ms`);
    expect(took.filter((ms) => ms < 0)).toEqual([]);
    expect(median).toBeLessThan(1000);
  });

  it("7: ↻ clears the tree — marks, caption, deleted rows — and a later write counts from the refresh", async () => {
    const button = () =>
      browser.execute(() => {
        const b = document.querySelector<HTMLButtonElement>(".sidebar .reader-files .sidebar-section-head .tree-refresh");
        return b ? { label: b.getAttribute("aria-label"), title: b.title, marked: b.dataset.marked !== undefined, opacity: getComputedStyle(b).opacity } : null;
      });
    // While the tree has marks, the ↻ is in sight without pointing at the head.
    expect(await button()).toEqual({ label: "Refresh repo", title: "Refresh repo: clear what's pushed or can't be pushed", marked: true, opacity: "1" });
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

  it("push 1: a commit keeps a mark, and a push clears it within 2 s", async () => {
    await openInFiles("pushing", README);
    await browser.pause(500);
    expect(await marked()).toEqual([]);
    writeFileSync(join(pushing, README), `${PUSHING_TEXT}A line not pushed yet ${TOKEN}.\n`);
    await until(async () => (await row(README))?.mark === "M", `${README} marked M`);
    // A push would clear it, and its words say so.
    expect((await row(README))?.label).toBe(`${README}, modified since ${await since()}, not pushed`);
    git(pushing, "commit", "-q", "-am", "an edit");
    // A commit moves no remote-tracking ref: nothing may clear the mark, however long it waits.
    await browser.pause(CEILING);
    expect((await row(README))?.mark).toBe("M");
    pushedAt = Date.now();
    git(pushing, "push", "-q");
    await until(async () => (await row(README))?.mark === null && (await caption()) === null, "the pushed file unmarked, and no caption");
    // Back where step 13 expects Files to be.
    await openInFiles("repo", README);
  });

  it("push 2: edited again, the M counts from the push, and Changes shows only the new line", async () => {
    await openInFiles("pushing", README);
    expect(await marked()).toEqual([]);
    writeFileSync(join(pushing, README), `${PUSHING_TEXT}A line not pushed yet ${TOKEN}.\nAnother line ${TOKEN}.\n`);
    await until(async () => (await row(README))?.mark === "M", `${README} marked M again`);
    const at = await since();
    expect([clock(pushedAt), clock(pushedAt + 60_000)]).toContain(at);
    expect((await row(README))?.label).toBe(`${README}, modified since ${at}, not pushed`);
    await clickRow(join(pushing, README));
    await until(async () => (await changes()).showing && (await changes()).summary !== null, "the reader on Changes", 10000);
    const view = await changes();
    // Against the pushed text: the line that went up in push 1 is context now, not an addition.
    expect(view.summary).toBe(`+1 −0 since ${at}`);
    expect(view.rows.filter((r) => !r.startsWith("context"))).toEqual([`add + Another line ${TOKEN}.`]);
    await openInFiles("repo", README);
  });

  it("push 3: ↻ clears what git ignores and keeps what waits for a push; the palette says how many", async () => {
    await openInFiles("pushing", README);
    // README is still M from push 2, waiting for a push.
    await until(async () => (await row(README))?.mark === "M", `${README} still M`);
    mkdirSync(join(pushing, "notes"), { recursive: true });
    writeFileSync(join(pushing, "notes", `x-${TOKEN}.md`), `# Ignored ${TOKEN}\n`);
    await until(async () => (await row("notes"))?.mark === "A", "the ignored folder marked A");
    // Git ignores it: no push will clear it, and its words do not say "not pushed".
    expect((await row("notes"))?.label).toMatch(/^notes, added since \d\d:\d\d$/);
    expect(await browser.execute(() => document.querySelector<HTMLButtonElement>(".sidebar .reader-files .tree-refresh")?.title)).toBe("Refresh pushing: clear what's pushed or can't be pushed");

    await browser.execute(() => document.querySelector<HTMLButtonElement>(".sidebar .reader-files .tree-refresh")!.click());
    await until(async () => (await row("notes"))?.mark === null, "the ignored folder cleared");
    expect(await marked()).toEqual([`${README} M M`]);

    // The palette's Refresh files does what ↻ does, and says what is left.
    await browser.waitUntil(
      async () => {
        await browser.keys(["Meta", "k"]);
        return (await browser.execute(() => document.querySelector(".palette") !== null)) || (await browser.pause(500), await browser.execute(() => document.querySelector(".palette") !== null));
      },
      { timeout: 20000, interval: 1000, timeoutMsg: "⌘K never opened the palette" },
    );
    await browser.execute(() => document.querySelector<HTMLButtonElement>('[data-command="files.refresh"]')!.click());
    await browser.waitUntil(async () => (await browser.execute(() => document.querySelector('[data-testid="palette-output"]')?.textContent ?? null)) !== null, { timeout: 10000, timeoutMsg: "Refresh files printed nothing" });
    expect(await browser.execute(() => document.querySelector('[data-testid="palette-output"]')?.textContent)).toBe("1 change not pushed yet");
    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => !(await browser.execute(() => document.querySelector(".palette") !== null)), { timeout: 5000, timeoutMsg: "the palette stayed open" });
    expect(await marked()).toEqual([`${README} M M`]);
  });

  it("push 4: a pull of text already on the remote marks nothing", async () => {
    // Someone else's push, from a clone outside the projects folder.
    const other = join(dirname(root), `other-${TOKEN}`);
    git(dirname(root), "clone", "-q", "-b", BRANCH, join(dirname(root), `remote-${TOKEN}.git`), other);
    const plan = join("docs", `plan-${TOKEN}.md`);
    writeFileSync(join(other, plan), `# Plan ${TOKEN}\n\nFrom elsewhere ${TOKEN}.\n`);
    git(other, "commit", "-q", "-am", "from elsewhere");
    git(other, "push", "-q");
    rmSync(other, { recursive: true, force: true });

    git(pushing, "pull", "-q", "--ff-only");
    expect(readFileSync(join(pushing, plan), "utf8")).toContain(`From elsewhere ${TOKEN}.`);
    await browser.pause(CEILING);
    // docs is collapsed: a mark on the plan would roll up on it.
    expect(await marked()).toEqual([`${README} M M`]);
    await openInFiles("repo", README);
  });

  it("the push timing (tree changes clear on push, rule 4): the median from a push to its mark gone, over 10 pushes, is under 1 s", async () => {
    await openInFiles("pushing", README);
    const path = join(pushing, README);
    // Stamped in the page as the DOM change that takes each mark away lands, as the write timing stamps its marks.
    await browser.execute((p: string) => {
      const gone: number[] = [];
      (window as unknown as { __unmarkedAt: number[] }).__unmarkedAt = gone;
      const markedNow = () => [...document.querySelectorAll<HTMLElement>(".sidebar .reader-files .tree-row")].some((row) => row.querySelector<HTMLButtonElement>(".tree-item")?.title === p && row.dataset.mark !== undefined);
      let was = markedNow();
      new MutationObserver(() => {
        const is = markedNow();
        if (was && !is) gone.push(Date.now());
        was = is;
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-mark"] });
    }, path);
    const pushed: number[] = [];
    for (let i = 1; i <= 10; i++) {
      writeFileSync(path, `${PUSHING_TEXT}Timed push ${i} ${TOKEN}.\n`);
      await until(async () => (await row(README))?.mark === "M", `timed push ${i}: ${README} marked M`);
      git(pushing, "commit", "-q", "-am", `timed push ${i}`);
      git(pushing, "push", "-q");
      // When `git push` has exited: the refs are written, and the mark may go.
      pushed.push(Date.now());
      await until(async () => (await row(README))?.mark === null, `timed push ${i}: ${README} unmarked`);
      await browser.pause(300);
    }
    const gone = (await browser.execute(() => (window as unknown as { __unmarkedAt: number[] }).__unmarkedAt)) as number[];
    expect(gone.length).toBe(10);
    const took = pushed.map((at, i) => gone[i]! - at);
    const median = [...took].sort((a, b) => a - b).slice(4, 6).reduce((a, b) => a + b, 0) / 2;
    console.log(`tree changes timing: push to unmark ${took.join(", ")} ms; median ${median} ms`);
    expect(median).toBeLessThan(1000);
    await openInFiles("repo", README);
  });

  it("12: the terminal pane is the process it was at step 1", async () => {
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("13: a window reload clears every record; the folder shown again is unmarked, from a new baseline", async () => {
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

  it("11, after the rest: the log holds counts alone — none of the fixture's names, none of its text", async () => {
    const all = existsSync(LOG) ? readFileSync(LOG) : Buffer.alloc(0);
    // A log that filled during the run was rotated, and starts again from nothing.
    const written = (all.length >= logFrom ? all.subarray(logFrom) : all).toString("utf8");
    // Every name in the fixture carries the token, and so does every text but these.
    // Tree changes clear on push: the branch (which carries the token too, and is named here to say so) and the pushed text.
    const found = [TOKEN, BRANCH, "The committed text.", "A line from the pane.", "A line of a long file.", "A folder that is not a repository.", "What the remote holds."].filter((needle) => written.includes(needle));
    expect(found).toEqual([]);
    const ours = written
      .split("\n")
      .filter((line) => line.includes("tree changes:"))
      .map((line) => line.slice(line.indexOf("tree changes:")).trimEnd());
    expect(ours.filter((line) => !COUNT_LINES.some((shape) => shape.test(line)))).toEqual([]);
    expect(ours.some((line) => line.startsWith("tree changes: baseline taken"))).toBe(true);
    expect(ours.some((line) => line.startsWith("tree changes: exported"))).toBe(true);
  });
});
