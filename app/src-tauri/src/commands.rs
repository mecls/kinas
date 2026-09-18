//! Tauri commands the webview calls. Reads only; every write happens in the Rust core.

use crate::keychain::{Keys, CONVEX_ACCOUNT, HOSTINGER_ACCOUNT, OLLAMA_ACCOUNT};
use crate::readers::hostinger::{self, MetricsClient};
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
    /// Whether a Convex deploy key is in the Keychain. Never the key itself (convex R2).
    pub convex_key_saved: bool,
    /// The watched deployment, or empty for "no deployment" (convex R3, R14: one deployment in v0).
    pub convex_deployment_url: String,
    /// `starter` or `professional`; only changes R6's denominators.
    pub convex_plan: String,
    /// Whether a Hostinger API token is in the Keychain. Never the token itself (hostinger R3).
    pub hostinger_key_saved: bool,
    /// The watched VPS, or `None` for "no VPS selected" — which means zero requests (hostinger R4).
    pub hostinger_vm_id: Option<i64>,
    /// `hostname · plan`, so Settings can name the selection without re-listing the account.
    pub hostinger_vm_label: String,
    pub claude_hook: claude_plan::HookStatus,
    /// The command Open in editor runs in a new Herdr pane (reader R36).
    pub reader_editor: String,
    /// The projects folder the reader and the CLI work from (reader R1b).
    pub projects_root: String,
    /// Set when `KINAS_ROOT` overrides the saved folder, so Settings can say the field is not in charge.
    pub projects_root_from_env: bool,
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
    // Everything that needs the connection is read under one guard: taking it twice on this thread would deadlock.
    let (
        org_name,
        menu_bar_quota,
        global_hotkey,
        launch_at_login,
        reader_editor,
        projects_root,
        convex_deployment_url,
        convex_plan,
        hostinger_vm_id,
        hostinger_vm_label,
    ) = {
        let conn = store.conn();
        let org = store.org_id();
        let name: String = conn.query_row("SELECT name FROM orgs WHERE id = ?1", [org], |r| r.get(0)).map_err(|e| e.to_string())?;
        let text = |key: &str, default: &str| system::get_setting(&conn, org, key).and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| default.to_string());
        (
            name,
            text("menu_bar_quota", "claude-plan/session"),
            text("global_hotkey", system::DEFAULT_HOTKEY),
            system::get_setting(&conn, org, "launch_at_login").and_then(|v| v.as_bool()).unwrap_or(true),
            text("reader_editor", crate::reader::editor::DEFAULT_EDITOR),
            crate::paths::projects_root(&conn, org),
            text("convex_deployment_url", ""),
            text("convex_plan", "starter"),
            system::get_setting(&conn, org, "hostinger_vm_id").and_then(|v| v.as_i64()),
            text("hostinger_vm_label", ""),
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
        convex_key_saved: keys.0.get(CONVEX_ACCOUNT).map(|k| k.is_some()).unwrap_or(false),
        convex_deployment_url,
        convex_plan,
        hostinger_key_saved: keys.0.get(HOSTINGER_ACCOUNT).map(|k| k.is_some()).unwrap_or(false),
        hostinger_vm_id,
        hostinger_vm_label,
        claude_hook: claude_plan::hook_status(control.data_dir(), now_ms()),
        reader_editor,
        projects_root: projects_root.display().to_string(),
        projects_root_from_env: std::env::var("KINAS_ROOT").is_ok_and(|v| !v.trim().is_empty()),
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

/// The projects folder the reader and the CLI work from (reader R1b): an absolute path that exists, stored
/// canonicalized. The CLI reads this same setting from the store, so `kinas open` follows it with Kinas quit.
#[tauri::command]
pub fn set_projects_root(store: State<'_, Store>, path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("the projects folder is empty".into());
    }
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from("/"));
    let expanded = if trimmed == "~" {
        home
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        home.join(rest)
    } else {
        std::path::PathBuf::from(trimmed)
    };
    if !expanded.is_absolute() {
        return Err(format!("{} is not an absolute path", expanded.display()));
    }
    let real = std::fs::canonicalize(&expanded).map_err(|_| format!("{} does not exist", expanded.display()))?;
    if !real.is_dir() {
        return Err(format!("{} is not a folder", real.display()));
    }
    let value = real.display().to_string();
    system::put_setting(&store.conn(), store.org_id(), crate::paths::SETTING_KEY, &serde_json::json!(value)).map_err(|e| e.to_string())?;
    Ok(value)
}

/// The command Open in editor runs (reader R36): one trimmed line of at most 200 characters.
#[tauri::command]
pub fn set_reader_editor(store: State<'_, Store>, value: String) -> Result<(), String> {
    let value = crate::reader::editor::check_editor(&value)?;
    system::put_setting(&store.conn(), store.org_id(), "reader_editor", &serde_json::json!(value)).map_err(|e| e.to_string())
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
    /// The reader's share of the row it sits in, in percent, set by dragging the divider (reader R32, amended
    /// 2026-09-15). That row was the Work page; since 2026-09-18 the reader is the panel on the right of the whole
    /// window and the row is the stage. The key kept its name so a width saved before the move still applies.
    pub reader_width_pct: f64,
}

/// 45 since the sidebar grew to 220 px (2026-09-18); 55 beside the old 72 px rail. Must equal DEFAULT_PANEL_PCT in
/// the webview's shell/split.ts. A width Miguel has dragged is stored and wins over this.
pub const READER_WIDTH_DEFAULT: f64 = 45.0;
const READER_WIDTH_MIN: f64 = 20.0;
const READER_WIDTH_MAX: f64 = 80.0;

/// A stored width in range, else the default: a hand-edited or older value never lays the page out badly.
fn reader_width(value: Option<serde_json::Value>) -> f64 {
    value.and_then(|v| v.as_f64()).filter(|p| p.is_finite() && (READER_WIDTH_MIN..=READER_WIDTH_MAX).contains(p)).unwrap_or(READER_WIDTH_DEFAULT)
}

/// What the window needs before it draws: the shortcuts, whether the sidebar is shown, and the reader's width.
#[tauri::command]
pub fn get_ui_prefs(store: State<'_, Store>) -> UiPrefs {
    let conn = store.conn();
    let org = store.org_id();
    UiPrefs {
        shortcuts: system::get_setting(&conn, org, "shortcuts").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
        sidebar_visible: system::get_setting(&conn, org, "sidebar_visible").and_then(|v| v.as_bool()).unwrap_or(true),
        reader_width_pct: reader_width(system::get_setting(&conn, org, "reader_width_pct")),
    }
}

/// Saved when a drag of the divider ends, rounded to a tenth of a percent.
#[tauri::command]
pub fn set_reader_width(store: State<'_, Store>, pct: f64) -> Result<(), String> {
    if !pct.is_finite() || !(READER_WIDTH_MIN..=READER_WIDTH_MAX).contains(&pct) {
        return Err(format!("the reader's width must be between {READER_WIDTH_MIN} and {READER_WIDTH_MAX} percent"));
    }
    system::put_setting(&store.conn(), store.org_id(), "reader_width_pct", &serde_json::json!((pct * 10.0).round() / 10.0)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod reader_width_tests {
    use super::*;

    #[test]
    fn a_stored_width_outside_20_to_80_percent_falls_back_to_the_default() {
        assert_eq!(reader_width(Some(serde_json::json!(35.5))), 35.5);
        assert_eq!(reader_width(Some(serde_json::json!(80))), 80.0);
        for bad in [serde_json::json!(5), serde_json::json!(95.0), serde_json::json!("40"), serde_json::Value::Null] {
            assert_eq!(reader_width(Some(bad)), READER_WIDTH_DEFAULT);
        }
        assert_eq!(reader_width(None), READER_WIDTH_DEFAULT);
        // The webview's shell/split.ts says the same number; a change to one without the other is a change to neither.
        assert_eq!(READER_WIDTH_DEFAULT, 45.0);
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

#[tauri::command]
pub fn convex_key_status(keys: State<'_, Keys>) -> Result<KeyStatus, String> {
    Ok(KeyStatus { saved: keys.0.get(CONVEX_ACCOUNT)?.is_some() })
}

/// Settings: saves the Convex deploy key in the Keychain and asks the reader to poll now (convex R2).
///
/// The key should be minted with **only** `deployment:usage:view` — so scoped, it cannot deploy, read or write
/// data, run functions, or read environment variables. Nothing here can check that, which is exactly why the
/// GET-only guard test exists on the reader.
#[tauri::command]
pub fn save_convex_key(keys: State<'_, Keys>, control: State<'_, ReaderControl>, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("the key is empty".into());
    }
    keys.0.set(CONVEX_ACCOUNT, key).map_err(|e| redact(&e))?;
    control.refresh();
    Ok(())
}

/// Settings: removes the key. The Convex gauges go back to "Add deploy key" on the next poll.
#[tauri::command]
pub fn remove_convex_key(keys: State<'_, Keys>, control: State<'_, ReaderControl>) -> Result<(), String> {
    keys.0.remove(CONVEX_ACCOUNT)?;
    control.refresh();
    Ok(())
}

/// Settings: the deployment to watch (convex R3). Empty disconnects it, and then no request is made at all.
#[tauri::command]
pub fn set_convex_deployment(store: State<'_, Store>, control: State<'_, ReaderControl>, url: String) -> Result<(), String> {
    let url = crate::readers::convex::check_deployment_url(&url)?;
    system::put_setting(&store.conn(), store.org_id(), "convex_deployment_url", &serde_json::json!(url)).map_err(|e| e.to_string())?;
    control.refresh();
    Ok(())
}

/// Settings: the plan tier, which only changes R6's denominators.
#[tauri::command]
pub fn set_convex_plan(store: State<'_, Store>, control: State<'_, ReaderControl>, plan: String) -> Result<(), String> {
    let plan = crate::readers::convex::check_plan(&plan)?;
    system::put_setting(&store.conn(), store.org_id(), "convex_plan", &serde_json::json!(plan)).map_err(|e| e.to_string())?;
    // The stored percentages were computed against the old tier, so a fresh poll replaces them.
    control.refresh();
    Ok(())
}

/// One row of the VPS picker (hostinger R4). Nothing here is a secret; the token never leaves the Keychain.
#[derive(serde::Serialize)]
pub struct VpsChoice {
    pub id: i64,
    pub hostname: String,
    pub plan: String,
    pub state: String,
}

#[tauri::command]
pub fn hostinger_key_status(keys: State<'_, Keys>) -> Result<KeyStatus, String> {
    Ok(KeyStatus { saved: keys.0.get(HOSTINGER_ACCOUNT)?.is_some() })
}

#[tauri::command]
pub fn save_hostinger_token(keys: State<'_, Keys>, control: State<'_, ReaderControl>, token: String) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("the token is empty".into());
    }
    keys.0.set(HOSTINGER_ACCOUNT, token).map_err(|e| redact(&e))?;
    control.refresh();
    Ok(())
}

#[tauri::command]
pub fn remove_hostinger_token(keys: State<'_, Keys>, control: State<'_, ReaderControl>) -> Result<(), String> {
    keys.0.remove(HOSTINGER_ACCOUNT).map_err(|e| redact(&e))?;
    control.refresh();
    Ok(())
}

/// The machines on the account, for the picker.
///
/// This is the one place a request is made outside the reader thread, and it is still a GET through the same
/// GET-only module (R1, R2). It stores nothing: the list is shown, Miguel chooses, and only the chosen id is
/// written by `set_hostinger_vm`.
/// `async` **and** `spawn_blocking`, and both halves are needed — getting either one alone wrong breaks it in a
/// different way, which this command has now demonstrated twice.
///
/// - Synchronous, it runs on the **main thread**, so a 10-second HTTP timeout freezes the window. That is the
///   same reason the reader commands are async.
/// - Naively `async`, the body runs inside Tauri's async runtime, and `reqwest::blocking` starts a runtime of
///   its own — which cannot nest. The app logged `Failed to communicate successful startup` and the command
///   never returned, so the e2e case that had been passing died on a bare timeout with nothing to explain it.
///
/// So: async, with every blocking part — the Keychain read included, since that shells out to `security` — on a
/// blocking thread. The `Arc` is cloned because `State<'_, Keys>` cannot outlive the call.
#[tauri::command]
pub async fn hostinger_list_vms(keys: State<'_, Keys>) -> Result<Vec<VpsChoice>, String> {
    let keystore = std::sync::Arc::clone(&keys.0);
    tauri::async_runtime::spawn_blocking(move || {
        let token = keystore.get(HOSTINGER_ACCOUNT).map_err(|e| redact(&e))?.unwrap_or_default();
        if token.trim().is_empty() {
            return Err("no API token — add one first".into());
        }
        let client = hostinger::ReqwestClient::new().map_err(|e| redact(&e))?;
        let response = client.list_vms(&hostinger::base_url(), &token).map_err(|e| redact(&e))?;
        match response.status {
            200 => {}
            401 => return Err("api token rejected".into()),
            429 => return Err("rate limited (HTTP 429) — try again in a minute".into()),
            status => return Err(format!("HTTP {status}")),
        }
        let vms = hostinger::parse_vms(&response.body).map_err(|e| redact(&e))?;
        Ok(vms
            .into_iter()
            .map(|v| VpsChoice { id: v.id, hostname: v.hostname, plan: v.plan, state: v.state })
            .collect())
    })
    .await
    .map_err(|e| format!("listing failed: {e}"))?
}

/// Choose the watched VPS, or pass `None` to watch none — which is how Miguel disconnects it (R4).
#[tauri::command]
pub fn set_hostinger_vm(store: State<'_, Store>, control: State<'_, ReaderControl>, vm_id: Option<i64>, label: String) -> Result<(), String> {
    let conn = store.conn();
    let org = store.org_id();
    system::put_setting(&conn, org, "hostinger_vm_id", &serde_json::json!(vm_id)).map_err(|e| e.to_string())?;
    system::put_setting(&conn, org, "hostinger_vm_label", &serde_json::json!(label.trim())).map_err(|e| e.to_string())?;
    drop(conn);
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

/// The most a single copy may put on the clipboard, in UTF-8 bytes. `app/src/terminal/clipboard.ts` holds the
/// same number, so the webview does not send what this would refuse.
pub const CLIPBOARD_MAX_BYTES: usize = 1_048_576;

/// Whether text may go on the clipboard: never empty, so no program can wipe what was copied, and never over
/// the limit, so a program printing OSC 52 in a loop cannot push megabytes through IPC. The error names the
/// size, never the text.
pub fn check_clipboard_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("nothing to copy".into());
    }
    if text.len() > CLIPBOARD_MAX_BYTES {
        return Err(format!("{} bytes is over the {CLIPBOARD_MAX_BYTES}-byte clipboard limit", text.len()));
    }
    Ok(())
}

/// Puts text on the macOS clipboard: a selection in the pane, or a program's OSC 52 write. There is
/// deliberately no command that reads the clipboard, so nothing running in the pane can get at it.
#[tauri::command]
pub fn clipboard_write_text(text: String) -> Result<(), String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;

    if let Err(e) = check_clipboard_text(&text) {
        log::warn!("clipboard: refused a write: {e}");
        return Err(e);
    }
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    // SAFETY: NSPasteboardTypeString is an immutable AppKit constant.
    if !pasteboard.setString_forType(&NSString::from_str(&text), unsafe { NSPasteboardTypeString }) {
        log::warn!("clipboard: the pasteboard refused {} bytes", text.len());
        return Err("the pasteboard refused the text".into());
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_text_is_never_empty_and_never_over_the_limit() {
        assert!(check_clipboard_text("").is_err());
        assert!(check_clipboard_text("ção ✓").is_ok());
        assert!(check_clipboard_text(&"a".repeat(CLIPBOARD_MAX_BYTES)).is_ok());
        assert!(check_clipboard_text(&"a".repeat(CLIPBOARD_MAX_BYTES + 1)).is_err());
    }

    #[test]
    fn the_clipboard_limit_counts_bytes_not_characters() {
        // 524 289 "ç" are fewer characters than the limit, but 1 048 578 bytes.
        assert!(check_clipboard_text(&"ç".repeat(524_289)).is_err());
    }
}
