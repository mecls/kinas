import { $, browser, expect } from "@wdio/globals";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFakeHome } from "../fake-firstmate/make.ts";
import { removeStubTool } from "../stub-tools/make.ts";
import { fakeHome, logLines } from "../helpers.ts";

// Settings grouped, and the crew's install as the app sees it (build spec AC-1's app half, §4 Settings and Crew page):
// not installed, then installed (the fake home, whose commit is not the pin, so it reads as moved), a wrong backend, and
// a missing tool that blocks Launch — against stub tools, never this Mac's own.

const dataDir = process.env.KINAS_DATA_DIR!;
const tools = join(dataDir, "tools");

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

/** A click in the page on a sidebar row by its text. */
const go = (label: "Crew" | "Settings" | "Home") =>
  browser.execute((l: string) => {
    const row = [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim() === l);
    row!.click();
  }, label);

const invoke = (command: string) =>
  browser.execute(
    (cmd: string) => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(cmd).then(() => null, (r: unknown) => String(r)),
    command,
  );

/** The Crew card's rows, read in one go. */
const crewCard = () => {
  const card = document.querySelector('section[data-page="settings"] [data-section="crew"]');
  const rows: Record<string, string> = {};
  for (const tr of card?.querySelectorAll("table.crew-tools tbody tr") ?? []) rows[tr.getAttribute("data-tool") ?? "?"] = tr.querySelector(".ui-badge")?.textContent ?? "";
  const kv: Record<string, string> = {};
  const dts = [...(card?.querySelectorAll(".crew-kv dt") ?? [])];
  for (const dt of dts) kv[dt.textContent ?? ""] = dt.nextElementSibling?.textContent ?? "";
  return {
    text: card?.textContent ?? "",
    tools: rows,
    kv,
    projects: [...(card?.querySelectorAll(".crew-projects li") ?? [])].map((li) => li.textContent),
  };
};

/** Shows Settings afresh, so its cards read again. */
async function reshowSettings() {
  await go("Home");
  await go("Settings");
}

describe("Settings grouped, and the crew's install", () => {
  it("groups the cards into six sections, every card keeping its data-section", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    await go("Settings");
    const groups = await waitInPage(
      () =>
        [...document.querySelectorAll('section[data-page="settings"] .settings-group')].map((g) => [
          g.getAttribute("data-group"),
          g.querySelector(".ui-section-head h2")?.textContent,
          [...g.querySelectorAll("[data-section]")].map((c) => c.getAttribute("data-section")).join(","),
        ]),
      (g) => g.length === 6,
      "Settings never showed six groups",
    );
    expect(groups).toEqual([
      ["providers", "Providers", "claude,ollama,convex,hostinger"],
      ["crew", "Crew", "crew"],
      ["client-folders", "Client folders", "projects,folders"],
      ["shortcuts", "Shortcuts", "shortcuts,hotkey"],
      ["appearance", "Appearance", "appearance"],
      ["advanced", "Advanced", "menu-bar,login,org,reader,cli"],
    ]);
  });

  it("not installed: the card and the Crew page say how, and show the tools", async () => {
    const card = await waitInPage(crewCard, (c) => c.text.includes("Not installed"), "the Crew card never said not installed");
    expect(card.text).toContain("Not installed — run kinas crew setup in the Work pane");
    expect(card.tools).toEqual({
      treehouse: "installed",
      "no-mistakes": "installed",
      "gh-axi": "installed",
      "tasks-axi": "installed",
      "quota-axi": "installed",
      "chrome-devtools-axi": "installed",
      "lavish-axi": "installed",
      gh: "signed in",
    });
    await go("Crew");
    const setup = await waitInPage(
      () => {
        const crew = document.querySelector('section[data-page="crew"] .crew[data-crew="uninstalled"]');
        return { text: crew?.querySelector('[data-testid="crew-setup"]')?.textContent ?? "", tools: crew?.querySelectorAll("table.crew-tools tbody tr").length ?? 0 };
      },
      (s) => s.tools === 8,
      "the Crew page never showed setup and the tools",
    );
    expect(setup.text).toContain("Set up the crew — run this in the Work pane: kinas crew setup");
    expect(setup.text).toContain("Copy");
  });

  it("installed: the moved commit, the home, the backend, the prerequisites, away and the projects' modes", async () => {
    // What `kinas crew setup` would leave, with a project registered and the away record present.
    const home = makeFakeHome(dataDir, "crew-snapshot.empty.synthetic.json");
    mkdirSync(join(home, "projects", "shop-9c2e"), { recursive: true });
    writeFileSync(join(home, "fixtures", "mode-shop-9c2e"), "direct-PR on\n");
    writeFileSync(join(home, "state", ".afk-contract"), "the captain's words, which Kinas never reads\n");
    writeFileSync(join(home, "fixtures", "afk-entered"), "2026-09-24T21:10:00Z\n");
    writeFileSync(join(home, "fixtures", "afk-expected_return"), "2026-09-25T07:00:00Z\n");
    // The health read before the home existed is kept 60 s; "Refresh readings" asks again.
    expect(await invoke("refresh_readings")).toBeNull();
    await reshowSettings();
    const card = await waitInPage(crewCard, (c) => "Commit" in c.kv && c.projects.length === 1, "the Crew card never showed the install");
    expect(card.kv.Commit).toMatch(/^[0-9a-f]{7} — moved from f9f74a1 \(\/updatefirstmate\); Kinas reads it at its snapshot contract$/);
    expect(card.kv.Home.endsWith("/firstmate")).toBe(true);
    expect(card.kv.Backend).toBe("herdr");
    expect(card.kv.Prerequisites).toBe("git, gh, node, npm, jq, python3, herdr, claude — all found");
    expect(card.kv.Away).toMatch(/^since \d\d:\d\d · back \d\d:\d\d$/);
    expect(card.projects).toEqual(["shop-9c2e · direct-PR · yolo on"]);
    expect(card.text).toContain("Modes, the project list and away mode are the first mate's: ask in its pane.");
  });

  it("a backend other than herdr is named, and red", async () => {
    writeFileSync(join(fakeHome(), "config", "backend"), "tmux\n");
    await reshowSettings();
    const card = await waitInPage(crewCard, (c) => c.kv.Backend === "tmux — Kinas expects herdr", "the Crew card never named the wrong backend");
    expect(card.kv.Backend).toBe("tmux — Kinas expects herdr");
    writeFileSync(join(fakeHome(), "config", "backend"), "herdr\n");
  });

  it("a missing required tool blocks Launch with its one line, and its row reads missing", async () => {
    removeStubTool(tools, "tasks-axi");
    expect(await invoke("refresh_readings")).toBeNull();
    await reshowSettings();
    const card = await waitInPage(crewCard, (c) => c.tools["tasks-axi"] === "missing", "Settings never showed tasks-axi missing");
    expect(card.tools["tasks-axi"]).toBe("missing");
    await go("Crew");
    const launch = await waitInPage(
      () => {
        const crew = document.querySelector('section[data-page="crew"] .crew[data-crew="installed"]');
        const button = [...(crew?.querySelectorAll<HTMLButtonElement>(".ui-titlerow button") ?? [])].find((b) => b.textContent === "Launch the first mate");
        return { disabled: button?.getAttribute("aria-disabled") ?? null, title: button?.title ?? null, line: crew?.querySelector(".crew-blocked")?.textContent ?? null };
      },
      (l) => l.disabled === "true",
      "Launch never blocked",
    );
    expect(launch).toEqual({
      disabled: "true",
      title: "tasks-axi isn't installed — run kinas crew setup",
      line: "tasks-axi isn't installed — run kinas crew setup",
    });
  });

  it("ran only Firstmate's read-only scripts and no npm tool, and logged nothing about the crew", async () => {
    const fmCalls = new Set(readFileSync(join(fakeHome(), "state", "calls.log"), "utf8").trim().split("\n"));
    const allowed = /^(fm-fleet-snapshot\.sh --json|fm-project-mode\.sh shop-9c2e|fm-afk-contract\.sh field (entered|expected_return))$/;
    expect([...fmCalls].filter((call) => !allowed.test(call))).toEqual([]);
    expect(fmCalls.has("fm-project-mode.sh shop-9c2e")).toBe(true);
    const toolCalls = existsSync(join(tools, "calls.log")) ? readFileSync(join(tools, "calls.log"), "utf8") : "";
    for (const npmTool of ["gh-axi", "tasks-axi", "quota-axi", "chrome-devtools-axi", "lavish-axi"]) expect(toolCalls).not.toContain(`${npmTool} `);
    expect(toolCalls).not.toContain("setup hooks");
    expect(logLines("9c2e")).toEqual([]);
  });
});
