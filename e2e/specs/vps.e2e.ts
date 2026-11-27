import { $, browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inboxNotes, setInboxHandled, setSnapshot, writeSnapshot } from "../fake-firstmate/make.ts";
import { LABEL, PHONE_URL, plantHerdrRelease, plantSandbox, setCompanion, setDown, TARGET } from "../fake-vps/make.ts";
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
// Case 5, slice 4.14 (ADR 0028): a worker on the VPS reports done with a `.claude` and a `.mcp.json` planted in its
// worktree. This build's own companion scans the folder as files, the bundle carries the scan, and the card and the task
// detail say so in red — while the repository's own `.claude` file, the same in the clone, is not named.
// Case 7, slice 6.3 (AC-3; ADRs 0027, 0033): an answer from the Mac is a note in Firstmate's inbox on the VPS. While a
// task's process runs outside Kinas's sandbox, Approve says why and writes no note. Sandboxed, Approve writes one note
// with the line on stdin only, and the item reads answered from the Mac, its three actions gone; once the first mate has handled the note and replied, the item reads read, with the reply.
// The words are in the inbox there and nowhere else: not the Mac's store, its log, the door's argv or the companion's
// record.

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
const go = (label: "Crew" | "Settings" | "Home" | "Work" | "Inbox") =>
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
    await $('[data-section="place"] input[aria-label="Machine label"]').addValue(LABEL);
    await $('[data-section="place"] button[aria-label="Save the Linux machine"]').click();

    const row = await waitInPage(reachable, (t) => t.includes("connected"), "the Reachable row never said connected");
    expect(row).toContain("connected · Kinas 0.1.0 there");
    // The stub tools' herdr says no version, so this Mac's reads as not installed and the two are not compared.
    expect(row).toContain("Herdr 0.9.5 there · not installed here");
    const pressed = await browser.execute(() =>
      [...document.querySelectorAll('[data-setting="place.where"] button[aria-pressed="true"]')].map((b) => b.textContent?.trim()),
    );
    expect(pressed).toEqual(["Linux machine"]);

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

  it("says before landing that a worker's worktree holds a .claude and a .mcp.json that aren't the repository's (slice 4.14)", async () => {
    const TASK = "scan-plant-9c2e";
    const fmHome = join(dataDir, "fake-vps", "companion", "firstmate");
    const clone = join(fmHome, "projects", "shop-9c2e");
    const worktree = join(dataDir, "fake-vps", "treehouse", "shop-9c2e-1", "shop-9c2e");
    const put = (root: string, path: string, text: string) => {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    // The repository's own `.claude/notes.md`, in its clone and in the worktree alike; then the worker's plants.
    put(clone, ".claude/notes.md", "the repository's own\n");
    put(worktree, ".claude/notes.md", "the repository's own\n");
    put(worktree, "sub/.claude/x", "x\n");
    put(worktree, "sub/.mcp.json", "{}\n");
    // The row as Firstmate prints it once the worker has reported (measured on the home lab, 2026-11-25): its status
    // log's last event is `done` while the row still reads the pane as busy. No branch and no PR: only the scan speaks.
    writeSnapshot(
      fmHome,
      JSON.stringify({
        schema: "fm-fleet-snapshot.v1",
        generated: new Date().toISOString(),
        backlog: {
          records: [
            { structured: true, id: TASK, title: "Plant a .claude 9c2e", kind: "ship", state: "in_flight", repo: "shop-9c2e", pr_url: null, body_excerpt: `Delivery: direct-pr ${TASK}.`, captain_actionable: false },
          ],
        },
        tasks: [
          {
            id: TASK,
            kind: "ship",
            harness: "claude",
            mode: "direct-pr",
            yolo: "off",
            project: "__FM_HOME__/projects/shop-9c2e",
            backend: "herdr",
            paths: {
              worktree: { path: worktree, present: true },
              report: { path: null, present: false },
              status_log: { path: `__FM_HOME__/state/${TASK}.status`, present: true, kind: "event_history", last_event: { state: "done", note: `ready in branch fm/${TASK}`, raw: `done: ready in branch fm/${TASK}`, age_seconds: 5 } },
            },
            current_state: { state: "working", source: "pane", detail: "harness busy (fm-spawn)", observed_at: new Date().toISOString() },
            pr: { url: null },
            hints: { pending_decision: false, blocked_event: false, open_decisions: [] },
          },
        ],
        main_inventory: { orphan_in_flight: [] },
      }),
    );

    await go("Crew");
    const refreshed = await browser.execute(() =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("refresh_readings").then(
        () => "ok",
        (e: unknown) => String(e),
      ),
    );
    expect(refreshed).toBe("ok");

    // The card: the scan's line, in the review flag's red text, and no review-flag line of its own (nothing committed).
    const lines = await waitInPage(
      () => {
        const c = document.querySelector('section[data-page="crew"] article.crew-card[data-task="scan-plant-9c2e"]');
        return c ? JSON.stringify({ scan: c.querySelector('[data-testid="crew-scan"]')?.textContent ?? null, review: c.querySelector('[data-testid="crew-review"]')?.textContent ?? null }) : null;
      },
      (v) => v !== null && JSON.parse(v).scan !== null,
      "the card never said what the worktree holds",
      60000,
    );
    expect(JSON.parse(lines!)).toEqual({ scan: "worktree holds .claude/ and .mcp.json that aren't the repository's — review before landing", review: null });
    // Red: the line's computed colour is the one `var(--danger)` gives in the same card.
    const colours = await browser.execute(() => {
      const card = document.querySelector('article.crew-card[data-task="scan-plant-9c2e"]')!;
      const line = card.querySelector('[data-testid="crew-scan"]')!;
      const probe = document.createElement("span");
      probe.style.color = "var(--danger)";
      card.appendChild(probe);
      const out = JSON.stringify({ line: getComputedStyle(line).color, danger: getComputedStyle(probe).color });
      probe.remove();
      return out;
    });
    const { line: lineColour, danger } = JSON.parse(colours) as { line: string; danger: string };
    expect(danger).not.toBe("");
    expect(lineColour).toBe(danger);

    // The detail: the same line, and the paths, each one; the repository's own file is not among them.
    await browser.execute(() => (document.querySelector('article.crew-card[data-task="scan-plant-9c2e"]') as HTMLElement).click());
    const detail = await waitInPage(
      () => {
        const d = document.querySelector('aside.shell-panel[data-occupant="task"]:not([hidden]) .crew-detail[data-task="scan-plant-9c2e"]');
        return d
          ? JSON.stringify({
              line: d.querySelector('[data-testid="crew-detail-scan"]')?.textContent ?? null,
              paths: [...d.querySelectorAll('[data-testid="crew-detail-scan-paths"] li')].map((li) => li.textContent),
            })
          : null;
      },
      (v) => v !== null && JSON.parse(v).line !== null,
      "the detail never showed the scan",
    );
    expect(JSON.parse(detail!)).toEqual({
      line: "worktree holds .claude/ and .mcp.json that aren't the repository's — review before landing",
      paths: ["sub/.claude", "sub/.claude/x", "sub/.mcp.json"],
    });

    // What the companion sent and the Mac kept: the scan in the reading on the VPS, the same paths in the store's row.
    const reading = JSON.parse(readFileSync(join(dataDir, "fake-vps", "companion", "state", "reading.json"), "utf8")) as { worktrees?: { task: string; red: string[] }[] };
    expect(reading.worktrees?.find((w) => w.task === TASK)?.red).toEqual(["sub/.claude", "sub/.claude/x", "sub/.mcp.json"]);
    const stored = execFileSync("/usr/bin/sqlite3", [join(dataDir, "kinas.sqlite"), `SELECT worktree_touches FROM crew_tasks WHERE id = '${TASK}'`], { encoding: "utf8" }).trim();
    expect(JSON.parse(stored)).toEqual({ paths: ["sub/.claude", "sub/.claude/x", "sub/.mcp.json"], unknown: false });
  });
  it("shows the Linux machine's host on Usage, its plan in the gauge and its tokens in the counts (slice 5.2)", async () => {
    const root = join(dataDir, "fake-vps", "companion");
    const put = (path: string, text: string) => {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    const session = "0f3a9c2e-1b2c-4d5e-8f90-123456789abc";
    const now = Date.now();
    const lisbon = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now - 60_000));
    // What the companion reads on the Linux machine: the status line's hand-off, the session's transcript, and /proc.
    put("state/claude-rate-limits.json", JSON.stringify({ rate_limits: { five_hour: { used_percentage: 23, resets_at: Math.floor(now / 1000) + 3600 }, seven_day: { used_percentage: 41, resets_at: Math.floor(now / 1000) + 86_400 } }, session_id: session, captured_at: now }));
    put(
      `claude-home/projects/-home-claude-projects-shop-9c2e/${session}.jsonl`,
      `${JSON.stringify({ type: "assistant", timestamp: new Date(now - 60_000).toISOString(), message: { id: "e2e-5-2", model: "claude-opus-5-5-e2e", usage: { input_tokens: 11, cache_read_input_tokens: 100, output_tokens: 7 } } })}\n`,
    );
    put("proc/stat", "cpu  100 0 100 700 100 0 0 0 0 0\n");
    put("proc/meminfo", "MemTotal:       16777216 kB\nMemAvailable:    4194304 kB\n");
    // The earlier cases' readings counted an empty transcript folder, and a count stands for 5 minutes: the reading on
    // disk drops it, as a companion that has just started has none.
    const readingFile = join(root, "state", "reading.json");
    const { usage: _counted, ...rest } = JSON.parse(readFileSync(readingFile, "utf8")) as Record<string, unknown>;
    writeFileSync(readingFile, JSON.stringify(rest));

    const refresh = () =>
      browser.execute(() =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("refresh_readings").then(
          () => "ok",
          (e: unknown) => String(e),
        ),
      );
    await go("Usage");
    expect(await refresh()).toBe("ok");

    // The section, named for the label, after This Mac; CPU is a dash until the companion has two samples.
    const first = await waitInPage(
      () => {
        const s = document.querySelector('section[data-page="usage"] [data-section="linux-host"]');
        const mac = document.querySelector('section[data-page="usage"] [data-section="host"]');
        if (!s) return null;
        const value = (m: string) => s.querySelector(`[data-metric="${m}"] .ui-metric-value`)?.textContent ?? null;
        return JSON.stringify({
          title: s.textContent?.includes("Linux machine") ?? false,
          source: s.querySelector(".ui-caption")?.getAttribute("title") ?? null,
          after: mac ? (mac.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false,
          cpu: value("cpu"),
          memory: value("memory"),
        });
      },
      (v) => v !== null,
      "Usage never showed the Linux machine",
      60000,
    );
    expect(JSON.parse(first!)).toEqual({ title: true, source: LABEL, after: true, cpu: "— all cores", memory: "12.0 GiB of 16.0 GiB used" });

    // The counters moved: busy 100 of 200 over the two readings, 50 %.
    put("proc/stat", "cpu  150 0 150 800 100 0 0 0 0 0\n");
    expect(await refresh()).toBe("ok");
    await waitInPage(
      () => document.querySelector('section[data-page="usage"] [data-section="linux-host"] [data-metric="cpu"] .ui-metric-value')?.textContent ?? null,
      (v) => v === "50% all cores",
      "the Linux machine's CPU never showed",
      60000,
    );

    // The plan's gauge took the Linux machine's status line, its time the transcript's last response; the tokens are
    // the Linux machine's rows, under the label. Only the counts crossed: the store holds no transcript text.
    const sql = (q: string) => execFileSync("/usr/bin/sqlite3", [join(dataDir, "kinas.sqlite"), q], { encoding: "utf8" }).trim();
    expect(sql("SELECT \"window\" || ' ' || used_pct || ' ' || source FROM quotas WHERE subscription = 'claude-plan' ORDER BY \"window\"").split("\n")).toEqual([
      `session 23.0 Claude Code status line · ${LABEL}`,
      `week 41.0 Claude Code status line · ${LABEL}`,
    ]);
    expect(Number(sql("SELECT max(updated_at) FROM quotas WHERE subscription = 'claude-plan'"))).toBeLessThanOrEqual(now - 55_000);
    expect(sql(`SELECT date || ' ' || harness || ' ' || tokens_in || ' ' || tokens_cache_read || ' ' || tokens_out || ' ' || messages FROM usage_daily WHERE machine = '${LABEL}' AND model = 'claude-opus-5-5-e2e'`)).toBe(
      `${lisbon} claude-code 11 100 7 1`,
    );
    const hostRows = sql("SELECT machine FROM hosts ORDER BY machine").split("\n");
    expect(hostRows).toContain(LABEL);
    expect(hostRows.length).toBe(2);
    const log = logSinceStart();
    expect(log.includes("e2e-5-2") || log.includes(session)).toBe(false);
  });

  it("AC-3: delivers an answer from the Mac once, as a note on the Linux machine, and says it was read (slice 6.3)", async () => {
    const TASK = "stock-webhook-9c2e";
    const LINE = `On ${TASK}: Approved — go ahead.`;
    const fmHome = join(dataDir, "fake-vps", "companion", "firstmate");
    const fmCalls = join(fmHome, "state", "calls.log");
    const fmLines = () => (existsSync(fmCalls) ? readFileSync(fmCalls, "utf8").trim().split("\n").filter(Boolean) : []);
    const sql = (q: string) => execFileSync("/usr/bin/sqlite3", [join(dataDir, "kinas.sqlite"), q], { encoding: "utf8" }).trim();
    const refresh = () =>
      browser.execute(() =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("refresh_readings").then(
          () => "ok",
          (e: unknown) => String(e),
        ),
      );
    const item = `section[data-page="inbox"] li.inbox-item[data-task="${TASK}"][data-key="${TASK}"]`;
    /** The item's quiet lines and whether its box is open. */
    const lines = () =>
      browser.execute((sel: string) => {
        const el = document.querySelector(sel);
        return el
          ? JSON.stringify({
              answered: el.querySelector(".inbox-answered")?.textContent ?? null,
              reply: el.querySelector(".inbox-reply")?.textContent ?? null,
              copied: el.querySelector(".inbox-copied")?.textContent ?? null,
              box: el.querySelector("textarea.inbox-answer") !== null,
            })
          : null;
      }, item);
    const click = (label: string) =>
      browser.execute(
        (sel: string, l: string) =>
          [...document.querySelectorAll<HTMLButtonElement>(`${sel} button`)].find((b) => b.textContent?.replace(/[ARD]$/, "").trim() === l)!.click(),
        item,
        label,
      );
    /** The shell's notice, wherever it shows (the reader's status line, or the sidebar's foot), with its kind. */
    const notice = (text: string | RegExp) =>
      waitInPage(
        () =>
          [...document.querySelectorAll<HTMLElement>(".reader-status, .ui-toast.sidebar-notice")].map((n) => JSON.stringify({ text: n.textContent?.trim() ?? "", kind: n.dataset.kind ?? null })),
        (shown) => shown.some((n) => (typeof text === "string" ? JSON.parse(n).text === text : text.test(JSON.parse(n).text))),
        `the notice never said ${text}`,
      ).then((shown) => shown.map((n) => JSON.parse(n) as { text: string; kind: string | null }).find((n) => (typeof text === "string" ? n.text === text : text.test(n.text)))!);

    // The fixture's fleet again, with its held task; a worker's process outside the sandbox on the machine.
    setSnapshot(fmHome, "firstmate-fleet-snapshot.current.synthetic.json");
    plantSandbox(dataDir, TASK);
    expect(await refresh()).toBe("ok");
    await go("Inbox");
    await waitInPage(() => document.querySelector('section[data-page="inbox"] li.inbox-item[data-task="stock-webhook-9c2e"]') !== null, (v) => v, "the held task never reached the Inbox", 60000);

    // The gate (ADR 0027): Approve says why, and no note is written.
    const before = fmLines().length;
    await click("Approve");
    const refused = await notice("stock-webhook-9c2e: python3 runs outside Kinas's sandbox — no answers are sent until it ends");
    expect(refused.kind).toBe("error");
    expect(fmLines().slice(before).filter((l) => l.startsWith("fm-inbox.sh"))).toEqual([]);
    expect(inboxNotes(fmHome)).toEqual({});
    expect(sql("SELECT count(*) FROM crew_answers")).toBe("0");
    expect(JSON.parse((await lines())!)).toEqual({ answered: null, reply: null, copied: null, box: false });

    // Sandboxed: Approve writes one note, the line on its stdin only, and the item reads answered from the Mac.
    plantSandbox(dataDir, null);
    await click("Approve");
    const sent = await notice("Sent to the first mate");
    expect(sent.kind).toBe(null);
    const answeredLine = await waitInPage(
      () => document.querySelector('section[data-page="inbox"] li.inbox-item[data-task="stock-webhook-9c2e"] .inbox-answered')?.textContent ?? null,
      (v) => v !== null,
      "the item never read answered",
    );
    expect(answeredLine).toMatch(/^Answered from the Mac at \d\d:\d\d$/);
    const notes = inboxNotes(fmHome);
    expect(Object.values(notes)).toEqual([LINE]);
    const [id] = Object.keys(notes);
    expect(id).toMatch(/^kinas-[0-9a-f-]{36}$/);
    const noteCalls = fmLines().filter((l) => l.startsWith("fm-inbox.sh note"));
    expect(noteCalls).toEqual([`fm-inbox.sh note --request-id ${id} --json -`]);
    // The question was checked open first, in a fresh reading: the snapshot, then the hold's own check.
    const sinceGate = fmLines().slice(before);
    expect(sinceGate.filter((l) => l.startsWith("fm-captain-hold.sh"))).toEqual([`fm-captain-hold.sh open ${TASK} --distinguish-absent`, `fm-captain-hold.sh open ${TASK} --distinguish-absent`]);

    // The answered item has no actions left to press (1.14): nothing can be answered twice from here, and no further
    // Firstmate call is made. (The refusal itself, Already answered, is Rust's and tested there.)
    const actions = await browser.execute((sel: string) => [...document.querySelectorAll(`${sel} button`)].map((b) => b.textContent?.trim()), item);
    expect(actions).not.toContain("Approve");
    expect(actions).not.toContain("Answer");
    expect(actions).not.toContain("Deny");
    expect(Object.keys(inboxNotes(fmHome))).toEqual([id]);

    // The first mate handles the note and replies; the next reading carries it, and the item says so.
    setInboxHandled(fmHome, true, "On it-9c2e");
    expect(await refresh()).toBe("ok");
    const read = await waitInPage(
      () => {
        const el = document.querySelector('section[data-page="inbox"] li.inbox-item[data-task="stock-webhook-9c2e"]');
        return el ? JSON.stringify({ answered: el.querySelector(".inbox-answered")?.textContent ?? null, reply: el.querySelector(".inbox-reply")?.textContent ?? null }) : null;
      },
      (v) => v !== null && JSON.parse(v).reply !== null,
      "the item never read read by the first mate",
      60000,
    );
    const r = JSON.parse(read!) as { answered: string; reply: string };
    expect(r.answered).toMatch(/^Answered from the Mac at \d\d:\d\d · read by the first mate at \d\d:\d\d$/);
    expect(r.answered.startsWith(answeredLine!)).toBe(true);
    expect(r.reply).toBe("The first mate: On it-9c2e");

    // The Mac's row: the delivery; no words, only the reply.
    expect(sql("SELECT kind || ' ' || origin || ' ' || outcome || ' ' || (delivered_at IS NOT NULL) || ' ' || (read_at IS NOT NULL) || ' ' || COALESCE(reply, '-') FROM crew_answers ORDER BY rowid").split("\n")).toEqual([
      "approve mac delivered 1 1 On it-9c2e",
    ]);
    expect(sql("SELECT DISTINCT item_key FROM crew_answers")).toMatch(new RegExp(`^${TASK}@${TASK}@\\d+$`));
    // The words are in the inbox there and nowhere else.
    const words = "Approved — go ahead";
    expect(execFileSync("/usr/bin/sqlite3", [join(dataDir, "kinas.sqlite"), ".dump"], { encoding: "utf8" }).includes(words)).toBe(false);
    expect(logSinceStart().includes(words)).toBe(false);
    expect(readFileSync(calls, "utf8").includes(words)).toBe(false);
    expect(readFileSync(join(dataDir, "fake-vps", "companion", "state", "answers.jsonl"), "utf8").includes(words)).toBe(false);
    expect(logSinceStart()).toMatch(/crew: answer delivered/);
    expect(logSinceStart()).toMatch(/crew: answer refused \(gate\)/);
  });

  it("pairs a phone: a code and its link on screen for ten minutes, and the cloud learns only the hash (slice 8.1)", async () => {
    await go("Settings");
    await waitInPage(() => document.querySelector('[data-setting="place.pair"] button')?.textContent ?? null, (t) => t === "Pair a phone", "Pair a phone never drew");
    expect(await browser.execute(() => document.querySelector('[data-setting="place.phones"]')?.textContent ?? "")).toContain("No phone is paired.");
    const cloud = join(dataDir, "fake-vps", "cloud.jsonl");

    await $('[data-setting="place.pair"] button').click();
    const shown = await waitInPage(
      () => ({
        digits: document.querySelector('[data-setting="place.pair"] .place-pair-digits')?.textContent ?? null,
        link: document.querySelector('[data-setting="place.pair"] .place-command code')?.textContent ?? null,
        life: [...document.querySelectorAll('[data-setting="place.pair"] .crew-quiet-inline')].map((e) => e.textContent).join(" | "),
      }),
      (v) => v.digits !== null,
      "the pairing code never showed",
    );
    expect(shown.digits).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const code = shown.digits!.replace("-", "");
    expect(shown.link).toBe(`${PHONE_URL}/#pair=${code}`);
    expect(shown.life).toMatch(/^Expires in (9|10) min, at \d\d:\d\d$/);

    // The cloud was told one pairing: a SHA-256 and a time ten minutes on. The code is in none of the places it could leak.
    const lines = readFileSync(cloud, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].op).toBe("startPairing");
    expect(lines[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(lines[0].codeHash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(readFileSync(cloud, "utf8").includes(code)).toBe(false);
    expect(readFileSync(calls, "utf8").includes(code)).toBe(false);
    expect(logSinceStart().includes(code)).toBe(false);
    expect(execFileSync("/usr/bin/sqlite3", [join(dataDir, "kinas.sqlite"), ".dump"], { encoding: "utf8" }).includes(code)).toBe(false);
    expect(readdirSync(join(dataDir, "fake-vps", "companion", "state")).some((f) => readFileSync(join(dataDir, "fake-vps", "companion", "state", f), "utf8").includes(code))).toBe(false);
  });
});
