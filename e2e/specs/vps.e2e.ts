import { $, browser, expect } from "@wdio/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LABEL, plantHerdrRelease, setCompanion, setDown, TARGET } from "../fake-vps/make.ts";
import { APP_LOG, herdr, herdrSnapshot } from "../helpers.ts";
import { VPS_SESSION } from "./vps.setup.ts";

// Agents on a VPS (tasks/cloud-factory, build spec §12 slice 1.5; ADRs 0022–0024), against the fake VPS of
// vps.setup.ts: a stub ssh in place of /usr/bin/ssh, the CLI this run built as the machine's `.local/bin/kinas`, and the
// companion's reading from fixtures/companion-bundle.synthetic.json. Case 1, the tracer bullet: the place set in
// Settings, the door's argv exactly as ADR 0024 fixes it, the Reachable row, and the Crew board drawn from the VPS.
// Case 2, Journey C (slice 2.4): the machine stops answering and comes back — the board keeps its last reading, the
// status bar's VPS part goes connected → reconnecting → unreachable → connected, and Refresh readings has the companion
// read the fake Firstmate home there. The Work page's chrome says the same: unreachable since, the pane dimmed.
// Case 3, slice 3.3: the Work pane attaches the "VPS's" Herdr — the throwaway session `kinas-e2e-vps`, through
// KINAS_E2E_HERDR_REMOTE=local — its chrome naming the place first, and Launch the first mate runs the launcher there
// through the companion: the workspace made in Firstmate's home on that side, the stand-in `claude` typed exactly, and
// a second launch focusing it without typing again.
// Case 4, slice 4.4: setup — with no companion there, Settings gives the bootstrap (no Linux build of this version is
// published yet, so the two steps by hand, with the target in them); with it back, the checks table, and Install Herdr
// puts the fake VPS's pinned stand-in in place (its SHA-256 checked) and the row turns green.

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
const go = (label: "Crew" | "Settings" | "Home" | "Work") =>
  browser.execute(
    (l: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")]
        .find((b) => (b.querySelector(".ui-nav-label")?.textContent ?? b.textContent?.trim()) === l)!
        .click(),
    label,
  );

/** The log written since this spec's app started (vps.setup.ts's KINAS_E2E_LOG_FROM). */
const logSinceStart = () => readFileSync(APP_LOG).subarray(Number(process.env.KINAS_E2E_LOG_FROM ?? "0")).toString("utf8");

/** The Work page's chrome: its session line, its detached badge's words, and whether the pane is dimmed. */
const chrome = () => {
  const c = document.querySelector('section[data-page="work"] .work > .ui-termchrome');
  return c
    ? {
        session: c.querySelector(".ui-termchrome-session")?.textContent ?? "",
        detached: c.querySelector("[data-detached]")?.textContent ?? null,
        dim: document.querySelector('section[data-page="work"] .work-terminal')?.classList.contains("term-detached") ?? false,
      }
    : null;
};

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
    // The Work page's chrome says what the bar says, at the bar's own time, over a dimmed pane.
    const time = /unreachable since (\d\d:\d\d)/.exec(down.title)![1];
    const away = await waitInPage(chrome, (c) => c?.detached?.startsWith("unreachable") === true && c.dim, "the chrome never said unreachable");
    expect(away.detached).toBe(`unreachable since ${time}`);

    // It answers again: Refresh readings reads at once, and the bar says so.
    setDown(dataDir, false);
    expect(await refresh()).toBe("ok");
    await waitInPage(part, (p) => p?.state === "connected", "the bar never said connected again");
    expect(await browser.execute(cards)).toBe(board);
    await waitInPage(chrome, (c) => c?.detached === null && c.dim === false, "the chrome never cleared its badge");

    const log = logSinceStart();
    expect(log).toMatch(/remote: refresh ok in \d+ ms/);
    expect(log).toMatch(/remote: bundle failed \(timeout\) in \d+ ms/);
    expect(log).toMatch(/crew: remote reading failed in \d+ ms/);
    expect(log.includes(TARGET) || log.includes("fake-vps")).toBe(false);
  });

  it("attaches the VPS's session in the Work pane, and launches the first mate there through the companion (slice 3)", async () => {
    const herdrCalls = join(dataDir, "fake-vps", "herdr.log");
    const root = join(dataDir, "fake-vps", "companion");
    const argvLog = join(root, "bin", "argv.log");
    const runs = () => (existsSync(argvLog) ? readFileSync(argvLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const firstMates = () => herdrSnapshot(VPS_SESSION).workspaces.filter((w) => w.label === "firstmate");
    const focusedLabel = () => {
      const s = herdrSnapshot(VPS_SESSION);
      return s.workspaces.find((w) => w.workspace_id === s.focused_workspace_id)?.label ?? null;
    };

    // Saving the place in case 1 started the pane again on the VPS: Herdr's client, its chrome naming the place first.
    await go("Work");
    await waitInPage(chrome, (c) => c?.session.startsWith(`${LABEL} · default`) === true && c.detached === null && !c.dim, "the Work pane never attached the VPS");
    expect(logSinceStart()).toContain(`terminal: attaching ${LABEL}'s default session`);
    expect(firstMates()).toEqual([]);

    // Launch the first mate: the companion makes the workspace in Firstmate's home there and types exactly its program.
    await go("Crew");
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const b = [...document.querySelectorAll<HTMLButtonElement>('section[data-page="crew"] .crew[data-crew="installed"] .ui-titlerow button')].find((x) => x.textContent === "Launch the first mate");
          b?.click();
          return b !== undefined;
        }),
      { timeout: 30000, interval: 500, timeoutMsg: "the Crew page never offered Launch the first mate" },
    );
    await browser.waitUntil(() => runs().length === 1, { timeout: 20000, timeoutMsg: "the stand-in never ran on the VPS" });
    // ADR 0026: the program with Kinas's relay instruction, its one flag and the file.
    expect(runs()).toEqual(["2 --append-system-prompt-file"]);
    const made = firstMates();
    expect(made.length).toBe(1);
    expect(focusedLabel()).toBe("firstmate");
    const pane = herdrSnapshot(VPS_SESSION).panes.find((p) => p.workspace_id === made[0]!.workspace_id)!;
    const asked = readFileSync(herdrCalls, "utf8").trim().split("\n");
    expect(asked).toContain(`workspace create --cwd ${join(root, "firstmate")} --label firstmate --focus`);
    expect(asked).toContain(`pane run ${pane.pane_id} ${join(root, "bin", "claude")} --append-system-prompt-file ${join(root, "share", "first-mate-relay.md")}`);
    // Only the companion's seven calls ever reached the "VPS's" Herdr: the five actions, and setup's status read.
    expect(
      asked.filter((a) => !/^(api snapshot|pane process-info --pane \S+|workspace focus \S+|workspace create --cwd .+ --label .+ --focus|pane run \S+ .+|status --json)$/.test(a)),
    ).toEqual([]);
    expect(asked).not.toContain("server stop");

    // The chrome reads the VPS's focused workspace.
    await go("Work");
    await waitInPage(chrome, (c) => c?.session === `${LABEL} · default · firstmate`, "the chrome never named the first mate's workspace");

    // From another workspace, a second launch focuses the first mate and types nothing.
    herdr(VPS_SESSION, "workspace", "create", "--cwd", root, "--label", "elsewhere", "--focus");
    expect(focusedLabel()).toBe("elsewhere");
    const again = await browser.execute(() =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("crew_launch").then(
        (v) => String(v),
        (e: unknown) => `refused ${JSON.stringify(e)}`,
      ),
    );
    expect(again).toBe("focused");
    expect(focusedLabel()).toBe("firstmate");
    expect(firstMates().length).toBe(1);
    expect(runs()).toEqual(["2 --append-system-prompt-file"]);

    const log = logSinceStart();
    expect(log).toMatch(/remote: launch-first-mate ok in \d+ ms/);
    expect(log).toMatch(/crew: launched \(created\) in \d+ ms/);
    expect(log).toMatch(/crew: launched \(focused\) in \d+ ms/);
    expect(log.includes(TARGET) || log.includes("fake-vps")).toBe(false);
  });

  it("sets the VPS up: the bootstrap while no companion answers, then Install Herdr turns its row green (slice 4.4)", async () => {
    const setup = () => document.querySelector('section[data-page="settings"] [data-setting="place.setup"]')?.textContent ?? "";
    const bootstrap = () => document.querySelector('section[data-page="settings"] [data-setting="place.bootstrap"]')?.textContent ?? "";
    const herdrRow = () => {
      const r = document.querySelector('section[data-page="settings"] tr[data-check="herdr"]');
      return r ? { text: r.textContent ?? "", state: r.querySelector(".place-check")?.getAttribute("data-state") ?? null } : null;
    };
    /** Check again, once the last check has finished (while one runs the button says Checking…). */
    const checkAgain = async () => {
      const button = () => [...document.querySelectorAll<HTMLButtonElement>('[data-setting="place.reachable"] button')].some((b) => b.textContent === "Check again" && !b.disabled);
      await waitInPage(button, (v) => v, "Check again never came back");
      await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>('[data-setting="place.reachable"] button')].find((b) => b.textContent === "Check again")!.click());
    };

    // No companion there: ssh runs, `kinas` is not found, and Settings gives the bootstrap.
    setCompanion(dataDir, false);
    await go("Settings");
    await waitInPage(reachable, (t) => t.includes("connected") || t.includes("can't reach"), "Settings never checked the VPS");
    await checkAgain();
    await waitInPage(reachable, (t) => t.includes("Kinas is not installed there"), "the Reachable row never said the companion is missing");
    const words = await waitInPage(bootstrap, (t) => t.includes("published yet"), "the bootstrap never showed");
    expect(words).toContain("No Linux build of Kinas 0.1.0 is published yet");
    expect(words).toContain("bun scripts/build-cli.ts --target bun-linux-x64");
    expect(words).toContain(`scp dist/kinas-linux-x64 ${TARGET}:.local/bin/kinas`);
    expect(await browser.execute(setup)).toContain("Once Kinas answers there.");

    // The companion back, and Herdr not yet installed there: its row offers Install.
    setCompanion(dataDir, true);
    plantHerdrRelease(join(dataDir, "fake-vps", "companion"));
    await checkAgain();
    const before = await waitInPage(herdrRow, (r) => r !== null && r.text.includes("not installed"), "the Herdr row never said not installed");
    expect(before!.state).toBe("bad");
    expect(before!.text).toContain("Install Herdr");
    expect(await browser.execute(bootstrap)).toContain("Kinas answers there.");
    // Kinas never reads the key's value; here it is not set.
    expect(await browser.execute(setup)).toContain("ANTHROPIC_API_KEYnot set");

    await browser.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>('tr[data-check="herdr"] button')].find((b) => b.textContent === "Install Herdr")!.click(),
    );
    const after = await waitInPage(herdrRow, (r) => r !== null && r.state === "ok", "the Herdr row never turned green after Install", 60000);
    expect(after!.text).toContain("0.9.5 · installed by Kinas");
    expect(readFileSync(join(dataDir, "fake-vps", "companion", "bin", "herdr"), "utf8")).toContain("herdr 0.9.5");

    const log = logSinceStart();
    expect(log).toMatch(/setup: install herdr on vps-e2e/);
    expect(log).toMatch(/remote: install ok in \d+ ms/);
    expect(log.includes(TARGET) || log.includes("fake-vps")).toBe(false);
  });
});
