import { invoke } from "@tauri-apps/api/core";

/**
 * The most a single copy may put on the clipboard, in UTF-8 bytes. Must equal `CLIPBOARD_MAX_BYTES` in
 * src-tauri/src/commands.rs, which refuses anything larger.
 */
export const CLIPBOARD_MAX_BYTES = 1_048_576;

/**
 * Puts text on the macOS clipboard through the app's one clipboard command, which can only write. Resolves true once
 * the text is on the clipboard, and false when nothing was sent (empty, or over the limit) or the command refused it.
 * It never rejects: a failed copy never interrupts the terminal, and never claims to have copied.
 */
export function writeClipboard(text: string): Promise<boolean> {
  if (text === "" || new TextEncoder().encode(text).length > CLIPBOARD_MAX_BYTES) return Promise.resolve(false);
  return invoke("clipboard_write_text", { text }).then(
    () => true,
    () => false,
  );
}
