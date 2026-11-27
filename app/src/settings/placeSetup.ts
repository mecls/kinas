import type { CheckState, InstallItem, SetupCheck } from "../api.ts";

// Settings → Where agents run, setup's words (build spec §12 slice 4.3; DESIGN.md 1.14): each row's name, its tone, and
// what its Install button says. The rows' own words come from the companion through crew/setup.rs.

export const CHECK_LABELS: Record<string, string> = {
  system: "System",
  herdr: "Herdr",
  "herdr-server": "Herdr's server",
  firstmate: "Firstmate",
  "relay-rule": "Relay rule",
  "relay-instruction": "Relay instruction",
  "first-mate-launch": "First mate's launch",
  "worker-sandbox": "Workers sandboxed",
  "github-app": "GitHub App",
  "permission-mode": "Workers' permission mode",
  tools: "Crew tools",
  node: "Node",
  companion: "Kinas on the Linux machine",
  linger: "Lingering",
  claude: "Claude Code",
  gh: "gh",
  "api-key": "ANTHROPIC_API_KEY",
  projects: "Projects folder",
};

/** The dot's token: green, amber, red, or quiet for a row that waits on an earlier one. */
export const TONE: Record<CheckState, string> = { ok: "--ok", warn: "--warn", bad: "--danger", later: "--stale" };

const INSTALL_WORDS: Record<InstallItem, string> = {
  herdr: "Install Herdr",
  "herdr-service": "Start under systemd",
  firstmate: "Install Firstmate",
  "relay-rule": "Add the rule",
  "relay-instruction": "Install",
  "worker-sandbox": "Sandbox workers",
  "permission-mode": "Set to auto",
  "crew-tools": "Install the tools",
  "companion-service": "Start under systemd",
  clone: "Clone",
};

/** What a row's Install button says; adopting Herdr's running server, and restarting it, say so in their own words. */
export function installLabel(check: Pick<SetupCheck, "install" | "adopt" | "restart">): string | null {
  if (check.install === null) return null;
  if (check.restart) return "Restart Herdr";
  return check.adopt ? "Run Herdr under systemd" : INSTALL_WORDS[check.install];
}

/** The second click's warning, for an install that stops something running (§17 2026-11-24 #2). */
export const ADOPT_WARNING = "This stops Herdr's running server there and every pane in it. Click again to go ahead.";

/** The second click's warning for Restart Herdr (DESIGN.md 1.14, ADR 0027), in --danger words beside the button. */
export const RESTART_WARNING = "closes every pane on the Linux machine: close what's open first";

/** The warning an install's first click shows, or null when one click does it. */
export function secondClick(check: Pick<SetupCheck, "adopt" | "restart">): string | null {
  if (check.restart) return RESTART_WARNING;
  return check.adopt ? ADOPT_WARNING : null;
}

/** The by-hand lines with the SSH target in place of `<target>`. */
export function byHand(lines: string[], target: string): string[] {
  return lines.map((l) => l.replaceAll("<target>", target));
}

/** Whether every row is green: setup is done. */
export function allOk(checks: SetupCheck[]): boolean {
  return checks.length > 0 && checks.every((c) => c.state === "ok");
}
