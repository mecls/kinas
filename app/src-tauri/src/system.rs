//! What Kinas registers with macOS: the global hotkey (PRD R30) and launch at login (R29), plus the settings
//! rows both read. Failures are recorded for Settings; nothing silently falls back.

use crate::store::Store;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{BTreeMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

pub const DEFAULT_HOTKEY: &str = "Cmd+Shift+Space";
pub const OPEN_PALETTE: &str = "open_palette";
pub const MENU_BAR_CHOICES: [&str; 4] = ["claude-plan/session", "claude-plan/week", "ollama-cloud/session", "ollama-cloud/week"];

#[derive(Default)]
pub struct SystemState {
    pub hotkey_error: Mutex<Option<String>>,
    pub autostart_error: Mutex<Option<String>>,
}

pub fn get_setting(conn: &Connection, org_id: &str, key: &str) -> Option<serde_json::Value> {
    conn.query_row("SELECT value FROM settings WHERE org_id = ?1 AND key = ?2", params![org_id, key], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_str(&v).ok())
}

pub fn put_setting(conn: &Connection, org_id: &str, key: &str, value: &serde_json::Value) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (org_id, key, value) VALUES (?1, ?2, ?3) ON CONFLICT (org_id, key) DO UPDATE SET value = excluded.value",
        params![org_id, key, value.to_string()],
    )?;
    Ok(())
}

/// Settings → Appearance: follow macOS, or hold one ground whatever macOS does.
pub const APPEARANCE_CHOICES: [&str; 3] = ["system", "light", "dark"];

/// The window theme a choice means: `None` follows macOS. Anything but the three choices is refused.
pub fn parse_appearance(value: &str) -> Result<Option<tauri::Theme>, String> {
    match value {
        "system" => Ok(None),
        "light" => Ok(Some(tauri::Theme::Light)),
        "dark" => Ok(Some(tauri::Theme::Dark)),
        other => Err(format!("unknown appearance {other}")),
    }
}

/// The stored choice and its theme. It is read with a default and never seeded, so a row that is missing, or that
/// holds something a hand or an older build wrote, follows macOS rather than failing the launch.
pub fn stored_appearance(value: Option<serde_json::Value>) -> (&'static str, Option<tauri::Theme>) {
    let stored = value.as_ref().and_then(|v| v.as_str()).unwrap_or("system");
    match APPEARANCE_CHOICES.iter().find(|choice| **choice == stored) {
        Some(choice) => (choice, parse_appearance(choice).unwrap_or(None)),
        None => ("system", None),
    }
}

/// Makes the window, and with it the title bar and the webview's `prefers-color-scheme`, light, dark or macOS's own.
/// On macOS the theme is the whole app's (tao sets NSApp's appearance), which is what lets tokens.css choose its
/// ground with a media query and nothing else.
pub fn apply_appearance(window: &tauri::WebviewWindow, theme: Option<tauri::Theme>) {
    if let Err(e) = window.set_theme(theme) {
        log::warn!("appearance not applied: {e}");
    }
}

/// Settings → Appearance's accent (DESIGN.md §2.1, §8): the brand colour a customer may override. Six lower-case
/// hex digits after `#`, or `None` for the brand's own — the webview sets it as one custom property on the page,
/// and the field there refuses a shade that would not read (4.5:1 in either theme) before it reaches here.
pub fn parse_accent(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    if bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b)) {
        Ok(value.to_string())
    } else {
        Err("accent must be #rrggbb".to_string())
    }
}

/// The stored accent, or `None` for anything a hand or an older build may have written: the brand's own is the
/// answer that cannot be wrong.
pub fn stored_accent(value: Option<serde_json::Value>) -> Option<String> {
    value.as_ref().and_then(|v| v.as_str()).and_then(|s| parse_accent(s).ok())
}

/// R30: the global hotkey must include ⌘, because ⌘ chords never produce terminal input.
pub fn has_command_modifier(chord: &str) -> bool {
    chord
        .split('+')
        .map(|p| p.trim().to_ascii_lowercase())
        .any(|p| matches!(p.as_str(), "cmd" | "command" | "super" | "meta"))
}

/// The app actions with an in-window shortcut (app/src/settings/shortcuts.ts, keymap.md).
pub const SHORTCUT_ACTIONS: [&str; 6] = ["palette", "go.home", "go.work", "go.usage", "sidebar", "settings"];

/// In-window shortcuts as Settings saves them: known actions, one chord each, and every chord with ⌘ so a shortcut
/// never takes a key from the terminal (R31). The webview explains clashes before a change gets this far.
pub fn check_shortcuts(shortcuts: &BTreeMap<String, String>) -> Result<(), String> {
    let mut chords = HashSet::new();
    for (action, chord) in shortcuts {
        if !SHORTCUT_ACTIONS.contains(&action.as_str()) {
            return Err(format!("unknown shortcut {action}"));
        }
        if !has_command_modifier(chord) {
            return Err(format!("the shortcut for {action} must include ⌘"));
        }
        if !chords.insert(chord.as_str()) {
            return Err(format!("{chord} is bound twice"));
        }
    }
    Ok(())
}

/// e2e launches (debug builds with `KINAS_E2E_NO_SYSTEM_HOOKS=1`) register neither the hotkey nor a login item.
fn system_hooks_enabled() -> bool {
    #[cfg(debug_assertions)]
    if std::env::var("KINAS_E2E_NO_SYSTEM_HOOKS").as_deref() == Ok("1") {
        return false;
    }
    true
}

fn running_from_bundle() -> bool {
    std::env::current_exe().is_ok_and(|exe| exe.to_string_lossy().contains("Kinas.app/Contents/MacOS/"))
}

/// The plugin's handler: bring the window forward and open the palette.
pub fn on_hotkey(app: &AppHandle, _shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }
    bring_forward(app);
    let _ = app.emit(OPEN_PALETTE, ());
}

/// Shows, unminimizes and focuses the main window: the global hotkey (R30) and an accepted `kinas open` (reader R18).
pub fn bring_forward(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        // Already the key window: focusing it again gains nothing and could move focus inside the page (reader R34).
        if !window.is_focused().unwrap_or(false) {
            let _ = window.set_focus();
        }
    }
}

pub fn register_hotkey(app: &AppHandle, chord: &str) -> Result<(), String> {
    if !has_command_modifier(chord) {
        return Err("the global hotkey must include ⌘".into());
    }
    let shortcut: Shortcut = chord.parse().map_err(|e| format!("\"{chord}\" is not a valid chord: {e}"))?;
    if !system_hooks_enabled() {
        return Err("not registered during e2e runs".into());
    }
    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|e| e.to_string())?;
    manager.register(shortcut).map_err(|e| format!("{chord} is taken or cannot be registered: {e}"))
}

pub fn apply_launch_at_login(app: &AppHandle, enabled: bool) -> Result<(), String> {
    if !system_hooks_enabled() {
        return Err("not changed during e2e runs".into());
    }
    if !running_from_bundle() {
        // A login item pointing at a development build would outlive the build.
        return Err("only available when Kinas runs from Kinas.app".into());
    }
    let launcher = app.autolaunch();
    let current = launcher.is_enabled().map_err(|e| e.to_string())?;
    match (enabled, current) {
        (true, false) => launcher.enable().map_err(|e| e.to_string()),
        (false, true) => launcher.disable().map_err(|e| e.to_string()),
        _ => Ok(()),
    }
}

/// At launch (PRD §3.1 steps 4–5): enable launch at login and register the hotkey from settings.
pub fn setup(app: &AppHandle) {
    let state = app.state::<SystemState>();
    let store = app.state::<Store>();
    let (chord, autostart) = {
        let conn = store.conn();
        let chord = get_setting(&conn, store.org_id(), "global_hotkey").and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| DEFAULT_HOTKEY.into());
        let autostart = get_setting(&conn, store.org_id(), "launch_at_login").and_then(|v| v.as_bool()).unwrap_or(true);
        (chord, autostart)
    };
    let hotkey = register_hotkey(app, &chord);
    if let Err(e) = &hotkey {
        log::warn!("hotkey unavailable: {e}");
    }
    *state.hotkey_error.lock().unwrap_or_else(|p| p.into_inner()) = hotkey.err();

    let login = apply_launch_at_login(app, autostart);
    if let Err(e) = &login {
        log::warn!("launch at login unavailable: {e}");
    }
    *state.autostart_error.lock().unwrap_or_else(|p| p.into_inner()) = login.err();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hotkey_must_include_command() {
        assert!(has_command_modifier("Cmd+Shift+Space"));
        assert!(has_command_modifier("super+k"));
        assert!(!has_command_modifier("Ctrl+Alt+K"));
        assert!(!has_command_modifier("Shift+Space"));
    }

    #[test]
    fn shortcuts_name_known_actions_once_each_and_include_command() {
        let map = |pairs: &[(&str, &str)]| pairs.iter().map(|(a, c)| (a.to_string(), c.to_string())).collect::<BTreeMap<_, _>>();
        assert!(check_shortcuts(&map(&[("sidebar", "Cmd+B"), ("palette", "Cmd+K"), ("settings", "Cmd+Shift++")])).is_ok());
        assert!(check_shortcuts(&map(&[])).is_ok());
        assert!(check_shortcuts(&map(&[("sidebar", "Ctrl+B")])).is_err());
        assert!(check_shortcuts(&map(&[("launch", "Cmd+L")])).is_err());
        assert!(check_shortcuts(&map(&[("go.usage", "Cmd+1"), ("go.work", "Cmd+1")])).is_err());
        // Home has a chord since 2026-09-22 (keymap.md); the crew's ⌘3 is reserved and is not an action yet.
        assert!(check_shortcuts(&map(&[("go.home", "Cmd+1"), ("go.usage", "Cmd+4")])).is_ok());
        assert!(check_shortcuts(&map(&[("go.crew", "Cmd+3")])).is_err());
        assert_eq!(SHORTCUT_ACTIONS.len(), 6);
    }

    #[test]
    fn appearance_is_system_light_or_dark_and_nothing_else() {
        assert_eq!(parse_appearance("system"), Ok(None));
        assert_eq!(parse_appearance("light"), Ok(Some(tauri::Theme::Light)));
        assert_eq!(parse_appearance("dark"), Ok(Some(tauri::Theme::Dark)));
        // Refused, not coerced: a value Settings cannot have sent is not quietly stored as something else.
        for bad in ["", "Light", "auto", "sepia"] {
            assert!(parse_appearance(bad).is_err(), "{bad:?} was accepted");
        }
    }

    #[test]
    fn a_stored_appearance_that_is_not_one_of_the_three_follows_the_system() {
        assert_eq!(stored_appearance(Some(serde_json::json!("light"))), ("light", Some(tauri::Theme::Light)));
        assert_eq!(stored_appearance(Some(serde_json::json!("dark"))), ("dark", Some(tauri::Theme::Dark)));
        assert_eq!(stored_appearance(Some(serde_json::json!("system"))), ("system", None));
        for odd in [serde_json::json!("sepia"), serde_json::json!(1), serde_json::Value::Null] {
            assert_eq!(stored_appearance(Some(odd)), ("system", None));
        }
        // Never seeded (store.rs DEFAULT_SETTINGS): a launch with no row is a launch that follows macOS.
        assert_eq!(stored_appearance(None), ("system", None));
    }

    #[test]
    fn an_accent_is_six_lower_case_hex_digits_and_nothing_else() {
        assert_eq!(parse_accent("#00549e"), Ok("#00549e".to_string()));
        assert_eq!(parse_accent("#a8527a"), Ok("#a8527a".to_string()));
        // Refused, not coerced: upper case, a missing hash, a word, a trailing character, a short form.
        for bad in ["#00549E", "00549e", "blue", "#00549e;", "#abc", "", "#00549e "] {
            assert_eq!(parse_accent(bad), Err("accent must be #rrggbb".to_string()), "{bad:?} was accepted");
        }
    }

    #[test]
    fn a_stored_accent_that_does_not_parse_is_the_brand_default() {
        assert_eq!(stored_accent(Some(serde_json::json!("#1f6b4a"))), Some("#1f6b4a".to_string()));
        for odd in [serde_json::json!("sepia"), serde_json::json!("#1F6B4A"), serde_json::json!(1), serde_json::Value::Null] {
            assert_eq!(stored_accent(Some(odd)), None);
        }
        assert_eq!(stored_accent(None), None);
    }

    #[test]
    fn the_default_hotkey_parses() {
        assert!(DEFAULT_HOTKEY.parse::<Shortcut>().is_ok());
    }

    #[test]
    fn settings_round_trip_as_json() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let conn = store.conn();
        assert_eq!(get_setting(&conn, store.org_id(), "global_hotkey"), Some(serde_json::json!(DEFAULT_HOTKEY)));
        put_setting(&conn, store.org_id(), "launch_at_login", &serde_json::json!(false)).unwrap();
        assert_eq!(get_setting(&conn, store.org_id(), "launch_at_login"), Some(serde_json::json!(false)));
        assert_eq!(get_setting(&conn, store.org_id(), "nope"), None);
    }
}
