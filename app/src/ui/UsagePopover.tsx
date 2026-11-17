import { useEffect, useRef } from "react";
import { Bar, type Tone } from "./Bar.tsx";
import { Kbd } from "./Button.tsx";
import { Chip, type Category } from "./Dot.tsx";
import "./UsagePopover.css";

// DESIGN.md §4 Usage popover (1.13, the interface polish): a floating --surface sheet above the status bar's readings.
// A block per configured provider — its Chip, its name, one "as of" — then per window a label, a Bar, and "24% used"
// on the left with its reset on the right. The foot is "Open Usage" with its Kbd. Esc or a click outside closes it.
//
// It takes the keys when it opens and gives them back when it closes, as the Menu does: back to the readings button,
// unless something else has taken them since — a click into the terminal keeps the terminal's (ADR 0002's pane keeps
// its keys). It is fixed to the window, a sibling of the shell, so nothing above the terminal is wrapped.

export interface UsagePopoverWindow {
  key: string;
  label: string;
  used: number | null;
  tone: Tone;
  usedText: string;
  reset: string;
  resetTitle: string;
}

export interface UsagePopoverBlock {
  provider: string;
  cat: Category;
  asOf: string;
  windows: readonly UsagePopoverWindow[];
}

export function UsagePopover({
  blocks,
  usageChord,
  onOpenUsage,
  onClose,
  inline = false,
}: {
  blocks: readonly UsagePopoverBlock[];
  usageChord: string;
  onOpenUsage: () => void;
  onClose: () => void;
  /** In the stories: drawn in place, not fixed above the status bar, and taking no focus. */
  inline?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (inline) return;
    const el = root.current;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el?.focus({ preventScroll: true });
    const onPointerDown = (e: PointerEvent) => {
      // The readings button toggles the popover itself; its press is not "outside".
      if (e.target instanceof Element && (el?.contains(e.target) || e.target.closest('[data-part="readings"]'))) return;
      close.current();
    };
    const onBlur = () => close.current();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
      const active = document.activeElement;
      if (returnTo?.isConnected && (active === null || active === document.body || el?.contains(active))) returnTo.focus({ preventScroll: true });
    };
  }, [inline]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <div ref={root} className="ui-popover" data-inline={inline || undefined} role="dialog" aria-label="Usage" tabIndex={-1} onKeyDown={onKeyDown}>
      {blocks.length === 0 && <p className="ui-popover-empty">No usage readings yet.</p>}
      {blocks.map((b) => (
        <section key={b.provider} className="ui-popover-block" data-provider={b.provider}>
          <header className="ui-popover-head">
            <Chip cat={b.cat} />
            <span className="ui-popover-name">{b.provider}</span>
            <span className="ui-popover-asof">{b.asOf}</span>
          </header>
          {b.windows.map((w) => (
            <div key={w.key} className="ui-popover-window" data-window={w.key}>
              <div className="ui-popover-label">{w.label}</div>
              <Bar pct={w.used} tone={w.tone} />
              <div className="ui-popover-line">
                <span>{w.usedText}</span>
                <span title={w.resetTitle || undefined}>{w.reset}</span>
              </div>
            </div>
          ))}
        </section>
      ))}
      <button type="button" className="ui-popover-foot" onClick={onOpenUsage}>
        Open Usage <Kbd>{usageChord}</Kbd>
      </button>
    </div>
  );
}
