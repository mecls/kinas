// A plain login shell in the pane: no Herdr, so nothing here can touch a Herdr session.
export function setup(): Record<string, string> {
  return { KINAS_PANE_SHELL_ONLY: "1" };
}
