// The in-window shortcuts (keymap.md): one chord per app action, written the way chord.ts records them
// ("Cmd+Shift+K"). The defaults live here; Settings saves changes through the Rust core, and the window (App.tsx)
// and the terminal pane (keyContract.ts) look actions up in the same map.

import { chordFromEvent, type ChordKey } from "./chord.ts";

export const SHORTCUT_ACTIONS = ["palette", "go.home", "go.work", "go.usage", "sidebar", "settings"] as const;
export type AppAction = (typeof SHORTCUT_ACTIONS)[number];
export type Shortcuts = Record<AppAction, string>;

export const DEFAULT_SHORTCUTS: Shortcuts = {
  palette: "Cmd+K",
  "go.home": "Cmd+1",
  "go.work": "Cmd+2",
  "go.usage": "Cmd+4",
  sidebar: "Cmd+S",
  settings: "Cmd+,",
};

export const SHORTCUT_TITLES: Record<AppAction, string> = {
  palette: "Open the command palette",
  "go.home": "Go to Home",
  "go.work": "Go to Work",
  "go.usage": "Go to Usage",
  sidebar: "Hide or show the sidebar",
  settings: "Open Settings",
};

/** The macOS menu's chords (keymap.md): the window leaves them to macOS, so no shortcut may be one. */
const MACOS_CHORDS: Record<string, string> = {
  "Cmd+C": "Copy",
  "Cmd+V": "Paste",
  "Cmd+X": "Cut",
  "Cmd+A": "Select All",
  "Cmd+Z": "Undo",
  "Cmd+Shift+Z": "Redo",
  "Cmd+W": "Close Window",
  "Cmd+H": "Hide",
  "Cmd+M": "Minimise",
  "Cmd+Q": "Quit",
};

const MODIFIER_GLYPHS: Record<string, string> = { Cmd: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const KEY_GLYPHS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↩",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
};

const MODIFIER_PREFIX = /^(Cmd|Ctrl|Alt|Shift)\+(.+)$/;

/** The key is whatever follows the last modifier, so "Cmd+Shift++" is ⇧ and ⌘ on the + key. */
function splitChord(chord: string): { modifiers: string[]; key: string } {
  const modifiers: string[] = [];
  let key = chord;
  let match: RegExpExecArray | null;
  while ((match = MODIFIER_PREFIX.exec(key))) {
    modifiers.push(match[1]!);
    key = match[2]!;
  }
  return { modifiers, key };
}

const hasCommand = (chord: string) => splitChord(chord).modifiers.includes("Cmd");

/** "Cmd+Shift+Space" → "⌘⇧Space", the way keymap.md writes chords. */
export function chordLabel(chord: string): string {
  const { modifiers, key } = splitChord(chord);
  return modifiers.map((m) => MODIFIER_GLYPHS[m]).join("") + (KEY_GLYPHS[key] ?? key);
}

/**
 * The saved shortcuts over the defaults. An unknown action or a chord without ⌘ in the saved map is ignored — and so
 * is a saved chord that equals another action's default when that other action has nothing saved (keymap.md,
 * 2026-09-22): Home took ⌘1 from Usage, and a ⌘1 saved for Usage before that day would otherwise sit on both. A pair
 * the captain bound on purpose has both actions saved, and keeps them.
 */
export function withDefaults(saved: Record<string, string> | null | undefined): Shortcuts {
  const shortcuts = { ...DEFAULT_SHORTCUTS };
  const kept = new Set<AppAction>();
  for (const action of SHORTCUT_ACTIONS) {
    const chord = saved?.[action];
    if (typeof chord === "string" && hasCommand(chord)) {
      shortcuts[action] = chord;
      kept.add(action);
    }
  }
  for (const action of kept) {
    const collides = SHORTCUT_ACTIONS.find((other) => other !== action && !kept.has(other) && DEFAULT_SHORTCUTS[other] === shortcuts[action]);
    if (collides) shortcuts[action] = DEFAULT_SHORTCUTS[action];
  }
  return shortcuts;
}

export function actionForEvent(e: ChordKey, shortcuts: Shortcuts): AppAction | null {
  const chord = chordFromEvent(e);
  return chord === null ? null : (SHORTCUT_ACTIONS.find((action) => shortcuts[action] === chord) ?? null);
}

/** Why `chord` cannot be bound to `target` (an app action, or the global hotkey), or null when it can. */
export function shortcutProblem(target: AppAction | "hotkey", chord: string, shortcuts: Shortcuts, globalHotkey: string): string | null {
  if (!hasCommand(chord)) {
    return target === "hotkey" ? "The global hotkey must include ⌘" : "A shortcut must include ⌘, so it never takes a key from the terminal";
  }
  const label = chordLabel(chord);
  const menu = MACOS_CHORDS[chord];
  if (menu) return `${label} belongs to macOS (${menu})`;
  if (target !== "hotkey" && chord === globalHotkey) return `${label} is the global hotkey`;
  const other = SHORTCUT_ACTIONS.find((action) => action !== target && shortcuts[action] === chord);
  if (other) return `${label} is already the shortcut for ${SHORTCUT_TITLES[other]}`;
  return null;
}
