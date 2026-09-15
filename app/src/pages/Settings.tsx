import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSettings,
  removeOllamaKey,
  saveOllamaKey,
  setGlobalHotkey,
  setLaunchAtLogin,
  setMenuBarQuota,
  setOrgName,
  type LinkStatus,
  type SettingsView,
} from "../api.ts";
import { chordFromEvent } from "../settings/chord.ts";
import { chordLabel, DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, SHORTCUT_TITLES, shortcutProblem, type AppAction, type Shortcuts } from "../settings/shortcuts.ts";

// Settings (PRD §3.9, amended 2026-09-15): a page, opened from the gear at the foot of the sidebar or ⌘,. It stays
// mounted like the other pages, so it reads again each time it comes on screen. Esc goes back to the page it was
// opened from (App.tsx).

/** R15: the three lines Miguel adds to ~/.claude/statusline-command.sh, directly after `input=$(cat)`. */
export const CLAUDE_HOOK_LINES = [
  "# Kinas: hand Claude's plan limits to the Kinas app — nothing else from this input",
  'kinas_f="$HOME/Library/Application Support/ai.sintralabs.kinas/inbox/claude-rate-limits.json"',
  `{ mkdir -p "\${kinas_f%/*}" && echo "$input" | jq -c '{rate_limits, session_id, captured_at: (now * 1000 | floor)}' > "$kinas_f.$$" && mv -f "$kinas_f.$$" "$kinas_f" || rm -f "$kinas_f.$$"; } 2>/dev/null`,
];

const MENU_BAR_CHOICES: [string, string][] = [
  ["claude-plan/session", "Claude · session"],
  ["claude-plan/week", "Claude · week"],
  ["ollama-cloud/session", "Ollama · session"],
  ["ollama-cloud/week", "Ollama · week"],
];

const HOOK_STATE: Record<SettingsView["claude_hook"]["state"], string> = {
  receiving: "receiving",
  last_seen: "last seen",
  never_seen: "never seen — add the lines below",
};

function linkText(link: LinkStatus): string {
  switch (link.state) {
    case "linked":
    case "created":
      return `~/.local/bin/kinas → ${link.target}`;
    case "repointed":
      return `~/.local/bin/kinas → ${link.target} (moved from ${link.from})`;
    case "conflict":
      return link.reason;
    case "no_bundle":
      return "not linked: this build is not running from Kinas.app";
  }
}

/** What Change is listening for: an in-window shortcut, or the global hotkey. */
type Recording = AppAction | "hotkey";

export function SettingsPage({
  active,
  shortcuts,
  onShortcutsChange,
}: {
  active: boolean;
  shortcuts: Shortcuts;
  onShortcutsChange: (next: Shortcuts) => Promise<void>;
}) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  /** The last outcome, shown under the section that produced it. */
  const [message, setMessage] = useState<{ section: string; text: string } | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(
    () =>
      void getSettings().then(
        (s) => {
          setSettings(s);
          setLoadError(null);
        },
        (e: unknown) => setLoadError(String(e)),
      ),
    [],
  );

  // On screen: read again (the hook status ages) and take focus from the page left behind, the terminal included.
  useEffect(() => {
    if (!active) {
      setRecording(null);
      return;
    }
    load();
    root.current?.focus({ preventScroll: true });
  }, [active, load]);

  const act = async (section: string, what: () => Promise<void>, done?: string) => {
    setMessage(null);
    try {
      await what();
      if (done) setMessage({ section, text: done });
    } catch (e) {
      setMessage({ section, text: String(e) });
    }
    load();
  };

  const record = (target: Recording, chord: string) => {
    const section = target === "hotkey" ? "hotkey" : "shortcuts";
    const problem = shortcutProblem(target, chord, shortcuts, settings?.global_hotkey ?? "");
    if (problem) return setMessage({ section, text: problem });
    void act(section, () => (target === "hotkey" ? setGlobalHotkey(chord) : onShortcutsChange({ ...shortcuts, [target]: chord })));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // App.tsx ignores keys inside [data-recording], so the chord lands here and runs nothing.
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return setRecording(null);
    const chord = chordFromEvent(e.nativeEvent);
    if (!chord) return;
    setRecording(null);
    record(recording, chord);
  };

  const note = (section: string) => message?.section === section && <p className="settings-message">{message.text}</p>;
  const recorder = (target: Recording) => ({
    recording: recording === target,
    onRecording: (on: boolean) => setRecording(on ? target : null),
  });

  return (
    <div className="settings" ref={root} tabIndex={-1} onKeyDown={onKeyDown} data-recording={recording ? "true" : undefined}>
      <header className="page-header">
        <h1>Settings</h1>
      </header>
      {!settings ? (
        <p className="muted">{loadError ?? "Reading settings…"}</p>
      ) : (
        <>
          <section className="settings-section" data-section="claude">
            <h2>Claude Code connection</h2>
            <p className="muted" data-testid="hook-status">
              Status: {HOOK_STATE[settings.claude_hook.state]}
              {settings.claude_hook.minutes_ago !== null && settings.claude_hook.state === "last_seen" && ` ${settings.claude_hook.minutes_ago} min ago`}
            </p>
            <p className="muted">
              Add these lines to <code>~/.claude/statusline-command.sh</code>, directly after <code>input=$(cat)</code>. Kinas never edits that file.
            </p>
            {CLAUDE_HOOK_LINES.map((line, i) => (
              <div className="hook-line" key={i}>
                <code>{line}</code>
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(line).then(() => {
                      setCopied(i);
                      window.setTimeout(() => setCopied(null), 1500);
                    })
                  }
                >
                  {copied === i ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
          </section>

          <section className="settings-section" data-section="ollama">
            <h2>Ollama Cloud API key</h2>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                setSaving(true);
                void act("ollama", () => saveOllamaKey(key), "Saved").finally(() => {
                  setSaving(false);
                  setKey("");
                });
              }}
            >
              <input
                type="password"
                className="field"
                autoComplete="off"
                aria-label="Ollama Cloud API key"
                placeholder={settings.ollama_key_saved ? "A key is saved" : "No key saved"}
                value={key}
                onChange={(e) => setKey(e.currentTarget.value)}
              />
              <button type="submit" className="button" disabled={saving || key.trim() === ""}>
                {saving ? "Saving…" : "Save"}
              </button>
              {settings.ollama_key_saved && (
                <button type="button" className="button" onClick={() => void act("ollama", () => removeOllamaKey(), "Removed")}>
                  Remove
                </button>
              )}
            </form>
            {note("ollama")}
          </section>

          <section className="settings-section" data-section="shortcuts">
            <h2>Keyboard shortcuts</h2>
            <p className="muted">Each one includes ⌘, so none of them takes a key from the terminal. Press Change, then the new chord; Esc cancels.</p>
            <ul className="shortcut-list">
              {SHORTCUT_ACTIONS.map((action) => (
                <ShortcutRow key={action} id={action} title={SHORTCUT_TITLES[action]} chord={shortcuts[action]} {...recorder(action)} />
              ))}
            </ul>
            {note("shortcuts")}
            <button
              type="button"
              className="button"
              disabled={SHORTCUT_ACTIONS.every((action) => shortcuts[action] === DEFAULT_SHORTCUTS[action])}
              onClick={() => void act("shortcuts", () => onShortcutsChange(DEFAULT_SHORTCUTS), "Defaults restored")}
            >
              Restore defaults
            </button>
          </section>

          <section className="settings-section" data-section="hotkey">
            <h2>Global hotkey</h2>
            <p className="muted">Works from any app, even when Kinas is hidden.</p>
            <ul className="shortcut-list">
              <ShortcutRow id="hotkey" title="Bring Kinas forward and open the palette" chord={settings.global_hotkey} {...recorder("hotkey")} />
            </ul>
            {settings.hotkey_error && <p className="problem">hotkey unavailable: {settings.hotkey_error}</p>}
            {note("hotkey")}
          </section>

          <section className="settings-section" data-section="menu-bar">
            <h2>Menu bar</h2>
            <select className="field" aria-label="Menu bar quota" value={settings.menu_bar_quota} onChange={(e) => void act("menu-bar", () => setMenuBarQuota(e.currentTarget.value))}>
              {MENU_BAR_CHOICES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {note("menu-bar")}
          </section>

          <section className="settings-section" data-section="login">
            <h2>Launch at login</h2>
            <label className="row">
              <input type="checkbox" checked={settings.launch_at_login} onChange={(e) => void act("login", () => setLaunchAtLogin(e.currentTarget.checked))} />
              Open Kinas when I log in
            </label>
            {settings.autostart_error && <p className="problem">launch at login unavailable: {settings.autostart_error}</p>}
            {note("login")}
          </section>

          <section className="settings-section" data-section="org">
            <h2>Organisation name</h2>
            <input
              className="field"
              aria-label="Organisation name"
              defaultValue={settings.org_name}
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (name && name !== settings.org_name) void act("org", () => setOrgName(name));
              }}
            />
            {note("org")}
          </section>

          <section className="settings-section" data-section="cli">
            <h2>kinas CLI</h2>
            <p className={settings.cli_link.state === "conflict" ? "problem" : "muted"} data-testid="cli-link">
              {linkText(settings.cli_link)}
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function ShortcutRow({
  id,
  title,
  chord,
  recording,
  onRecording,
}: {
  id: string;
  title: string;
  chord: string;
  recording: boolean;
  onRecording: (on: boolean) => void;
}) {
  return (
    <li className="shortcut" data-shortcut={id} data-recording={recording ? "true" : undefined}>
      <span className="shortcut-title">{title}</span>
      <kbd className="shortcut-chord">{recording ? "Press a chord…" : chordLabel(chord)}</kbd>
      <button
        type="button"
        className="button"
        onClick={(e) => {
          // WebKit does not focus a button on click, and the recorder hears the chord through focus.
          e.currentTarget.focus();
          onRecording(!recording);
        }}
        onBlur={() => recording && onRecording(false)}
      >
        {recording ? "Cancel" : "Change"}
      </button>
    </li>
  );
}
