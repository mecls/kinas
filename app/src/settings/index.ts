import { score } from "../palette/match.ts";
import { SHORTCUT_ACTIONS, SHORTCUT_TITLES, type AppAction } from "./shortcuts.ts";

// Every setting by name (tasks/interface-polish, PRD rules 13, 32–34; build-spec §11.2): the sections in their groups,
// and one entry per setting with its label and one line of description. The palette searches these; slice 9's section
// list and search read them too. Each id is on the page as `data-setting`, on the setting's control or the element
// that holds it, and `index.test.ts` holds the two lists equal. A section's id is today's card's `data-section`.

export type SettingsGroup = "Providers" | "Crew" | "Workspace" | "Interface" | "System";

export interface SettingsSection {
  id: string;
  group: SettingsGroup;
  title: string;
}

export interface SettingEntry {
  id: string;
  section: string;
  label: string;
  description: string;
}

/** Rule 32's list, in its order. */
export const SECTIONS: readonly SettingsSection[] = [
  { id: "claude", group: "Providers", title: "Claude Code" },
  { id: "ollama", group: "Providers", title: "Ollama Cloud" },
  { id: "convex", group: "Providers", title: "Convex" },
  { id: "hostinger", group: "Providers", title: "Hostinger VPS" },
  { id: "place", group: "Crew", title: "Where agents run" },
  { id: "crew", group: "Crew", title: "Firstmate" },
  { id: "projects", group: "Workspace", title: "Projects folder" },
  { id: "folders", group: "Workspace", title: "Client folders" },
  { id: "org", group: "Workspace", title: "Organisation" },
  { id: "appearance", group: "Interface", title: "Appearance" },
  { id: "shortcuts", group: "Interface", title: "Keyboard shortcuts" },
  { id: "hotkey", group: "Interface", title: "Global hotkey" },
  { id: "menu-bar", group: "Interface", title: "Menu bar" },
  { id: "reader", group: "Interface", title: "Reader" },
  { id: "login", group: "System", title: "Launch at login" },
  { id: "cli", group: "System", title: "kinas CLI" },
];

/** What each in-window shortcut is for, beside its title. */
const SHORTCUT_NOTES: Record<AppAction, string> = {
  palette: "Search files, commands and settings. The sidebar's Search row opens it too.",
  "go.home": "The usage gauges, the night's work and what needs you.",
  "go.work": "The terminal, with Herdr in it.",
  "go.crew": "The crew's board of tasks.",
  "go.usage": "Every provider's quotas, the chart and the VPS.",
  "go.inbox": "The decisions waiting on you.",
  sidebar: "Remembered across launches.",
  settings: "This page.",
};

export const SETTINGS: readonly SettingEntry[] = [
  { id: "claude.connection", section: "claude", label: "Connection", description: "Kinas reads Claude's plan limits from your status line." },
  {
    id: "claude.lines",
    section: "claude",
    label: "Status line",
    description: "Three lines for ~/.claude/statusline-command.sh, after input=$(cat). Kinas never edits that file.",
  },
  { id: "ollama.key", section: "ollama", label: "API key", description: "Used only to read your usage. Stored in the Keychain." },
  { id: "convex.key", section: "convex", label: "Deploy key", description: "Mint it with only deployment:usage:view, so it can read usage and nothing else." },
  { id: "convex.url", section: "convex", label: "Deployment URL", description: "The deployment whose usage Kinas reads." },
  { id: "convex.plan", section: "convex", label: "Plan", description: "Starter or Professional: which published allowances the gauges divide by." },
  { id: "hostinger.token", section: "hostinger", label: "API token", description: "Kinas only sends GET requests with it: it lists the machine and reads its metrics." },
  { id: "hostinger.machine", section: "hostinger", label: "Machine", description: "The VPS Kinas watches." },
  { id: "place.where", section: "place", label: "Agents run on", description: "This Mac, or one Linux machine you own or rent and reach with ssh." },
  { id: "place.target", section: "place", label: "SSH target", description: "user@host, host, or an ssh alias. Your own key and ssh-agent; Kinas holds none." },
  { id: "place.label", section: "place", label: "Label", description: "The machine's short name in Kinas, such as homelab." },
  {
    id: "place.reachable",
    section: "place",
    label: "Reachable",
    description: "Whether Kinas reaches its companion there through ssh, and Herdr's version there and here.",
  },
  {
    id: "place.bootstrap",
    section: "place",
    label: "Install Kinas there",
    description: "While no companion answers: the one command to run in a terminal on the machine, with its SHA-256.",
  },
  {
    id: "place.setup",
    section: "place",
    label: "On the Linux machine",
    description: "Each piece Kinas checks there. Install is one yes each, as your own user, never as root.",
  },
  {
    id: "place.clones",
    section: "place",
    label: "Client folders there",
    description: "Your folders with a GitHub origin, cloned into ~/projects there with gh, one yes each.",
  },
  { id: "crew.firstmate", section: "crew", label: "Firstmate", description: "Its pinned commit, home, backend, tools and projects." },
  { id: "projects.root", section: "projects", label: "Projects folder", description: "Where kinas open and the palette look for files. The CLI reads it too." },
  { id: "folders.list", section: "folders", label: "Client folders", description: "Their colours, which are in the sidebar, which are internal, and adding one." },
  { id: "org.name", section: "org", label: "Organisation name", description: "Your organisation's name in Kinas." },
  { id: "appearance.theme", section: "appearance", label: "Theme", description: "Follow macOS, Light or Dark. The title bar follows." },
  { id: "appearance.accent", section: "appearance", label: "Accent", description: "The one colour for what you can click and what is selected." },
  ...SHORTCUT_ACTIONS.map((action) => ({ id: `shortcuts.${action}`, section: "shortcuts", label: SHORTCUT_TITLES[action], description: SHORTCUT_NOTES[action] })),
  { id: "hotkey.chord", section: "hotkey", label: "Global hotkey", description: "Brings Kinas forward and opens the palette, from any app, even when Kinas is hidden." },
  { id: "menu-bar.quota", section: "menu-bar", label: "Menu bar figure", description: "The one quota the menu bar shows." },
  { id: "reader.editor", section: "reader", label: "Editor for Open in editor", description: "Herdr's focused pane splits and runs this command with the file." },
  { id: "login.launch", section: "login", label: "Open Kinas when you log in", description: "Kinas starts with your Mac session." },
  { id: "cli.link", section: "cli", label: "kinas CLI", description: "Where ~/.local/bin/kinas points." },
];

export const sectionOf = (s: SettingEntry): SettingsSection => SECTIONS.find((x) => x.id === s.section)!;

/** The settings whose label or description — or its section's title — matches `q`, best first (rule 34). */
export function settingMatches(q: string): SettingEntry[] {
  return SETTINGS.map((s, i) => ({ s, i, score: score(q, s.label, `${sectionOf(s).title} ${s.description}`) }))
    .filter((x): x is { s: SettingEntry; i: number; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.s);
}
