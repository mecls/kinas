// Whether a file reads as text (reader PRD R1). The CLI judges this itself, rather than asking the app, because
// the socket handler never reads file contents — that is what stops a slow or hostile file stalling the socket
// thread — and `kinas open` must still exit 65 precisely. The rule is duplicated in Rust
// (`app/src-tauri/src/reader/access.rs`), and the two are held together by `fixtures/reader/sniff-cases.json`.

import { closeSync, openSync, readSync } from "node:fs";

/** One page. mimesniff looks at 1445; 4096 costs the same syscall and catches a text header over binary bytes. */
export const SNIFF_BYTES = 4096;

/**
 * A WHATWG mimesniff "binary data byte": `0x00-0x08`, `0x0B`, `0x0E-0x1A`, `0x1C-0x1F`.
 *
 * Taken verbatim from the algorithm browsers use for `text/plain` against `application/octet-stream`, so there is
 * no invented threshold to defend. Two absences matter: `0x1B` (ESC) is not here, so ANSI-coloured logs open, and
 * neither are `0x09`, `0x0A`, `0x0C` or `0x0D`. `0x08` is, which is what makes ELF, Mach-O, PNG and zip fail
 * inside their first bytes.
 */
const binary = (b: number) => b <= 0x08 || b === 0x0b || (b >= 0x0e && b <= 0x1a) || (b >= 0x1c && b <= 0x1f);

const utf8 = (bytes: Uint8Array) => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether a file's head reads as text.
 *
 * A multi-byte sequence chopped by the window is tolerated — the rest of it is simply not here yet — so up to
 * three trailing bytes are dropped before the last attempt. An empty head is text, and an empty file opens as an
 * empty page.
 */
export function sniff(head: Uint8Array): "text" | "binary" {
  const body = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? head.subarray(3) : head;
  for (const b of body) if (binary(b)) return "binary";
  if (utf8(body)) return "text";
  for (let cut = 1; cut <= Math.min(3, body.length); cut++) {
    if (utf8(body.subarray(0, body.length - cut))) return "text";
  }
  return "binary";
}

/** `sniff` on the first {@link SNIFF_BYTES} of a file. An unreadable file is left to the caller's stat to explain. */
export function sniffFile(path: string): "text" | "binary" {
  const fd = openSync(path, "r");
  try {
    const buffer = new Uint8Array(SNIFF_BYTES);
    const read = readSync(fd, buffer, 0, SNIFF_BYTES, 0);
    return sniff(buffer.subarray(0, read));
  } finally {
    closeSync(fd);
  }
}
