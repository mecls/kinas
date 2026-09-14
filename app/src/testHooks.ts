// Debug builds only (build spec invariant 19). main.tsx imports this behind
// `import.meta.env.TAURI_ENV_DEBUG === "true"`, which Vite replaces with `false` in release builds,
// so neither this module nor `__kinasTest` exists in the shipped app.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type TestHook = () => Promise<unknown> | unknown;

declare global {
  interface Window {
    __kinasTest?: Record<string, TestHook>;
  }
}

export function installTestHooks(): void {
  registerTestHooks({
    storeInfo: () => invoke("store_info"),
    closeWindow: () => getCurrentWindow().close(),
    showWindow: () => getCurrentWindow().show(),
    isVisible: () => getCurrentWindow().isVisible(),
  });
}

/** Lets later modules (the terminal, the Usage page) add hooks of their own. */
export function registerTestHooks(hooks: Record<string, TestHook>): void {
  window.__kinasTest = { ...window.__kinasTest, ...hooks };
}
