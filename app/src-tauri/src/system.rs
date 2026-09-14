//! What Kinas registers with macOS: the global hotkey (PRD R30) and launch at login (R29), plus the settings
//! rows both read. Failures are recorded for Settings; nothing silently falls back.

use crate::store::Store;
use rusqlite::{params, Connection, OptionalExtension};
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

/// R30: the global hotkey must include ⌘, because ⌘ chords never produce terminal input.
pub fn has_command_modifier(chord: &str) -> bool {
    chord
        .split('+')
        .map(|p| p.trim().to_ascii_lowercase())
        .any(|p| matches!(p.as_str(), "cmd" | "command" | "super" | "meta"))
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
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit(OPEN_PALETTE, ());
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
