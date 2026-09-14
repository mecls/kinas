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

// The ⌘, sheet (PRD §3.9). A sheet, not a page: two pages is the rule.

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

/** A keydown → Tauri accelerator ("Cmd+Shift+Space"). Returns null for a bare modifier. */
export function chordFromEvent(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
  const parts = [e.metaKey && "Cmd", e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
  const key = e.code === "Space" ? "Space" : e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [...parts, key].join("+");
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const sheet = useRef<HTMLDivElement>(null);

  const load = useCallback(() => void getSettings().then(setSettings, (e: unknown) => setMessage(String(e))), []);
  useEffect(() => {
    load();
    sheet.current?.focus();
  }, [load]);

  const act = async (what: () => Promise<void>, done?: string) => {
    setMessage(null);
    try {
      await what();
      if (done) setMessage(done);
    } catch (e) {
      setMessage(String(e));
    }
    load();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (recording) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      const chord = chordFromEvent(e.nativeEvent);
      if (!chord) return;
      setRecording(false);
      if (!e.metaKey) return setMessage("The global hotkey must include ⌘");
      void act(() => setGlobalHotkey(chord));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="sheet" role="dialog" aria-label="Settings" tabIndex={-1} ref={sheet} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <header className="sheet-head">
          <h2>Settings</h2>
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
        </header>
        {!settings ? (
          <p className="muted">{message ?? "Reading settings…"}</p>
        ) : (
          <>
            <section className="sheet-section" data-section="claude">
              <h3>Claude Code connection</h3>
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

            <section className="sheet-section" data-section="ollama">
              <h3>Ollama Cloud API key</h3>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSaving(true);
                  void act(() => saveOllamaKey(key), "Saved").finally(() => {
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
                  <button type="button" className="button" onClick={() => void act(() => removeOllamaKey(), "Removed")}>
                    Remove
                  </button>
                )}
              </form>
            </section>

            <section className="sheet-section" data-section="choices">
              <h3>Menu bar</h3>
              <select className="field" aria-label="Menu bar quota" value={settings.menu_bar_quota} onChange={(e) => void act(() => setMenuBarQuota(e.currentTarget.value))}>
                {MENU_BAR_CHOICES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>

              <h3>Global hotkey</h3>
              <div className="row">
                <code data-testid="hotkey">{settings.global_hotkey}</code>
                <button type="button" className="button" onClick={() => setRecording(true)}>
                  {recording ? "Press a chord with ⌘…" : "Change"}
                </button>
              </div>
              {settings.hotkey_error && <p className="problem">hotkey unavailable: {settings.hotkey_error}</p>}

              <h3>Launch at login</h3>
              <label className="row">
                <input type="checkbox" checked={settings.launch_at_login} onChange={(e) => void act(() => setLaunchAtLogin(e.currentTarget.checked))} />
                Open Kinas when I log in
              </label>
              {settings.autostart_error && <p className="problem">launch at login unavailable: {settings.autostart_error}</p>}

              <h3>Organisation name</h3>
              <input
                className="field"
                aria-label="Organisation name"
                defaultValue={settings.org_name}
                onBlur={(e) => {
                  const name = e.currentTarget.value.trim();
                  if (name && name !== settings.org_name) void act(() => setOrgName(name));
                }}
              />
            </section>

            <section className="sheet-section" data-section="cli">
              <h3>kinas CLI</h3>
              <p className={settings.cli_link.state === "conflict" ? "problem" : "muted"} data-testid="cli-link">
                {linkText(settings.cli_link)}
              </p>
            </section>

            {message && <p className="sheet-message">{message}</p>}
          </>
        )}
      </div>
    </div>
  );
}
