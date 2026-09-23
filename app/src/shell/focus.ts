// The terminal's keyboard focus, as the shell and the reader need it. The pane keeps its own box on the Work page
// (`.work-terminal`), and xterm takes keys through a hidden textarea inside it.

/** Whether keys are going to the terminal right now. */
export function terminalHasFocus(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.closest(".terminal") !== null;
}

/** Gives the terminal the keys. Does nothing while the Work page is not showing: a hidden element cannot take focus. */
export function focusTerminal(): void {
  document.querySelector<HTMLTextAreaElement>(".work-terminal .xterm-helper-textarea")?.focus({ preventScroll: true });
}

/** The pane's copy, registered by the terminal: the Work page's chrome copies the selection through it (a sibling
 * above the pane can reach xterm no other way without wrapping it, and a wrapper would remount the terminal). */
let copier: (() => Promise<boolean>) | null = null;

export function registerTerminalCopy(copy: () => Promise<boolean>): () => void {
  copier = copy;
  return () => {
    if (copier === copy) copier = null;
  };
}

/** Copies the terminal's selection as a mouse copy does, "copied to clipboard" included; false when nothing was. */
export function copyTerminalSelection(): Promise<boolean> {
  return copier ? copier() : Promise.resolve(false);
}
