import { browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { typeLine, waitForShell } from "../helpers.ts";
import { TOKEN } from "./tree-changes.setup.ts";

// Tree changes (tasks/tree-changes/prd.md §5): a file saved in the pane is marked in the sidebar's tree, with its words
// on the row and a caption under the head. Read inside the page: a lookup costs seconds under this driver.
//
// Slice 1, the tracer bullet: one save, one M. Slice 2 adds the real marks — added, deleted, roll-ups.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const plain = join(root, "plain");
const README = `README-${TOKEN}.md`;
/** Set it to keep the proof: `KINAS_E2E_SHOTS=<folder> bun e2e/run.ts tree-changes`. */
const SHOTS = process.env.KINAS_E2E_SHOTS;

function kinas(...args: string[]) {
  const result = spawnSync(CLI, args, { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The sidebar's Files rows as the page draws them: name, mark, accessible name, tooltip. */
const rows = () =>
  browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".sidebar .reader-files .tree-row")].map((row) => {
      const button = row.querySelector<HTMLButtonElement>(".tree-item")!;
      return {
        name: button.textContent ?? "",
        title: button.title,
        label: button.getAttribute("aria-label"),
        mark: row.dataset.mark ?? null,
        drawn: row.querySelector(".ui-change-mark")?.textContent ?? null,
        tooltip: row.querySelector<HTMLElement>(".ui-change-mark")?.title ?? null,
      };
    }),
  );

const caption = () => browser.execute(() => document.querySelector(".sidebar .reader-files .tree-since")?.textContent ?? null);

describe("Tree changes", () => {
  before(async () => {
    await waitForShell();
  });

  it("a file saved in the pane is marked M in Files, with its words, and the head says 1 change since the tree was shown", async () => {
    expect(kinas("open", "plain").code).toBe(0);
    await browser.waitUntil(async () => (await rows()).some((r) => r.name === README), { timeout: 20000, timeoutMsg: `Files never listed ${README}` });
    // Shown and unchanged: no mark, no caption.
    expect((await rows()).filter((r) => r.mark !== null)).toEqual([]);
    expect(await caption()).toBeNull();

    await typeLine(`printf 'A line from the pane.\\n' >> '${join(plain, README)}'`);
    await browser.waitUntil(async () => (await rows()).some((r) => r.name === README && r.mark === "M"), {
      timeout: 5000,
      timeoutMsg: `${README} was never marked: ${JSON.stringify(await rows())}`,
    });

    const row = (await rows()).find((r) => r.name === README)!;
    const line = await caption();
    const since = /^1 change since (\d\d:\d\d)$/.exec(line ?? "")?.[1];
    if (!since) throw new Error(`the caption says ${JSON.stringify(line)}, not "1 change since HH:MM"`);
    expect(row).toEqual({
      name: README,
      title: join(plain, README),
      label: `${README}, modified since ${since}`,
      mark: "M",
      drawn: "M",
      tooltip: `${README}, modified since ${since}`,
    });
    // The folder's other file was not saved, so it carries nothing.
    expect((await rows()).filter((r) => r.mark !== null).map((r) => r.name)).toEqual([README]);

    if (SHOTS) await browser.saveScreenshot(join(SHOTS, "tree-changes-slice-1.png"));
  });
});
