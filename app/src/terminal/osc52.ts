// OSC 52 is how programs in the pane copy: `ESC ] 52 ; Pc ; Pd BEL`, with Pd in base64. Herdr copies a mouse
// selection this way, and so do neovim, tmux and ssh sessions. Kinas only ever writes the clipboard: a query
// (Pd of `?`) is ignored, so nothing printed in the pane can read what was copied.

import { CLIPBOARD_MAX_BYTES } from "./clipboard.ts";

export type Osc52 = { kind: "write"; text: string } | { kind: "ignore" };

const IGNORE: Osc52 = { kind: "ignore" };
/** Clipboard, primary, secondary, select, cut buffers 0–7. macOS has one general pasteboard, so all of them write it. */
const TARGETS = /^[cpqs0-7]*$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** @param data what xterm hands an OSC 52 handler: everything after `52;`. */
export function parseOsc52(data: string): Osc52 {
  const split = data.indexOf(";");
  if (split < 0) return IGNORE;
  const targets = data.slice(0, split);
  const payload = data.slice(split + 1);
  if (!TARGETS.test(targets) || payload === "?") return IGNORE;
  // Refused before decoding, so an oversized payload is never decoded at all.
  if (payload.length > Math.ceil(CLIPBOARD_MAX_BYTES / 3) * 4 || !BASE64.test(payload)) return IGNORE;
  const bare = payload.replace(/=+$/, "");
  if (bare.length % 4 === 1) return IGNORE;

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(bare.padEnd(Math.ceil(bare.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
  } catch {
    return IGNORE;
  }
  if (bytes.length > CLIPBOARD_MAX_BYTES) return IGNORE;

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return IGNORE;
  }
  return text === "" ? IGNORE : { kind: "write", text };
}
