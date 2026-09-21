import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Channel, invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import { dispatchAppAction } from "../actions.ts";
import type { Shortcuts } from "../settings/shortcuts.ts";
import { onThemeChange } from "../theme.ts";
import { writeClipboard } from "./clipboard.ts";
import { decideKey } from "./keyContract.ts";
import { KittyKeyboardTracker } from "./kittyKeyboard.ts";
import { parseOsc52 } from "./osc52.ts";
import { type SelectionSnapshot, selectionDeleteBytes } from "./selectionDelete.ts";

const EXITED = "\r\n[process exited — press Enter to restart]\r\n";

/** How long "copied to clipboard" stays up after a copy. */
const COPIED_TOAST_MS = 1500;

/** The pane's colours come from tokens.css like every other colour in the app: read when the terminal starts, and
 * again whenever the ground turns. xterm repaints what is already on screen, except cells a program painted in 24-bit. */
function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(`--${name}`).trim();
  return {
    background: token("ground"),
    foreground: token("white"),
    cursor: token("white"),
    cursorAccent: token("ground"),
    selectionBackground: token("selection"),
    black: token("ansi-black"),
    red: token("ansi-red"),
    green: token("ansi-green"),
    yellow: token("ansi-yellow"),
    blue: token("ansi-blue"),
    magenta: token("ansi-magenta"),
    cyan: token("ansi-cyan"),
    white: token("ansi-white"),
    brightBlack: token("ansi-bright-black"),
    brightRed: token("ansi-bright-red"),
    brightGreen: token("ansi-bright-green"),
    brightYellow: token("ansi-bright-yellow"),
    brightBlue: token("ansi-bright-blue"),
    brightMagenta: token("ansi-bright-magenta"),
    brightCyan: token("ansi-bright-cyan"),
    brightWhite: token("ansi-bright-white"),
  };
}

export function Terminal({ active, shortcuts }: { active: boolean; shortcuts: Shortcuts }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // "copied to clipboard", up for a moment after the pane itself puts a selection on the clipboard.
  const [copied, setCopied] = useState(false);
  // The key handler is attached once, so it reads the current shortcuts through a ref.
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    const el = host.current!;
    const xterm = new XTerm({
      macOptionIsMeta: false,
      scrollback: 10000,
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(el);
    term.current = xterm;
    fit.current = fitAddon;

    // A program's OSC 52 write (how Herdr copies a mouse selection) reaches the macOS clipboard; a query never reads
    // it. The handler claims every OSC 52, so xterm never prints one.
    // No toast for these: Herdr shows its own "copied to clipboard" when it copies.
    const osc52 = xterm.parser.registerOscHandler(52, (data) => {
      const parsed = parseOsc52(data);
      if (parsed.kind === "write") void writeClipboard(parsed.text);
      return true;
    });

    // Only a copy that reached the clipboard says so; another copy while it is up keeps it up.
    let copiedTimer: number | undefined;
    const showCopied = () => {
      setCopied(true);
      window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => setCopied(false), COPIED_TOAST_MS);
    };

    // A mouse selection is copied when the button is released: not on onSelectionChange, which fires on every move
    // of a drag. Both listeners capture, so a program's mouse reporting cannot hide them, and the copy waits a tick
    // for xterm's own mouseup to finish the selection.
    let pointerSelecting = false;
    const onMouseDown = (ev: MouseEvent) => {
      pointerSelecting = ev.button === 0;
    };
    const onMouseUp = (ev: MouseEvent) => {
      if (!pointerSelecting) return;
      pointerSelecting = false;
      if (ev.button !== 0) return;
      window.setTimeout(() => {
        if (!xterm.hasSelection()) return;
        void writeClipboard(xterm.getSelection()).then((ok) => {
          if (ok) showCopied();
        });
      }, 0);
    };
    // ⌘C still copies through xterm's own handler for the macOS menu's copy event, which does not stop the event
    // here; capturing runs first, while the selection is still there.
    const onCopy = () => {
      if (xterm.hasSelection() && xterm.getSelection() !== "") showCopied();
    };
    el.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    el.addEventListener("copy", onCopy, true);

    // WebGL, falling back to xterm's DOM renderer, never a blank pane (R33).
    let webgl: WebglAddon | null = null;
    let renderer: "webgl" | "dom" = "dom";
    const fallBackToDom = (why: string) => {
      webgl?.dispose();
      webgl = null;
      renderer = "dom";
      setNotice(`WebGL unavailable — using the DOM renderer (${why})`);
    };
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => fallBackToDom("context lost"));
      xterm.loadAddon(webgl);
      renderer = "webgl";
    } catch (e) {
      fallBackToDom(String(e));
    }

    const kitty = new KittyKeyboardTracker();
    let exited = false;
    let disposed = false;
    // Debug builds only: the last 4 KB of raw output and the last 20 key decisions, for e2e diagnostics.
    let rawTail: number[] = [];
    let keyLog: string[] = [];

    const send = (data: string) => void invoke("pty_write", { data }).catch(() => {});

    // What ⌫ over a selection needs to know. decideKey only asks for it on a plain ⌫, before xterm clears the
    // selection on input.
    const snapshot = (): SelectionSnapshot => {
      const buffer = xterm.buffer.active;
      const cursorRow = buffer.baseY + buffer.cursorY;
      const line = buffer.getLine(cursorRow);
      const row: SelectionSnapshot["row"] = [];
      for (let x = 0; x < xterm.cols; x++) {
        const cell = line?.getCell(x);
        row.push({ chars: cell?.getChars() ?? "", width: cell?.getWidth() ?? 1 });
      }
      return {
        bufferType: buffer.type,
        kittyFlags: kitty.flags,
        appCursor: xterm.modes.applicationCursorKeysMode,
        cursorX: buffer.cursorX,
        cursorRow,
        selection: xterm.getSelectionPosition(),
        row,
      };
    };

    xterm.attachCustomKeyEventHandler((ev) => {
      const decision = decideKey(ev, kitty.flags, shortcutsRef.current, () => selectionDeleteBytes(snapshot()));
      if (import.meta.env.TAURI_ENV_DEBUG === "true") {
        const mods = `${ev.ctrlKey ? "⌃" : ""}${ev.altKey ? "⌥" : ""}${ev.shiftKey ? "⇧" : ""}${ev.metaKey ? "⌘" : ""}`;
        keyLog = [...keyLog, `${ev.type} ${mods}${ev.key} flags=${kitty.flags} → ${JSON.stringify(decision)}`].slice(-20);
      }
      switch (decision.kind) {
        case "app":
          ev.preventDefault();
          // A held chord repeats; the sidebar would flicker on every repeat.
          if (!ev.repeat) dispatchAppAction(decision.action);
          return false;
        case "native":
          return false;
        case "pty":
          ev.preventDefault();
          if (!exited) send(decision.data);
          // The app's bytes stand in for the key, so the selection goes, as xterm clears it on any input.
          xterm.clearSelection();
          return false;
        case "xterm":
          return true;
      }
    });

    const start = async () => {
      kitty.reset();
      const onData = new Channel<ArrayBuffer>();
      onData.onmessage = (chunk) => {
        const bytes = new Uint8Array(chunk);
        if (import.meta.env.TAURI_ENV_DEBUG === "true") rawTail = [...rawTail, ...bytes].slice(-4096);
        for (const reply of kitty.feed(bytes)) send(reply);
        xterm.write(bytes);
      };
      const onExit = new Channel<number | null>();
      onExit.onmessage = () => {
        if (disposed) return;
        exited = true;
        kitty.reset();
        xterm.write(EXITED);
      };
      try {
        await invoke<number | null>("pty_start", { onData, onExit, cols: xterm.cols, rows: xterm.rows });
        exited = false;
      } catch (e) {
        exited = true;
        xterm.write(`\r\n[could not start the terminal: ${String(e)} — press Enter to retry]\r\n`);
      }
    };

    xterm.onData((data) => {
      if (exited) {
        if (data === "\r") void start();
        return;
      }
      send(data);
    });
    xterm.onBinary((data) => {
      if (!exited) void invoke("pty_write_binary", { data: Array.from(data, (c) => c.charCodeAt(0) & 0xff) }).catch(() => {});
    });

    let timer: number | undefined;
    const resize = () => {
      if (el.offsetParent === null) return; // hidden: measure again when shown
      fitAddon.fit();
      void invoke("pty_resize", { cols: xterm.cols, rows: xterm.rows }).catch(() => {});
    };
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(resize, 50);
    });
    observer.observe(el);

    fitAddon.fit();
    void start();

    // The terminal is never remounted, so a change of ground is a new theme on the one that is running.
    const offThemeChange = onThemeChange(() => {
      xterm.options.theme = terminalTheme();
    });

    if (import.meta.env.TAURI_ENV_DEBUG === "true") {
      void import("../testHooks.ts").then(({ registerTestHooks }) =>
        registerTestHooks({
          terminalText: () => {
            const buffer = xterm.buffer.active;
            const lines: string[] = [];
            for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
            return lines.join("\n");
          },
          terminalFocused: () => document.activeElement === xterm.textarea,
          terminalRenderer: () => renderer,
          terminalBackground: () => xterm.options.theme?.background ?? null,
          terminalFallBackToDom: () => fallBackToDom("forced by test"),
          ptyPid: () => invoke("pty_pid"),
          keyLog: () => keyLog.join("\n"),
          // A real keydown on xterm's textarea: the same path a physical key takes through
          // attachCustomKeyEventHandler and decideKey.
          dispatchKey: (spec?: unknown) => {
            const s = (spec ?? {}) as { key: string; code?: string; keyCode?: number; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean };
            xterm.textarea?.focus();
            xterm.textarea?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...s }));
          },
          terminalRawTail: () =>
            rawTail.map((b) => (b === 0x1b ? "\\e" : b === 0x0d ? "\\r" : b === 0x0a ? "\\n\n" : b < 0x20 || b > 0x7e ? `\\x${b.toString(16).padStart(2, "0")}` : String.fromCharCode(b))).join(""),
          kittyFlags: () => kitty.flags,
          focusTerminal: () => xterm.focus(),
          // Types as if the user had, through xterm's own input path (onData), for when WebDriver's
          // synthetic key events cannot produce printable characters.
          terminalInput: (text?: unknown) => xterm.input(String(text ?? ""), true),
          // Selections for the selection and clipboard spec: rows are absolute buffer rows, as xterm counts them.
          terminalSelect: (spec?: unknown) => {
            const s = spec as { column: number; row: number; length: number };
            xterm.select(s.column, s.row, s.length);
          },
          terminalSelection: () => xterm.getSelection(),
          terminalSelectionPosition: () => xterm.getSelectionPosition() ?? null,
          terminalCursor: () => {
            const buffer = xterm.buffer.active;
            return { x: buffer.cursorX, row: buffer.baseY + buffer.cursorY, viewportY: buffer.viewportY };
          },
          terminalSize: () => ({ cols: xterm.cols, rows: xterm.rows }),
        }),
      );
    }

    return () => {
      disposed = true;
      offThemeChange();
      observer.disconnect();
      window.clearTimeout(timer);
      osc52.dispose();
      window.clearTimeout(copiedTimer);
      el.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      el.removeEventListener("copy", onCopy, true);
      xterm.dispose();
      term.current = null;
    };
  }, []);

  // Becoming visible again: re-measure (the size may have changed while hidden) and take focus.
  useEffect(() => {
    if (!active || !term.current || !fit.current) return;
    const xterm = term.current;
    const fitAddon = fit.current;
    requestAnimationFrame(() => {
      fitAddon.fit();
      void invoke("pty_resize", { cols: xterm.cols, rows: xterm.rows }).catch(() => {});
      xterm.focus();
    });
  }, [active]);

  return (
    <div className="terminal">
      {notice && <div className="terminal-notice">{notice}</div>}
      <div ref={host} className="terminal-host" />
      {copied && (
        <div className="terminal-toast" role="status">
          <span className="terminal-toast-dot" aria-hidden="true" />
          copied to clipboard
        </div>
      )}
    </div>
  );
}
