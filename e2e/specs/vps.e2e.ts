import { $, browser, expect } from "@wdio/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LABEL, setDown, TARGET } from "../fake-vps/make.ts";
import { APP_LOG } from "../helpers.ts";

// Agents on a VPS (tasks/cloud-factory, build spec §12 slice 1.5; ADRs 0022–0024), against the fake VPS of
// vps.setup.ts: a stub ssh in place of /usr/bin/ssh, the CLI this run built as the machine's `.local/bin/kinas`, and the
// companion's reading from fixtures/companion-bundle.synthetic.json. Case 1, the tracer bullet: the place set in
// Settings, the door's argv exactly as ADR 0024 fixes it, the Reachable row, and the Crew board drawn from the VPS.
// Case 2, Journey C (slice 2.4): the machine stops answering and comes back — the board keeps its last reading, the
// status bar's VPS part goes connected → reconnecting → unreachable → connected, and Refresh readings has the companion
// read the fake Firstmate home there.

const dataDir = process.env.KINAS_DATA_DIR!;
const calls = join(dataDir, "fake-vps", "calls.log");
const DOOR = `ssh -T -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=2 -o ControlMaster=auto -o ControlPath=%C -o ControlPersist=60 -- ${TARGET} .local/bin/kinas companion rpc`;
/** The fixture's four cards, as the local path draws the same snapshot: three task records and a backlog-only one. */
const TASKS = ["stock-webhook-9c2e", "harbor-review-9c2e", "harbor-relaunch-9c2e", "shop-receipts-9c2e"];

async function waitInPage<T>(read: () => T, ok: (v: T) => boolean, timeoutMsg: string, timeout = 30000): Promise<T> {
  let last: T | undefined;
  await browser.waitUntil(
    async () => {
      last = (await browser.execute(read)) as T;
      return ok(last);
    },
    { timeout, interval: 300, timeoutMsg: `${timeoutMsg}; last read: ${JSON.stringify(last)}` },
  );
  return last!;
}

/** A click in the page on a sidebar row by its label (the row also carries its chord since the interface polish). */
const go = (label: "Crew" | "Settings" | "Home") =>
  browser.execute(
    (l: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")]
        .find((b) => (b.querySelector(".ui-nav-label")?.textContent ?? b.textContent?.trim()) === l)!
        .click(),
    label,
  );

/** The log written since this spec's app started (vps.setup.ts's KINAS_E2E_LOG_FROM). */
const logSinceStart = () => readFileSync(APP_LOG).subarray(Number(process.env.KINAS_E2E_LOG_FROM ?? "0")).toString("utf8");

const reachable = () => document.querySelector('section[data-page="settings"] [data-setting="place.reachable"]')?.textContent ?? "";

describe("agents on a VPS", () => {
  it("sets the place, reaches the companion through the one door, and draws the board from the VPS", async () => {
    await go("Settings");
    await waitInPage(() => document.querySelector('[data-section="place"] input[aria-label="SSH target"]') !== null, (v) => v, "Where agents run never drew");
    expect(await browser.execute(reachable)).toContain("Agents run on this Mac.");

    await $('[data-section="place"] input[aria-label="SSH target"]').addValue(TARGET);
    await $('[data-section="place"] input[aria-label="VPS label"]').addValue(LABEL);
    await $('[data-section="place"] button[aria-label="Save the VPS"]').click();

    const row = await waitInPage(reachable, (t) => t.includes("connected"), "the Reachable row never said connected");
    expect(row).toContain("connected · Kinas 0.1.0 there");
    // The stub tools' herdr says no version, so this Mac's reads as not installed and the two are not compared.
    expect(row).toContain("Herdr 0.9.5 there · not installed here");
    const pressed = await browser.execute(() =>
      [...document.querySelectorAll('[data-setting="place.where"] button[aria-pressed="true"]')].map((b) => b.textContent?.trim()),
    );
    expect(pressed).toEqual(["VPS"]);

    // Every call went through the door with ADR 0024's argv, word for word; the stub never saw anything else.
    const argvs = readFileSync(calls, "utf8").trim().split("\n");
    expect(argvs.length).toBeGreaterThanOrEqual(2);
    expect(argvs.filter((a) => a !== DOOR)).toEqual([]);

    await go("Crew");
    // The page's state is the VPS's (installed there), not this Mac's, which has no Firstmate home in this spec.
    const ids = await waitInPage(
      () => [...document.querySelectorAll('section[data-page="crew"] article.crew-card')].map((c) => c.getAttribute("data-task")).join(" "),
      (v) => TASKS.every((t) => v.split(" ").includes(t)),
      "the board never drew the VPS's tasks",
    );
    expect(ids.split(" ").sort()).toEqual([...TASKS].sort());
    expect(await browser.execute(() => document.querySelector('[data-testid="crew-setup"]') === null)).toBe(true);

    // The log says what was asked and how it went, never the target, a path or ssh's words (ADR 0007).
    const log = logSinceStart();
    expect(log).toMatch(/remote: hello ok in \d+ ms/);
    expect(log).toMatch(/remote: bundle ok in \d+ ms/);
    expect(log).toMatch(/crew: remote reading in \d+ ms/);
    expect(log.includes(TARGET) || log.includes("fake-vps")).toBe(false);
  });

  it("keeps the board while the VPS is unreachable, says so on the status bar, and reads again when it answers", async () => {
    const part = () => {
      const b = document.querySelector<HTMLButtonElement>('.ui-statusbar [data-part="vps"]');
      return b ? { state: b.dataset.state ?? "", text: b.textContent?.trim() ?? "", title: b.title } : null;
    };
    const cards = () => [...document.querySelectorAll('section[data-page="crew"] article.crew-card')].map((c) => c.getAttribute("data-task")).sort().join(" ");
    const refresh = () =>
      browser.execute(() =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("refresh_readings").then(() => "ok"),
      );
    const fmCalls = join(dataDir, "fake-vps", "companion", "firstmate", "state", "calls.log");

    // Refresh readings: the companion reads now (`refresh`), so the bundle's heartbeat is fresh.
    expect(await refresh()).toBe("ok");
    const up = await waitInPage(part, (p) => p?.state === "connected", "the bar never named the VPS connected");
    expect(up.text).toBe(`${LABEL}connected`);
    expect(up.title).toMatch(new RegExp(`^${LABEL} · connected · last reading \\d\\d:\\d\\d$`));
    await browser.waitUntil(() => existsSync(fmCalls) && readFileSync(fmCalls, "utf8").includes("fm-fleet-snapshot.sh --json"), {
      timeout: 30000,
      timeoutMsg: "the companion never read the fake Firstmate home",
    });
    const board = await waitInPage(cards, (v) => v === [...TASKS].sort().join(" "), "the board lost the VPS's tasks after the companion's own reading");

    // The machine stops answering: the next reading fails, nothing on the board moves.
    setDown(dataDir, true);
    expect(await refresh()).toBe("ok");
    const blip = await waitInPage(part, (p) => p?.state === "reconnecting", "the bar never said reconnecting");
    expect(blip.title).toContain(`can't reach ${LABEL}: timed out`);
    const down = await waitInPage(part, (p) => p?.state === "unreachable", "the bar never said unreachable", 90000);
    expect(down.text).toBe(`${LABEL}unreachable`);
    expect(down.title).toMatch(new RegExp(`^${LABEL} · unreachable since \\d\\d:\\d\\d · last reading \\d\\d:\\d\\d · can't reach ${LABEL}: timed out$`));
    expect(await browser.execute(cards)).toBe(board);

    // It answers again: Refresh readings reads at once, and the bar says so.
    setDown(dataDir, false);
    expect(await refresh()).toBe("ok");
    await waitInPage(part, (p) => p?.state === "connected", "the bar never said connected again");
    expect(await browser.execute(cards)).toBe(board);

    const log = logSinceStart();
    expect(log).toMatch(/remote: refresh ok in \d+ ms/);
    expect(log).toMatch(/remote: bundle failed \(timeout\) in \d+ ms/);
    expect(log).toMatch(/crew: remote reading failed in \d+ ms/);
    expect(log.includes(TARGET) || log.includes("fake-vps")).toBe(false);
  });
});
