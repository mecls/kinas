//! Tauri commands the webview calls. Reads only; every write happens in the Rust core.

use crate::keychain::{Keys, OLLAMA_ACCOUNT};
use crate::pty::{self, PtyState};
use crate::redact::redact;
use crate::readers::claude_plan;
use crate::readers::runtime::ReaderControl;
use crate::readings::{self, UsageSnapshot};
use crate::store::{now_ms, Store};
use crate::system::{self, SystemState};
use std::collections::BTreeMap;
use tauri::AppHandle;

/// Everything the Usage page shows, with states computed now (R12).
#[tauri::command]
pub fn get_usage_snapshot(store: State<'_, Store>, control: State<'_, ReaderControl>) -> Result<UsageSnapshot, String> {
    let now = now_ms();
    let hook = claude_plan::hook_status(control.data_dir(), now);
    readings::snapshot(&store.conn(), store.org_id(), now, control.backfill(), hook).map_err(|e| e.to_string())
}

/// The Usage page became visible or hidden (R13).
#[tauri::command]
pub fn set_usage_visible(store: State<'_, Store>, control: State<'_, ReaderControl>, visible: bool) -> Result<(), String> {
    let newest: Option<i64> = store
        .conn()
        .query_row(
            "SELECT max(updated_at) FROM quotas WHERE org_id = ?1 AND subscription = 'ollama-cloud'",
            [store.org_id()],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    control.set_usage_visible(visible, newest.map(|at| now_ms() - at));
    Ok(())
}

/// "Refresh readings" (R13): wakes every reader; the Ollama poller still keeps its one-request-per-60 s rule.
#[tauri::command]
pub fn refresh_readings(control: State<'_, ReaderControl>) {
    control.refresh();
}

#[derive(Serialize)]
pub struct SettingsView {
    pub org_name: String,
    pub menu_bar_quota: String,
    pub global_hotkey: String,
    pub launch_at_login: bool,
    pub hotkey_error: Option<String>,
    pub autostart_error: Option<String>,
    pub cli_link: crate::cli_link::LinkStatus,
    pub ollama_key_saved: bool,
    pub claude_hook: claude_plan::HookStatus,
}

/// Settings (§3.9): everything the Settings page shows. Never a secret.
#[tauri::command]
pub fn get_settings(
    store: State<'_, Store>,
    keys: State<'_, Keys>,
    link: State<'_, crate::cli_link::CliLink>,
    control: State<'_, ReaderControl>,
    system: State<'_, SystemState>,
) -> Result<SettingsView, String> {
    let (org_name, menu_bar_quota, global_hotkey, launch_at_login) = {
        let conn = store.conn();
        let org = store.org_id();
        let name: String = conn.query_row("SELECT name FROM orgs WHERE id = ?1", [org], |r| r.get(0)).map_err(|e| e.to_string())?;
        let text = |key: &str, default: &str| system::get_setting(&conn, org, key).and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| default.to_string());
        (
            name,
            text("menu_bar_quota", "claude-plan/session"),
            text("global_hotkey", system::DEFAULT_HOTKEY),
            system::get_setting(&conn, org, "launch_at_login").and_then(|v| v.as_bool()).unwrap_or(true),
        )
    };
    Ok(SettingsView {
        org_name,
        menu_bar_quota,
        global_hotkey,
        launch_at_login,
        hotkey_error: system.hotkey_error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        autostart_error: system.autostart_error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        cli_link: link.0.clone(),
        ollama_key_saved: keys.0.get(OLLAMA_ACCOUNT).map(|k| k.is_some()).unwrap_or(false),
        claude_hook: claude_plan::hook_status(control.data_dir(), now_ms()),
    })
}

#[tauri::command]
pub fn set_org_name(store: State<'_, Store>, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("the name is empty".into());
    }
    store.conn().execute("UPDATE orgs SET name = ?1 WHERE id = ?2", rusqlite::params![name, store.org_id()]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_menu_bar_quota(app: AppHandle, store: State<'_, Store>, value: String) -> Result<(), String> {
    if !system::MENU_BAR_CHOICES.contains(&value.as_str()) {
        return Err(format!("unknown quota {value}"));
    }
    system::put_setting(&store.conn(), store.org_id(), "menu_bar_quota", &serde_json::json!(value)).map_err(|e| e.to_string())?;
    crate::tray::refresh(&app);
    Ok(())
}

/// R30: registers first, and only a chord that registered is saved. No fallback chord.
#[tauri::command]
pub fn set_global_hotkey(app: AppHandle, store: State<'_, Store>, system: State<'_, SystemState>, chord: String) -> Result<(), String> {
    let result = system::register_hotkey(&app, &chord);
    *system.hotkey_error.lock().unwrap_or_else(|p| p.into_inner()) = result.as_ref().err().cloned();
    result?;
    system::put_setting(&store.conn(), store.org_id(), "global_hotkey", &serde_json::json!(chord)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_launch_at_login(app: AppHandle, store: State<'_, Store>, system: State<'_, SystemState>, enabled: bool) -> Result<(), String> {
    system::put_setting(&store.conn(), store.org_id(), "launch_at_login", &serde_json::json!(enabled)).map_err(|e| e.to_string())?;
    let result = system::apply_launch_at_login(&app, enabled);
    *system.autostart_error.lock().unwrap_or_else(|p| p.into_inner()) = result.as_ref().err().cloned();
    result
}

#[derive(Serialize)]
pub struct UiPrefs {
    /// The in-window shortcuts Settings saved, by action; the webview fills in the rest from its defaults.
    pub shortcuts: BTreeMap<String, String>,
    pub sidebar_visible: bool,
}

/// What the window needs before it draws: the shortcuts and whether the sidebar is shown.
#[tauri::command]
pub fn get_ui_prefs(store: State<'_, Store>) -> UiPrefs {
    let conn = store.conn();
    let org = store.org_id();
    UiPrefs {
        shortcuts: system::get_setting(&conn, org, "shortcuts").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
        sidebar_visible: system::get_setting(&conn, org, "sidebar_visible").and_then(|v| v.as_bool()).unwrap_or(true),
    }
}

#[tauri::command]
pub fn set_shortcuts(store: State<'_, Store>, shortcuts: BTreeMap<String, String>) -> Result<(), String> {
    system::check_shortcuts(&shortcuts)?;
    system::put_setting(&store.conn(), store.org_id(), "shortcuts", &serde_json::json!(shortcuts)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_sidebar_visible(store: State<'_, Store>, visible: bool) -> Result<(), String> {
    system::put_setting(&store.conn(), store.org_id(), "sidebar_visible", &serde_json::json!(visible)).map_err(|e| e.to_string())
}

/// Settings: what happened to ~/.local/bin/kinas at launch (R35).
#[tauri::command]
pub fn cli_link_status(link: State<'_, crate::cli_link::CliLink>) -> crate::cli_link::LinkStatus {
    link.0.clone()
}

#[derive(Serialize)]
pub struct KeyStatus {
    pub saved: bool,
}

/// Settings: whether an Ollama Cloud API key is saved. Never returns the key itself (R4).
#[tauri::command]
pub fn ollama_key_status(keys: State<'_, Keys>) -> Result<KeyStatus, String> {
    Ok(KeyStatus { saved: keys.0.get(OLLAMA_ACCOUNT)?.is_some() })
}

/// Settings: saves the key in the Keychain (R4) and asks the Ollama reader to poll now.
#[tauri::command]
pub fn save_ollama_key(keys: State<'_, Keys>, control: State<'_, ReaderControl>, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("the key is empty".into());
    }
    keys.0.set(OLLAMA_ACCOUNT, key).map_err(|e| redact(&e))?;
    control.refresh();
    Ok(())
}

/// Settings: removes the key. The Ollama gauge goes back to "Add API key" on the next poll.
#[tauri::command]
pub fn remove_ollama_key(keys: State<'_, Keys>, control: State<'_, ReaderControl>) -> Result<(), String> {
    keys.0.remove(OLLAMA_ACCOUNT)?;
    control.refresh();
    Ok(())
}
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

/// Starts the pane's profile (R32). Output is delivered as raw bytes (R34); `on_exit` fires once with
/// the exit code.
#[tauri::command]
pub fn pty_start(
    state: State<'_, PtyState>,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<Option<u32>>,
    cols: u16,
    rows: u16,
) -> Result<Option<u32>, String> {
    let profile = pty::default_profile();
    log::info!("terminal: starting {} {:?} in {}", profile.program, profile.args, profile.cwd.display());
    state.start(
        &profile,
        cols,
        rows,
        move |bytes| {
            let _ = on_data.send(InvokeResponseBody::Raw(bytes));
        },
        move |code| {
            log::info!("terminal: child exited with {code:?}");
            let _ = on_exit.send(code);
        },
    )
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, data: String) -> Result<(), String> {
    state.session()?.write(data.as_bytes())
}

/// xterm's onBinary data (e.g. some mouse reports): one byte per element.
#[tauri::command]
pub fn pty_write_binary(state: State<'_, PtyState>, data: Vec<u8>) -> Result<(), String> {
    state.session()?.write(&data)
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    state.session()?.resize(cols, rows)
}

#[tauri::command]
pub fn pty_pid(state: State<'_, PtyState>) -> Option<u32> {
    state.session().ok().and_then(|s| s.pid())
}

#[derive(Serialize)]
pub struct StoreInfo {
    pub org_id: String,
    pub path: String,
    pub schema_version: i64,
}

#[tauri::command]
pub fn store_info(store: State<'_, Store>) -> Result<StoreInfo, String> {
    let schema_version = store
        .conn()
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(StoreInfo {
        org_id: store.org_id().to_string(),
        path: store.path().display().to_string(),
        schema_version,
    })
}
