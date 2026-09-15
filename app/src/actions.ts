// App actions raised from anywhere in the window (the terminal's ⌘ chords, a gauge's "Add API key"),
// handled by App.tsx. A window event keeps the terminal and the pages from importing each other.

import type { AppAction } from "./settings/shortcuts.ts";

export type { AppAction };

const EVENT = "kinas:action";

export function dispatchAppAction(action: AppAction): void {
  window.dispatchEvent(new CustomEvent<AppAction>(EVENT, { detail: action }));
}

export function onAppAction(handler: (action: AppAction) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<AppAction>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
