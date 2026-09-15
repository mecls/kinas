import { invoke } from "@tauri-apps/api/core";

/**
 * The most a single copy may put on the clipboard, in UTF-8 bytes. Must equal `CLIPBOARD_MAX_BYTES` in
 * src-tauri/src/commands.rs, which refuses anything larger.
 */
export const CLIPBOARD_MAX_BYTES = 1_048_576;

/**
 * Puts text on the macOS clipboard through the app's one clipboard command, which can only write. Empty text and
 * text over the limit are never sent, and a refusal is swallowed: a failed copy never interrupts the terminal.
 */
export function writeClipboard(text: string): void {
  if (text === "" || new TextEncoder().encode(text).length > CLIPBOARD_MAX_BYTES) return;
  void invoke("clipboard_write_text", { text }).catch(() => {});
}
