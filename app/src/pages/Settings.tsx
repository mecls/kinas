import { useCallback, useEffect, useRef, useState } from "react";
import {
  addClientFolder,
  getSettings,
  removeOllamaKey,
  saveOllamaKey,
  type ProjectRow,
  setAccent,
  setAppearance,
  setFolderCategory,
  setFolderHidden,
  setFolderInternal,
  setFolderRemoved,
  setGlobalHotkey,
  setLaunchAtLogin,
  setMenuBarQuota,
  setOrgName,
  setProjectsRoot,
  setReaderEditor,
  type LinkStatus,
  type SettingsView,
} from "../api.ts";
import { chordFromEvent } from "../settings/chord.ts";
import { ConvexSection } from "../settings/ConvexSection.tsx";
import { CrewSection } from "../settings/CrewSection.tsx";
import { HostingerSection } from "../settings/HostingerSection.tsx";
import { AccentField } from "../ui/AccentField.tsx";
import { addedLine, listedFolders, removedFolders, seatFolders, type SeatedFolder } from "../shell/folders.ts";
import { CATEGORIES } from "../ui/category.ts";
import { Button, Card, Chip, Section, SectionHeader, Switch, TitleRow } from "../ui/index.ts";
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

const APPEARANCE_CHOICES: [SettingsView["appearance"], string][] = [
  ["system", "Follow macOS"],
  ["light", "Light"],
  ["dark", "Dark"],
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
  projects,
  onProjectsChange,
}: {
  active: boolean;
  shortcuts: Shortcuts;
  onShortcutsChange: (next: Shortcuts) => Promise<void>;
  /** The client folders the sidebar lists (App.tsx), and the way to have them read again after a change here. */
  projects: readonly ProjectRow[];
  onProjectsChange: () => void;
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
      <TitleRow title="Settings" />
      {!settings ? (
        <p className="settings-help">{loadError ?? "Reading settings…"}</p>
      ) : (
        <>
          <Section className="settings-group" data-group="providers">
            <SectionHeader title="Providers" />
            <Card className="settings-section" data-section="claude">
              <h2>Claude Code connection</h2>
              <p className="settings-help" data-testid="hook-status">
                Status: {HOOK_STATE[settings.claude_hook.state]}
                {settings.claude_hook.minutes_ago !== null && settings.claude_hook.state === "last_seen" && ` ${settings.claude_hook.minutes_ago} min ago`}
              </p>
              <p className="settings-help">
                Add these lines to <code>~/.claude/statusline-command.sh</code>, directly after <code>input=$(cat)</code>. Kinas never edits that file.
              </p>
              {CLAUDE_HOOK_LINES.map((line, i) => (
                <div className="hook-line" key={i}>
                  <code>{line}</code>
                  <Button
                    className="button"
                    onClick={() =>
                      void navigator.clipboard.writeText(line).then(() => {
                        setCopied(i);
                        window.setTimeout(() => setCopied(null), 1500);
                      })
                    }
                  >
                    {copied === i ? "Copied" : "Copy"}
                  </Button>
                </div>
              ))}
            </Card>
            <Card className="settings-section" data-section="ollama">
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
                  className="ui-input field"
                  autoComplete="off"
                  aria-label="Ollama Cloud API key"
                  placeholder={settings.ollama_key_saved ? "A key is saved" : "No key saved"}
                  value={key}
                  onChange={(e) => setKey(e.currentTarget.value)}
                />
                <Button type="submit" kind="primary" className="button" disabled={saving || key.trim() === ""}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                {settings.ollama_key_saved && (
                  <Button className="button" onClick={() => void act("ollama", () => removeOllamaKey(), "Removed")}>
                    Remove
                  </Button>
                )}
              </form>
              {note("ollama")}
            </Card>
            <ConvexSection settings={settings} act={act} note={note} />
            <HostingerSection settings={settings} act={act} note={note} />
          </Section>

          <Section className="settings-group" data-group="crew">
            <SectionHeader title="Crew" />
            <CrewSection active={active} />
          </Section>

          <Section className="settings-group" data-group="client-folders">
            <SectionHeader title="Client folders" />
            <Card className="settings-section" data-section="projects">
              <h2>Projects folder</h2>
              <p className="settings-help">
                Where `kinas open` looks: a bare name is searched for under this folder, and anything inside it opens without a flag. The CLI reads this too.
              </p>
              <input
                className="ui-input field"
                aria-label="Projects folder"
                defaultValue={settings.projects_root}
                spellCheck={false}
                disabled={settings.projects_root_from_env}
                onBlur={(e) => {
                  const value = e.currentTarget.value.trim();
                  if (value && value !== settings.projects_root) void act("projects", () => setProjectsRoot(value).then(() => {}));
                }}
              />
              {settings.projects_root_from_env && <p className="problem">KINAS_ROOT is set in the environment, so it wins over this field.</p>}
              {note("projects")}
            </Card>
            <Card className="settings-section" data-section="folders">
              <h2>Client folders</h2>
              <p className="settings-help">
                Every git repository up to three levels under the projects folder, and the folders you added. The chip is the folder&apos;s colour on every page; click it for the next of the six. A folder out of the sidebar is off Home too. An internal folder is listed last, with the tag. Remove takes a folder out of Kinas without touching it on disk.
              </p>
              <ClientFolders
                projects={projects}
                onCategory={(name, cat) => void act("folders", () => setFolderCategory(name, cat).then(onProjectsChange))}
                onInternal={(name, internal) => void act("folders", () => setFolderInternal(name, internal).then(onProjectsChange))}
                onHidden={(f, hidden) => void act("folders", () => setFolderHidden(f.path, hidden).then(onProjectsChange))}
                onRemoved={(f, removed) => void act("folders", () => setFolderRemoved(f.path, removed).then(onProjectsChange), removed ? `Removed ${f.name}. Restore it below.` : `Restored ${f.name}`)}
                onAdd={() =>
                  void act("folders", async () => {
                    const result = await addClientFolder();
                    onProjectsChange();
                    const line = addedLine(result);
                    if (line) setMessage({ section: "folders", text: line });
                  })
                }
              />
              {note("folders")}
            </Card>
          </Section>

          <Section className="settings-group" data-group="shortcuts">
            <SectionHeader title="Shortcuts" />
            <Card className="settings-section" data-section="shortcuts">
              <h2>Keyboard shortcuts</h2>
              <p className="settings-help">Each one includes ⌘, so none of them takes a key from the terminal. Press Change, then the new chord; Esc cancels.</p>
              <ul className="shortcut-list">
                {SHORTCUT_ACTIONS.map((action) => (
                  <ShortcutRow key={action} id={action} title={SHORTCUT_TITLES[action]} chord={shortcuts[action]} {...recorder(action)} />
                ))}
              </ul>
              {note("shortcuts")}
              <Button
                className="button"
                disabled={SHORTCUT_ACTIONS.every((action) => shortcuts[action] === DEFAULT_SHORTCUTS[action])}
                onClick={() => void act("shortcuts", () => onShortcutsChange(DEFAULT_SHORTCUTS), "Defaults restored")}
              >
                Restore defaults
              </Button>
            </Card>
            <Card className="settings-section" data-section="hotkey">
              <h2>Global hotkey</h2>
              <p className="settings-help">Works from any app, even when Kinas is hidden.</p>
              <ul className="shortcut-list">
                <ShortcutRow id="hotkey" title="Bring Kinas forward and open the palette" chord={settings.global_hotkey} {...recorder("hotkey")} />
              </ul>
              {settings.hotkey_error && <p className="problem">hotkey unavailable: {settings.hotkey_error}</p>}
              {note("hotkey")}
            </Card>
          </Section>

          <Section className="settings-group" data-group="appearance">
            <SectionHeader title="Appearance" />
            <Card className="settings-section" data-section="appearance">
              <h2>Appearance</h2>
              <p className="settings-help">Warm white with royal blue, or the dark ground. The title bar follows.</p>
              <select className="ui-input field" aria-label="Appearance" value={settings.appearance} onChange={(e) => void act("appearance", () => setAppearance(e.currentTarget.value))}>
                {APPEARANCE_CHOICES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="settings-help">The accent: the selected nav row, primary buttons and a selected card's edge. A shade that would not read in either ground is not saved.</p>
              <AccentField value={settings.accent} onChange={(hex) => void act("appearance", () => setAccent(hex))} />
              {note("appearance")}
            </Card>
          </Section>

          <Section className="settings-group" data-group="advanced">
            <SectionHeader title="Advanced" />
            <Card className="settings-section" data-section="menu-bar">
              <h2>Menu bar</h2>
              <select className="ui-input field" aria-label="Menu bar quota" value={settings.menu_bar_quota} onChange={(e) => void act("menu-bar", () => setMenuBarQuota(e.currentTarget.value))}>
                {MENU_BAR_CHOICES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {note("menu-bar")}
            </Card>
            <Card className="settings-section" data-section="login">
              <h2>Launch at login</h2>
              <label className="row">
                <input type="checkbox" checked={settings.launch_at_login} onChange={(e) => void act("login", () => setLaunchAtLogin(e.currentTarget.checked))} />
                Open Kinas when I log in
              </label>
              {settings.autostart_error && <p className="problem">launch at login unavailable: {settings.autostart_error}</p>}
              {note("login")}
            </Card>
            <Card className="settings-section" data-section="org">
              <h2>Organisation name</h2>
              <input
                className="ui-input field"
                aria-label="Organisation name"
                defaultValue={settings.org_name}
                onBlur={(e) => {
                  const name = e.currentTarget.value.trim();
                  if (name && name !== settings.org_name) void act("org", () => setOrgName(name));
                }}
              />
              {note("org")}
            </Card>
            <Card className="settings-section" data-section="reader">
              <h2>Reader</h2>
              <p className="settings-help">Open in editor splits Herdr&apos;s focused pane and runs this command with the file.</p>
              <input
                className="ui-input field"
                aria-label="Editor for Open in editor"
                defaultValue={settings.reader_editor}
                spellCheck={false}
                onBlur={(e) => {
                  const value = e.currentTarget.value.trim();
                  if (value !== settings.reader_editor) void act("reader", () => setReaderEditor(value));
                }}
              />
              {note("reader")}
            </Card>
            <Card className="settings-section" data-section="cli">
              <h2>kinas CLI</h2>
              <p className={settings.cli_link.state === "conflict" ? "problem" : "settings-help"} data-testid="cli-link">
                {linkText(settings.cli_link)}
              </p>
            </Card>
          </Section>
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
      <Button
        className="button"
        onClick={(e) => {
          // WebKit does not focus a button on click, and the recorder hears the chord through focus.
          e.currentTarget.focus();
          onRecording(!recording);
        }}
        onBlur={() => recording && onRecording(false)}
      >
        {recording ? "Cancel" : "Change"}
      </Button>
    </li>
  );
}

/**
 * The client folders' choices (DESIGN.md §3.1): the chip cycles the six categories, In sidebar hides a folder from the
 * sidebar and Home, Internal lists it last, Remove takes it out of Kinas — into the Removed list, where Restore brings
 * it back shown (folder views, 2026-09-23). Add a folder… takes any folder inside the projects folder.
 *
 * The colours are seated over every folder, removed ones too, as the sidebar and Home seat them; the rows keep the
 * listing's order, so a switch never moves one.
 */
function ClientFolders({
  projects,
  onCategory,
  onInternal,
  onHidden,
  onRemoved,
  onAdd,
}: {
  projects: readonly ProjectRow[];
  onCategory: (name: string, cat: number) => void;
  onInternal: (name: string, internal: boolean) => void;
  onHidden: (folder: ProjectRow, hidden: boolean) => void;
  onRemoved: (folder: ProjectRow, removed: boolean) => void;
  onAdd: () => void;
}) {
  const seated = new Map(seatFolders(projects).map((f) => [f.path, f]));
  // The listing's order, each with the colour it was seated with.
  const inOrder = projects.map((p) => seated.get(p.path)!);
  const listed = listedFolders(inOrder);
  const removed = removedFolders(inOrder);
  return (
    <>
      {projects.length === 0 ? (
        <p className="settings-help">No repositories under the projects folder yet.</p>
      ) : listed.length === 0 ? (
        <p className="settings-help">Every client folder is removed. Restore one below.</p>
      ) : (
        <ul className="settings-folders" aria-label="Client folders">
          <li className="settings-folders-head" aria-hidden="true">
            <span />
            <span />
            <span>In sidebar</span>
            <span>Internal</span>
            <span />
          </li>
          {listed.map((f) => (
            <FolderRow key={f.path} folder={f} onCategory={onCategory} onInternal={onInternal} onHidden={onHidden} onRemoved={onRemoved} />
          ))}
        </ul>
      )}
      <Button className="button settings-folders-add" onClick={onAdd}>
        Add a folder…
      </Button>
      {removed.length > 0 && (
        <>
          <h3 className="settings-removed-h">Removed</h3>
          <ul className="settings-folders settings-removed" aria-label="Removed folders">
            {removed.map((f) => (
              <li key={f.path} data-folder={f.name} data-cat={f.cat}>
                <span className="settings-folders-cell">
                  <Chip cat={f.cat} />
                </span>
                <span className="settings-folder-name" title={f.display}>
                  {f.name}
                </span>
                <Button kind="text" aria-label={`Restore ${f.name}`} onClick={() => onRemoved(f, false)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function FolderRow({
  folder: f,
  onCategory,
  onInternal,
  onHidden,
  onRemoved,
}: {
  folder: SeatedFolder;
  onCategory: (name: string, cat: number) => void;
  onInternal: (name: string, internal: boolean) => void;
  onHidden: (folder: ProjectRow, hidden: boolean) => void;
  onRemoved: (folder: ProjectRow, removed: boolean) => void;
}) {
  return (
    <li data-folder={f.name} data-cat={f.cat} data-hidden={f.hidden ? "" : undefined}>
      <button type="button" className="settings-folder-chip" aria-label={`${f.name}: category ${f.cat} of ${CATEGORIES}, click for the next`} title={`Category ${f.cat} of ${CATEGORIES}`} onClick={() => onCategory(f.name, (f.cat % CATEGORIES) + 1)}>
        <Chip cat={f.cat} />
      </button>
      <span className="settings-folder-name" title={f.display}>
        {f.name}
      </span>
      <Switch checked={!f.hidden} onChange={(shown) => onHidden(f, !shown)} aria-label={`${f.name} is in the sidebar`} />
      <Switch checked={f.internal} onChange={(next) => onInternal(f.name, next)} aria-label={`${f.name} is internal`} />
      <Button kind="text" aria-label={`Remove ${f.name} from Kinas`} onClick={() => onRemoved(f, true)}>
        Remove
      </Button>
    </li>
  );
}
