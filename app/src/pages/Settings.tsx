import { useEffect, useMemo, useRef, useState } from "react";
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
import { writeClipboard } from "../terminal/clipboard.ts";
import { ConvexSection } from "../settings/ConvexSection.tsx";
import { CrewSection } from "../settings/CrewSection.tsx";
import { PlaceSection } from "../settings/PlaceSection.tsx";
import { HostingerSection } from "../settings/HostingerSection.tsx";
import { AccentField } from "../ui/AccentField.tsx";
import { addedLine, listedFolders, removedFolders, seatFolders, type SeatedFolder } from "../shell/folders.ts";
import { latestOnly } from "../shell/latest.ts";
import { CATEGORIES } from "../ui/category.ts";
import { Button, Card, Chip, Dot, Switch, TitleRow } from "../ui/index.ts";
import { SECTIONS, SETTINGS, settingMatches } from "../settings/index.ts";
import { Block, Row, SettingsMatch } from "../settings/Row.tsx";
import { SettingsNav } from "../settings/SettingsNav.tsx";
import { chordLabel, DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, shortcutProblem, type AppAction, type Shortcuts } from "../settings/shortcuts.ts";
import { failedRead } from "./readFailure.ts";

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

/** What a setting's focus lands on: its first control that can take it. */
const CONTROL = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";

/** What Change is listening for: an in-window shortcut, or the global hotkey. */
type Recording = AppAction | "hotkey";

export function SettingsPage({
  active,
  shortcuts,
  onShortcutsChange,
  projects,
  onProjectsChange,
  target = null,
}: {
  active: boolean;
  shortcuts: Shortcuts;
  onShortcutsChange: (next: Shortcuts) => Promise<void>;
  /** The client folders the sidebar lists (App.tsx), and the way to have them read again after a change here. */
  projects: readonly ProjectRow[];
  onProjectsChange: () => void;
  /** A setting the palette chose (settings/index.ts): scrolled to, its control focused. `seq` makes a repeat new. */
  target?: { id: string; seq: number } | null;
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
  const body = useRef<HTMLDivElement>(null);
  /** Settings' own search (rule 34): the rows whose label or description matches, and the sections that hold them. */
  const [query, setQuery] = useState("");
  const matchingIds = useMemo(() => (query.trim() === "" ? null : new Set(settingMatches(query).map((s) => s.id))), [query]);
  const matchingSections = useMemo(() => (matchingIds === null ? null : new Set(SETTINGS.filter((s) => matchingIds.has(s.id)).map((s) => s.section))), [matchingIds]);
  /** The section in view, marked in the list (rule 32). */
  const [current, setCurrent] = useState(SECTIONS[0]!.id);
  /** Rule 35: the shell lines, unfolded on request while the connection is receiving. */
  const [showLines, setShowLines] = useState(false);

  // Read on every visit and after every change, so two reads can be out at once — and get_settings waits on three
  // Keychain calls, so they can finish in either order. Only the newest counts (shell/latest.ts): Light then Dark must
  // not read back as Light because the first read was the slower one.
  const load = useMemo(
    () =>
      latestOnly(
        getSettings,
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

  // The palette's setting (interface polish, rule 16): once the page shows and its settings are read, scroll the
  // setting into view and focus its control — after the effect above has taken focus for the page. A setting with no
  // control of its own (the hook's status, the CLI's link) takes focus itself.
  const targeted = useRef(0);
  useEffect(() => {
    if (!active || !target || target.seq === targeted.current || !settings) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-setting="${CSS.escape(target.id)}"]`);
    if (!el) return;
    targeted.current = target.seq;
    el.scrollIntoView({ block: "center" });
    const control = el.matches(CONTROL) ? el : el.querySelector<HTMLElement>(CONTROL);
    if (control) control.focus({ preventScroll: true });
    else {
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }
  }, [active, target, settings]);

  /** A section clicked in the list: marked while it stays on screen, even where the page cannot scroll it to the top. */
  const clicked = useRef<string | null>(null);
  /** A click in the section list: the page scrolls the section to its top, and the list marks it at once. */
  const showSection = (id: string) => {
    clicked.current = id;
    setCurrent(id);
    body.current?.querySelector(`[data-block="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
  };

  // The section in view (rule 32): the topmost section whose top has passed under the page's top third. Read on the
  // page's scroll, which is the scroll container the sections move in; an IntersectionObserver gave the last section
  // no chance when it is too short to reach the top.
  useEffect(() => {
    const page = root.current?.closest<HTMLElement>("section.page");
    if (!active || !settings || !page) return;
    const read = () => {
      const blocks = [...(body.current?.querySelectorAll<HTMLElement>(".settings-block:not([hidden])") ?? [])];
      if (blocks.length === 0) return;
      const pinned = clicked.current ? blocks.find((b) => b.dataset.block === clicked.current) : undefined;
      if (pinned) {
        const box = pinned.getBoundingClientRect();
        const view = page.getBoundingClientRect();
        if (box.bottom > view.top && box.top < view.bottom) return;
        clicked.current = null;
      }
      const line = page.getBoundingClientRect().top + page.clientHeight / 3;
      const atEnd = page.scrollTop + page.clientHeight >= page.scrollHeight - 2;
      const passed = blocks.filter((b) => b.getBoundingClientRect().top <= line);
      const shown = atEnd ? blocks[blocks.length - 1]! : (passed[passed.length - 1] ?? blocks[0]!);
      setCurrent(shown.dataset.block ?? SECTIONS[0]!.id);
    };
    page.addEventListener("scroll", read, { passive: true });
    return () => page.removeEventListener("scroll", read);
  }, [active, settings]);

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
  // Read again on every visit and after every change: a failed read keeps what was read before, and says so (ADR 0004).
  const unread = settings ? failedRead("settings", loadError, true) : null;

  const hook = settings?.claude_hook;
  // Rule 35: the shell lines fold away once the connection is receiving, and stay open while it is not.
  const linesFolded = hook?.state === "receiving" && !showLines;
  return (
    <div className="settings" ref={root} tabIndex={-1} onKeyDown={onKeyDown} data-recording={recording ? "true" : undefined}>
      <TitleRow title="Settings" />
      {unread && (
        <p className="problem" data-testid="settings-read-error">
          {unread}
        </p>
      )}
      {!settings || !hook ? (
        <p className="settings-help">{failedRead("settings", loadError, false) ?? "Reading settings…"}</p>
      ) : (
        <div className="settings-cols">
          <SettingsNav query={query} onQuery={setQuery} current={current} matching={matchingSections} onSection={showSection} />
          <SettingsMatch.Provider value={matchingIds}>
            <div className="settings-body" ref={body}>
              {matchingIds !== null && matchingIds.size === 0 && (
                <p className="settings-empty" data-testid="settings-no-match">
                  No setting matches &ldquo;{query.trim()}&rdquo;.
                </p>
              )}
              <div className="settings-group" data-group="providers">
                <Block id="claude">
                  <Card className="settings-section" data-section="claude">
                    <Row id="claude.connection">
                      <span className="settings-status" data-testid="hook-status" data-state={hook.state}>
                        <Dot color={hook.state === "receiving" ? "--ok" : "--stale"} />
                        {HOOK_STATE[hook.state]}
                        {hook.minutes_ago !== null && hook.state === "last_seen" && ` ${hook.minutes_ago} min ago`}
                      </span>
                    </Row>
                    <Row id="claude.lines" wide={!linesFolded}>
                      {linesFolded ? (
                        <Button className="button" onClick={() => setShowLines(true)}>
                          Show the lines
                        </Button>
                      ) : (
                        CLAUDE_HOOK_LINES.map((line, i) => (
                          <div className="hook-line" key={i}>
                            <code>{line}</code>
                            <Button
                              className="button"
                              // The app's one clipboard door (terminal/clipboard.ts), as the Crew page's Copy uses it:
                              // "Copied" only once the line is on the clipboard.
                              onClick={() =>
                                void writeClipboard(line).then((ok) => {
                                  if (!ok) return;
                                  setCopied(i);
                                  window.setTimeout(() => setCopied(null), 1500);
                                })
                              }
                            >
                              {copied === i ? "Copied" : "Copy"}
                            </Button>
                          </div>
                        ))
                      )}
                    </Row>
                  </Card>
                </Block>
                <Block id="ollama">
                  <Card className="settings-section" data-section="ollama">
                    <Row id="ollama.key">
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
                    </Row>
                    {note("ollama")}
                  </Card>
                </Block>
                <ConvexSection settings={settings} act={act} note={note} />
                <HostingerSection settings={settings} act={act} note={note} />
              </div>

              <div className="settings-group" data-group="crew">
                <PlaceSection active={active} />
                <CrewSection active={active} />
              </div>

              <div className="settings-group" data-group="workspace">
                <Block id="projects">
                  <Card className="settings-section" data-section="projects">
                    <Row id="projects.root" wide>
                      <input
                        className="ui-input field settings-wide-field"
                        aria-label="Projects folder"
                        defaultValue={settings.projects_root}
                        spellCheck={false}
                        disabled={settings.projects_root_from_env}
                        onBlur={(e) => {
                          const value = e.currentTarget.value.trim();
                          if (value && value !== settings.projects_root) void act("projects", () => setProjectsRoot(value).then(onProjectsChange));
                        }}
                      />
                      {settings.projects_root_from_env && <p className="problem">KINAS_ROOT is set in the environment, so it wins over this field.</p>}
                    </Row>
                    {note("projects")}
                  </Card>
                </Block>
                <Block id="folders">
                  <Card className="settings-section" data-section="folders">
                    <Row id="folders.list" wide>
                      <p className="settings-help">
                        The chip is the folder&apos;s colour on every page; click it for the next of the six. A folder out of the sidebar is off Home too. An internal folder is listed last, with the tag. Remove takes a folder out of Kinas without touching it on disk.
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
                    </Row>
                    {note("folders")}
                  </Card>
                </Block>
                <Block id="org">
                  <Card className="settings-section" data-section="org">
                    <Row id="org.name">
                      <input
                        className="ui-input field"
                        aria-label="Organisation name"
                        defaultValue={settings.org_name}
                        onBlur={(e) => {
                          const name = e.currentTarget.value.trim();
                          if (name && name !== settings.org_name) void act("org", () => setOrgName(name));
                        }}
                      />
                    </Row>
                    {note("org")}
                  </Card>
                </Block>
              </div>

              <div className="settings-group" data-group="interface">
                <Block id="appearance">
                  <Card className="settings-section" data-section="appearance">
                    <Row id="appearance.theme">
                      <select className="ui-input field" aria-label="Appearance" value={settings.appearance} onChange={(e) => void act("appearance", () => setAppearance(e.currentTarget.value))}>
                        {APPEARANCE_CHOICES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Row>
                    <Row id="appearance.accent" wide>
                      <AccentField value={settings.accent} onChange={(hex) => void act("appearance", () => setAccent(hex))} />
                    </Row>
                    {note("appearance")}
                  </Card>
                </Block>
                <Block id="shortcuts">
                  <Card className="settings-section" data-section="shortcuts">
                    {SHORTCUT_ACTIONS.map((action) => (
                      <Row key={action} id={`shortcuts.${action}`}>
                        <ShortcutRow id={action} chord={shortcuts[action]} {...recorder(action)} />
                      </Row>
                    ))}
                    <div className="settings-card-foot">
                      <p className="settings-help">Each one includes ⌘, so none of them takes a key from the terminal. Press Change, then the new chord; Esc cancels.</p>
                      {note("shortcuts")}
                      <Button
                        className="button"
                        disabled={SHORTCUT_ACTIONS.every((action) => shortcuts[action] === DEFAULT_SHORTCUTS[action])}
                        onClick={() => void act("shortcuts", () => onShortcutsChange(DEFAULT_SHORTCUTS), "Defaults restored")}
                      >
                        Restore defaults
                      </Button>
                    </div>
                  </Card>
                </Block>
                <Block id="hotkey">
                  <Card className="settings-section" data-section="hotkey">
                    <Row id="hotkey.chord">
                      <ShortcutRow id="hotkey" chord={settings.global_hotkey} {...recorder("hotkey")} />
                    </Row>
                    {settings.hotkey_error && <p className="problem">hotkey unavailable: {settings.hotkey_error}</p>}
                    {note("hotkey")}
                  </Card>
                </Block>
                <Block id="menu-bar">
                  <Card className="settings-section" data-section="menu-bar">
                    <Row id="menu-bar.quota">
                      <select className="ui-input field" aria-label="Menu bar quota" value={settings.menu_bar_quota} onChange={(e) => void act("menu-bar", () => setMenuBarQuota(e.currentTarget.value))}>
                        {MENU_BAR_CHOICES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Row>
                    {note("menu-bar")}
                  </Card>
                </Block>
                <Block id="reader">
                  <Card className="settings-section" data-section="reader">
                    <Row id="reader.editor" wide>
                      <input
                        className="ui-input field settings-wide-field"
                        aria-label="Editor for Open in editor"
                        defaultValue={settings.reader_editor}
                        spellCheck={false}
                        onBlur={(e) => {
                          const value = e.currentTarget.value.trim();
                          if (value !== settings.reader_editor) void act("reader", () => setReaderEditor(value));
                        }}
                      />
                    </Row>
                    {note("reader")}
                  </Card>
                </Block>
              </div>

              <div className="settings-group" data-group="system">
                <Block id="login">
                  <Card className="settings-section" data-section="login">
                    <Row id="login.launch">
                      <input
                        type="checkbox"
                        aria-label="Open Kinas when you log in"
                        checked={settings.launch_at_login}
                        onChange={(e) => void act("login", () => setLaunchAtLogin(e.currentTarget.checked))}
                      />
                    </Row>
                    {settings.autostart_error && <p className="problem">launch at login unavailable: {settings.autostart_error}</p>}
                    {note("login")}
                  </Card>
                </Block>
                <Block id="cli">
                  <Card className="settings-section" data-section="cli">
                    <Row id="cli.link" wide>
                      <p className={settings.cli_link.state === "conflict" ? "problem" : "settings-help"} data-testid="cli-link">
                        {linkText(settings.cli_link)}
                      </p>
                    </Row>
                  </Card>
                </Block>
              </div>
            </div>
          </SettingsMatch.Provider>
        </div>
      )}
    </div>
  );
}

function ShortcutRow({
  id,
  chord,
  recording,
  onRecording,
}: {
  id: string;
  chord: string;
  recording: boolean;
  onRecording: (on: boolean) => void;
}) {
  // A Settings row's control (the interface polish, rule 33): the row says the shortcut's name; this is its chord and
  // its Change. `data-shortcut` and `.shortcut-chord` stay the hooks the specs find a shortcut by.
  return (
    <span className="shortcut" data-shortcut={id} data-recording={recording ? "true" : undefined}>
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
    </span>
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
