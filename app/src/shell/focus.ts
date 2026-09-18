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
