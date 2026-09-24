import { browser, $, $$, expect } from "@wdio/globals";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The component library's stories (DESIGN.md §4, §9): a debug build opened with `#stories` mounts the catalogue
// instead of the app. This proves every component renders every state in both themes, holds a style contract — the
// computed colour, type and radius of one element per component, recorded on the first run into
// fixtures/screens/stories.json and compared on every later one, so a token that drifts is named — and saves the
// page, viewport by viewport, into docs/design/screens/ as the evidence a reader can look at.

// The runner starts wdio from the repository root (e2e/run.ts), as reader-export.e2e.ts relies on too.
const repo = process.cwd();
const contractPath = join(repo, "fixtures/screens/stories.json");
const screens = join(repo, "docs/design/screens");

/** A command's answer, or its refusal (never `{ error }`, the shape of a WebDriver error). */
const invoke = <T>(command: string, args?: Record<string, unknown>) =>
  browser.execute(
    (cmd: string, a: Record<string, unknown> | undefined) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(cmd, a).then(
        (value) => ({ ok: value }),
        (refusal) => ({ refused: String(refusal) }),
      ),
    command,
    args,
  ) as Promise<{ ok?: T; refused?: string }>;

const ground = () => browser.execute(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());

async function theme(value: "light" | "dark", bg: string) {
  await invoke("set_appearance", { value });
  await browser.waitUntil(async () => (await ground()) === bg, { timeout: 10000, timeoutMsg: `--bg never became ${bg}` });
  // The tokens flipped, but a background is still on its way there for --dur-fast (150 ms): read after the motion,
  // or the contract records a colour halfway between the two themes — which it did, the first time.
  await browser.pause(500);
}

/** One element per component, and what of it is read. */
const CONTRACT: [selector: string, props: string[]][] = [
  ['[data-story="Button/primary"] .ui-button', ["background-color", "color", "border-radius", "height", "font-family", "font-size"]],
  ['[data-story="Button/secondary"] .ui-button', ["background-color", "color", "border-top-color"]],
  ['[data-story="Button/text"] .ui-button', ["background-color", "color"]],
  ['[data-story="StatusBadge/decision"] .ui-badge', ["background-color", "color", "border-radius", "height", "font-size"]],
  ['[data-story="StatusBadge/decision"] .ui-dot', ["box-shadow", "background-color", "width"]],
  ['[data-story="StatusBadge/done"] .ui-dot', ["background-color"]],
  ['[data-story="Gauge/fine"] .ui-gauge', ["background-color", "border-top-color", "border-radius", "padding-top"]],
  ['[data-story="Gauge/fine"] .ui-num', ["font-family", "font-size", "line-height", "font-weight"]],
  ['[data-story="Gauge/fine"] .ui-bar i', ["background-color"]],
  ['[data-story="Gauge/warn"] .ui-bar i', ["background-color"]],
  ['[data-story="Gauge/danger"] .ui-bar i', ["background-color"]],
  ['[data-story="Gauge/stale"] .ui-bar i', ["background-color"]],
  ['[data-story="Gauge/fine"] .ui-gauge-detail', ["color", "font-size"]],
  ['[data-story="MetricRow/rows"] .ui-metric-row', ["height", "border-top-color"]],
  ['[data-story="SectionHeader/reading"] h2', ["font-size", "line-height", "font-weight"]],
  ['[data-story="SectionHeader/reading"] .ui-caption', ["color", "font-size"]],
  ['[data-story="SectionHeader/reading"] .ui-section-action', ["color"]],
  ['[data-story="TitleRow/home"] h1', ["font-size", "line-height", "font-weight", "font-family"]],
  ['[data-story="Table/today"] th', ["color", "font-size", "height"]],
  ['[data-story="Card/selected"] .ui-card', ["background-color", "box-shadow"]],
  ['[data-story="ProgressRow/list"] .ui-progress-row[aria-selected="true"]', ["background-color", "min-height"]],
  ['[data-story="InboxItem/plan"] .ui-inbox-item', ["background-color", "border-radius"]],
  ['[data-story="Toast/success"] .ui-toast', ["box-shadow", "background-color"]],
  ['[data-story="EmptyState/plain"] .ui-empty', ["color", "border-top-style", "border-top-color"]],
  ['[data-story="TerminalChrome/working"] .ui-termchrome', ["height", "background-color"]],
  ['[data-story="Nav/sidebar"] .ui-word', ["font-family", "font-size"]],
  ['[data-story="Nav/sidebar"] .ui-nav[aria-current="page"]', ["background-color", "color", "height"]],
  ['[data-story="Nav/sidebar"] .ui-nav[aria-current="page"] .ui-icon', ["color"]],
  ['[data-story="Field/text"] .ui-input', ["height", "border-top-color", "border-radius"]],
  ['[data-story="Field/switch"] .ui-switch[aria-checked="true"]', ["background-color", "width", "height"]],
  ['[data-story="Chip/cat-1"] .ui-chip', ["background-color", "width"]],
  ['[data-story="TabStrip/plain"] .ui-tabstrip', ["height", "background-color", "box-shadow"]],
  ['[data-story="TabStrip/plain"] .ui-tab[aria-selected="true"]', ["background-color", "color", "font-size", "max-width"]],
  ['[data-story="TabStrip/plain"] .ui-tab[aria-selected="false"]', ["color"]],
];

type Contract = Record<string, Record<string, string>>;

async function capture(): Promise<Contract> {
  return browser.execute((contract: [string, string[]][]) => {
    const out: Record<string, Record<string, string>> = {};
    for (const [selector, props] of contract) {
      const el = document.querySelector(selector);
      if (!el) {
        out[selector] = { missing: "true" };
        continue;
      }
      const style = getComputedStyle(el);
      out[selector] = Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p)]));
    }
    return out;
  }, CONTRACT);
}

async function screenshots(name: string) {
  mkdirSync(screens, { recursive: true });
  const pages = await browser.execute(() => {
    const main = document.querySelector("main.ui-stories") as HTMLElement;
    main.scrollTop = 0;
    return Math.ceil(main.scrollHeight / main.clientHeight);
  });
  for (let i = 0; i < pages; i++) {
    await browser.execute((page: number) => {
      const main = document.querySelector("main.ui-stories") as HTMLElement;
      main.scrollTop = page * main.clientHeight;
    }, i);
    await browser.pause(150);
    await browser.saveScreenshot(join(screens, `${name}-${i + 1}.png`));
  }
  return pages;
}

describe("the component stories (a debug build, #stories)", () => {
  before(async () => {
    await $(".sidebar").waitForExist({ timeout: 60000 });
    await browser.setWindowSize(1280, 820);
    await browser.execute(() => {
      location.hash = "#stories";
      location.reload();
    });
    await $("main.ui-stories").waitForExist({ timeout: 30000 });
  });

  it("renders every component with every state, and nothing of the app", async () => {
    // One script, not twenty lookups: each WebDriver round trip costs ~5 s on this Mac.
    const seen = await browser.execute(() => {
      const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? null;
      return {
        components: document.querySelectorAll("section[data-component]").length,
        stories: document.querySelectorAll("[data-story]").length,
        present: ["Button/primary", "StatusBadge/decision", "StatusBadge/dead", "Gauge/dead", "MetricRow/rows", "ProgressRow/quiet", "InboxItem/plan", "Timeline/task", "TerminalChrome/working", "Panel/task-detail", "Nav/sidebar", "Field/accent"].filter((id) => !document.querySelector(`[data-story="${id}"]`)),
        app: [".sidebar", ".terminal", "section.page"].filter((sel) => document.querySelector(sel)),
        decision: text('[data-story="StatusBadge/decision"] .ui-badge'),
        counted: text('[data-story="StatusBadge/counted"] .ui-badge'),
        dead: text('[data-story="Gauge/dead"] .ui-gauge-none'),
        upper: text('[data-story="MetricRow/rows"] .ui-metric-row .ui-unit'),
        empty: text('[data-story="EmptyState/with-action"] .ui-empty'),
      };
    });
    expect(seen.components).toBeGreaterThanOrEqual(22);
    expect(seen.stories).toBeGreaterThanOrEqual(60);
    expect(seen.present).toEqual([]);
    expect(seen.app).toEqual([]);
    // The words are the law's: sentence case, the exact copy of the preview.
    expect(seen.decision).toBe("needs decision");
    expect(seen.counted).toBe("4 done");
    expect(seen.dead).toBe("No reading");
    expect(seen.upper).toBe("% upper bound");
    expect(seen.empty).toContain("No work overnight in this folder.");
  });

  it("holds the style contract in both themes, and saves the page", async () => {
    const recorded: Record<string, Contract> = existsSync(contractPath) ? (JSON.parse(readFileSync(contractPath, "utf8")) as Record<string, Contract>) : {};
    const seen: Record<string, Contract> = {};
    for (const [name, bg] of [
      ["light", "#f4f2ec"],
      ["dark", "#14171e"],
    ] as const) {
      await theme(name, bg);
      seen[name] = await capture();
      for (const [selector, values] of Object.entries(seen[name])) {
        expect(`${selector}: ${values.missing ? "missing" : "present"}`).toBe(`${selector}: present`);
      }
      // What the tokens say, read from the same page, is what the components painted.
      const ink = await browser.execute(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--ink)";
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      });
      expect(seen[name]['[data-story="Button/secondary"] .ui-button']!["color"]).toBe(ink);
      // A component's own type and colour hold wherever it sits (2026-09-23): base.css's rule for controls inside ui-
      // components used to outrank their classes, so a Button in a card, a progress row in its list and a section
      // header's action took the page's 16 px — and the action lost its accent.
      const nested = await browser.execute(() => {
        const size = (sel: string) => getComputedStyle(document.querySelector(sel)!).fontSize;
        const probe = document.createElement("span");
        probe.style.color = "var(--accent)";
        document.body.appendChild(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        return {
          alone: size('[data-story="Button/primary"] .ui-button'),
          inCard: size('[data-story="InboxItem/plan"] .ui-button'),
          progressName: size('[data-story="ProgressRow/list"] .ui-progress-name'),
          // Text that names no size of its own is the page's --text-md, as the preview's body sets it — not 16 px.
          metricLabel: size('[data-story="MetricRow/rows"] .ui-metric-label'),
          action: getComputedStyle(document.querySelector('[data-story="SectionHeader/reading"] .ui-section-action')!).color === accent,
        };
      });
      expect(nested).toEqual({ alone: "13px", inCard: "13px", progressName: "13px", metricLabel: "13px", action: true });
      await screenshots(`stories-${name}`);
    }
    if (!recorded.light) {
      mkdirSync(join(repo, "fixtures/screens"), { recursive: true });
      writeFileSync(contractPath, `${JSON.stringify(seen, null, 2)}\n`);
      console.log(`stories.e2e: recorded the style contract into fixtures/screens/stories.json (${Object.keys(seen.light!).length} elements)`);
    } else {
      for (const name of ["light", "dark"] as const) {
        for (const [selector, values] of Object.entries(seen[name]!)) {
          expect(`${name} ${selector} ${JSON.stringify(values)}`).toBe(`${name} ${selector} ${JSON.stringify(recorded[name]![selector])}`);
        }
      }
    }
    await theme("dark", "#14171e");
  });
});
