import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TitleBar } from "./TitleBar.tsx";

// Tauri's drag script (tauri 2.11.5, window/scripts/drag.js) drags the window from any pixel under a
// `data-tauri-drag-region="deep"` element, unless a button with no attribute of its own is in the way. A button that
// carried the attribute would move the window instead of acting (build spec §15, "Never do this").

const bar = (props: Partial<Parameters<typeof TitleBar>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(TitleBar, {
      sidebarShown: true,
      sidebarChord: "⌘S",
      onSidebar: () => {},
      canBack: false,
      canForward: false,
      onBack: () => {},
      onForward: () => {},
      fullscreen: false,
      ...props,
    }),
  );

describe("the title bar (reader-layout PRD rules 26–28)", () => {
  test("no control is a drag region, and the bar is one, deep", () => {
    for (const html of [bar(), bar({ canBack: true, canForward: true, sidebarShown: false, fullscreen: true })]) {
      expect(html).toMatch(/^<header class="ui-titlebar" data-tauri-drag-region="deep"/);
      expect(html.match(/data-tauri-drag-region/g)?.length).toBe(1);
      const buttons = html.match(/<button[^>]*>/g) ?? [];
      expect(buttons.length).toBe(3);
      for (const b of buttons) expect(b).not.toContain("data-tauri-drag-region");
    }
  });

  test("the buttons say what a click will do, and why one cannot", () => {
    const start = bar();
    expect(start).toContain('aria-label="Hide the sidebar" title="Hide the sidebar (⌘S)"');
    expect(start).toContain('aria-label="Back" aria-disabled="true" title="Nothing to go back to"');
    expect(start).toContain('aria-label="Forward" aria-disabled="true" title="Nothing to go forward to"');
    const hidden = bar({ sidebarShown: false, sidebarChord: "⌘B", canBack: true });
    expect(hidden).toContain('aria-label="Show the sidebar" title="Show the sidebar (⌘B)"');
    expect(hidden).toContain('aria-label="Back" title="Back"');
  });
});
