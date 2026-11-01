//! Tauri commands the webview calls. Reads only; every write happens in the Rust core.

use crate::keychain::{KeyStore, Keys, CONVEX_ACCOUNT, HOSTINGER_ACCOUNT, OLLAMA_ACCOUNT};
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
    readings::read_now(&store, control.data_dir(), control.backfill(), now_ms).map_err(|e| e.to_string())
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
    /// `system`, `light` or `dark`: which ground the window draws on.
    pub appearance: String,
    /// The accent chosen in Settings as `#rrggbb`, or `None` for the brand's own (DESIGN.md §2.1).
    pub accent: Option<String>,
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

/// Settings (§3.9): everything the Settings page shows. Never a secret. Async, with the Keychain's three questions and
/// the hook's file read on a blocking thread (`keychain`): each question spawns `security`, which can wait on a locked
/// Keychain, and a sync command waits on the main thread.
#[tauri::command]
pub async fn get_settings(
    store: State<'_, Store>,
    keys: State<'_, Keys>,
    link: State<'_, crate::cli_link::CliLink>,
    control: State<'_, ReaderControl>,
    system: State<'_, SystemState>,
) -> Result<SettingsView, String> {
    // Everything that needs the connection is read under one guard: taking it twice on this thread would deadlock.
    let (
        org_name,
        appearance,
        accent,
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
            system::stored_appearance(system::get_setting(&conn, org, "appearance")).0.to_string(),
            system::stored_accent(system::get_setting(&conn, org, "accent")),
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
    let data_dir = control.data_dir().to_path_buf();
    let (ollama_key_saved, convex_key_saved, hostinger_key_saved, claude_hook) = keychain(&keys, move |k| {
        let saved = |account: &str| key_saved(k, account).unwrap_or(false);
        Ok((saved(OLLAMA_ACCOUNT), saved(CONVEX_ACCOUNT), saved(HOSTINGER_ACCOUNT), claude_plan::hook_status(&data_dir, now_ms)))
    })
    .await?;
    Ok(SettingsView {
        org_name,
        appearance,
        accent,
        menu_bar_quota,
        global_hotkey,
        launch_at_login,
        hotkey_error: system.hotkey_error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        autostart_error: system.autostart_error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        cli_link: link.0.clone(),
        ollama_key_saved,
        convex_key_saved,
        convex_deployment_url,
        convex_plan,
        hostinger_key_saved,
        hostinger_vm_id,
        hostinger_vm_label,
        claude_hook,
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
///
/// Async, with the typed path resolved on a blocking thread: a sync command runs on the main thread, and a folder on a
/// network share that stopped answering froze the window for the mount's timeout (`no_command_on_the_main_thread_resolves_a_path`).
#[tauri::command]
pub async fn set_projects_root(store: State<'_, Store>, path: String) -> Result<String, String> {
    let value = tauri::async_runtime::spawn_blocking(move || projects_folder(&path)).await.map_err(|e| format!("the projects folder was not checked: {e}"))??;
    system::put_setting(&store.conn(), store.org_id(), crate::paths::SETTING_KEY, &serde_json::json!(value)).map_err(|e| e.to_string())?;
    Ok(value)
}

/// A typed projects folder as `set_projects_root` stores it: `~` expanded, absolute, existing, a folder, canonicalized.
fn projects_folder(path: &str) -> Result<String, String> {
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
    Ok(real.display().to_string())
}

/// The command Open in editor runs (reader R36): one trimmed line of at most 200 characters.
#[tauri::command]
pub fn set_reader_editor(store: State<'_, Store>, value: String) -> Result<(), String> {
    let value = crate::reader::editor::check_editor(&value)?;
    system::put_setting(&store.conn(), store.org_id(), "reader_editor", &serde_json::json!(value)).map_err(|e| e.to_string())
}

/// Settings → Appearance's accent. Stored as `#rrggbb`, or the row removed for the brand's own; the page reads it
/// back through `get_settings` and sets `--brand-accent` itself — no capability, no message, no window call.
#[tauri::command]
pub fn set_accent(store: State<'_, Store>, value: Option<String>) -> Result<(), String> {
    let conn = store.conn();
    let org = store.org_id();
    match value {
        Some(hex) => {
            let hex = system::parse_accent(&hex)?;
            system::put_setting(&conn, org, "accent", &serde_json::json!(hex)).map_err(|e| e.to_string())
        }
        None => conn
            .execute("DELETE FROM settings WHERE org_id = ?1 AND key = 'accent'", [org])
            .map(|_| ())
            .map_err(|e| e.to_string()),
    }
}

/// Settings → Appearance. Stored first, then applied to the window: the title bar and the webview's
/// `prefers-color-scheme` follow from that one call, so the page needs no capability and no message.
#[tauri::command]
pub fn set_appearance(window: tauri::WebviewWindow, store: State<'_, Store>, value: String) -> Result<(), String> {
    let theme = system::parse_appearance(&value)?;
    system::put_setting(&store.conn(), store.org_id(), "appearance", &serde_json::json!(value)).map_err(|e| e.to_string())?;
    system::apply_appearance(&window, theme);
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

/// R30: registers first, and only a chord that registered is saved. No fallback chord: a refused one keeps the hotkey
/// that worked (`system::register_hotkey`), which is still the one saved.
#[tauri::command]
pub fn set_global_hotkey(app: AppHandle, store: State<'_, Store>, chord: String) -> Result<(), String> {
    system::register_hotkey(&app, &chord)?;
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
    /// The accent chosen in Settings, or `None` for the brand's own; applied by the page at boot (DESIGN.md §2.1).
    pub accent: Option<String>,
    /// Whether Contents and Files show beside the text, and the side column's width (reader-layout PRD rule 4). Read
    /// here, before the window draws, so a hidden Contents never flashes open on the first file.
    pub reader_side: ReaderSide,
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
        accent: system::stored_accent(system::get_setting(&conn, org, "accent")),
        reader_side: reader_side(system::get_setting(&conn, org, "reader_side")),
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

/// Contents, Files and the column's width (reader-layout PRD rules 4–7). One settings row, `reader_side`, holding
/// no path (ADR 0007), written once per gesture (ADR 0005): a toggle's click, a drag's end, a double-click.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct ReaderSide {
    pub contents: bool,
    pub files: bool,
    /// In px. The webview draws it narrower when the text would get less than 320 px, and keeps this.
    pub width: f64,
}

/// 220 is `--sidebar-w`, the column's width before it could be dragged. Must equal SIDE_DEFAULT in reader/side.ts.
pub const READER_SIDE_DEFAULT: ReaderSide = ReaderSide { contents: true, files: true, width: 220.0 };
const READER_SIDE_MIN: f64 = 160.0;
const READER_SIDE_MAX: f64 = 480.0;

/// Each field on its own, so a bad width with good booleans keeps the booleans; missing or not an object is the
/// default. A hand-edited setting never lays the reader out badly, as `reader_width` says for the divider.
fn reader_side(value: Option<serde_json::Value>) -> ReaderSide {
    let Some(serde_json::Value::Object(fields)) = value else { return READER_SIDE_DEFAULT };
    let flag = |key: &str, default: bool| fields.get(key).and_then(|v| v.as_bool()).unwrap_or(default);
    ReaderSide {
        contents: flag("contents", READER_SIDE_DEFAULT.contents),
        files: flag("files", READER_SIDE_DEFAULT.files),
        width: fields
            .get("width")
            .and_then(|v| v.as_f64())
            .filter(|w| w.is_finite() && (READER_SIDE_MIN..=READER_SIDE_MAX).contains(w))
            .unwrap_or(READER_SIDE_DEFAULT.width),
    }
}

/// The width finite and within 160–480 px, rounded to a whole pixel; refused otherwise, as `set_reader_width` refuses.
fn valid_side(side: ReaderSide) -> Result<ReaderSide, String> {
    if !side.width.is_finite() || !(READER_SIDE_MIN..=READER_SIDE_MAX).contains(&side.width) {
        return Err(format!("the reader's side column must be between {READER_SIDE_MIN} and {READER_SIDE_MAX} px wide"));
    }
    Ok(ReaderSide { width: side.width.round(), ..side })
}

#[tauri::command]
pub fn set_reader_side(store: State<'_, Store>, side: ReaderSide) -> Result<(), String> {
    let side = valid_side(side)?;
    system::put_setting(&store.conn(), store.org_id(), "reader_side", &serde_json::json!(side)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod reader_side_tests {
    use super::*;

    #[test]
    fn a_missing_reader_side_is_the_default() {
        assert_eq!(reader_side(None), READER_SIDE_DEFAULT);
        assert_eq!(READER_SIDE_DEFAULT, ReaderSide { contents: true, files: true, width: 220.0 });
    }

    #[test]
    fn each_field_of_a_stored_reader_side_falls_back_on_its_own() {
        let stored = serde_json::json!({ "contents": false, "files": "x", "width": 900 });
        assert_eq!(reader_side(Some(stored)), ReaderSide { contents: false, files: true, width: 220.0 });
        let stored = serde_json::json!({ "contents": 1, "files": false, "width": 90 });
        assert_eq!(reader_side(Some(stored)), ReaderSide { contents: true, files: false, width: 220.0 });
        let stored = serde_json::json!({ "contents": true, "files": true, "width": 300 });
        assert_eq!(reader_side(Some(stored)), ReaderSide { contents: true, files: true, width: 300.0 });
        for bad in [serde_json::json!("x"), serde_json::Value::Null, serde_json::json!([]), serde_json::json!(220)] {
            assert_eq!(reader_side(Some(bad)), READER_SIDE_DEFAULT);
        }
    }

    #[test]
    fn valid_side_refuses_a_width_outside_160_to_480() {
        let at = |width: f64| valid_side(ReaderSide { contents: false, files: true, width });
        for bad in [159.9, 480.1, f64::NAN, f64::INFINITY] {
            assert!(at(bad).is_err(), "{bad} was accepted");
        }
        assert_eq!(at(160.0).map(|s| s.width), Ok(160.0));
        assert_eq!(at(480.0).map(|s| s.width), Ok(480.0));
        assert_eq!(at(300.4), Ok(ReaderSide { contents: false, files: true, width: 300.0 }));
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

/// The Keychain's work on a blocking thread, as `hostinger_list_vms` and the reader commands do theirs: every call
/// spawns `/usr/bin/security`, and a Keychain slow to answer — locked, or asking for a password — must not freeze the
/// window, which a sync command would. The `Arc` is cloned because `State<'_, Keys>` cannot outlive the call.
async fn keychain<T: Send + 'static>(keys: &Keys, work: impl FnOnce(&dyn KeyStore) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let store = std::sync::Arc::clone(&keys.0);
    tauri::async_runtime::spawn_blocking(move || work(store.as_ref())).await.map_err(|e| format!("the Keychain did not answer: {e}"))?
}

/// Whether a secret is in the Keychain. Never the secret itself; every error redacted (ADR 0006), as below.
fn key_saved(keys: &dyn KeyStore, account: &str) -> Result<bool, String> {
    keys.get(account).map(|k| k.is_some()).map_err(|e| redact(&e))
}

/// Saves a secret, trimmed; `empty` is the refusal for nothing typed.
fn save_key(keys: &dyn KeyStore, account: &str, secret: &str, empty: &str) -> Result<(), String> {
    let secret = secret.trim();
    if secret.is_empty() {
        return Err(empty.into());
    }
    keys.set(account, secret).map_err(|e| redact(&e))
}

fn remove_key(keys: &dyn KeyStore, account: &str) -> Result<(), String> {
    keys.remove(account).map_err(|e| redact(&e))
}

/// Settings: whether an Ollama Cloud API key is saved. Never returns the key itself (R4).
#[tauri::command]
pub async fn ollama_key_status(keys: State<'_, Keys>) -> Result<KeyStatus, String> {
    Ok(KeyStatus { saved: keychain(&keys, |k| key_saved(k, OLLAMA_ACCOUNT)).await? })
}

/// Settings: saves the key in the Keychain (R4) and asks the Ollama reader to poll now.
#[tauri::command]
pub async fn save_ollama_key(keys: State<'_, Keys>, control: State<'_, ReaderControl>, key: String) -> Result<(), String> {
    keychain(&keys, move |k| save_key(k, OLLAMA_ACCOUNT, &key, "the key is empty")).await?;
    control.refresh();
    Ok(())
}

/// Settings: removes the key. The Ollama gauge goes back to "Add API key" on the next poll.
#[tauri::command]
pub async fn remove_ollama_key(keys: State<'_, Keys>, control: State<'_, ReaderControl>) -> Result<(), String> {
    keychain(&keys, |k| remove_key(k, OLLAMA_ACCOUNT)).await?;
    control.refresh();
    Ok(())
}

#[tauri::command]
pub async fn convex_key_status(keys: State<'_, Keys>) -> Result<KeyStatus, String> {
    Ok(KeyStatus { saved: keychain(&keys, |k| key_saved(k, CONVEX_ACCOUNT)).await? })
}

/// Settings: saves the Convex deploy key in the Keychain and asks the reader to poll now (convex R2).
///
/// The key should be minted with **only** `deployment:usage:view` — so scoped, it cannot deploy, read or write
/// data, run functions, or read environment variables. Nothing here can check that, which is exactly why the
/// GET-only guard test exists on the reader.
#[tauri::command]
pub async fn save_convex_key(keys: State<'_, Keys>, control: State<'_, ReaderControl>, key: String) -> Result<(), String> {
    keychain(&keys, move |k| save_key(k, CONVEX_ACCOUNT, &key, "the key is empty")).await?;
    control.refresh();
    Ok(())
}

/// Settings: removes the key. The Convex gauges go back to "Add deploy key" on the next poll.
#[tauri::command]
pub async fn remove_convex_key(keys: State<'_, Keys>, control: State<'_, ReaderControl>) -> Result<(), String> {
    keychain(&keys, |k| remove_key(k, CONVEX_ACCOUNT)).await?;
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
pub async fn hostinger_key_status(keys: State<'_, Keys>) -> Result<KeyStatus, String> {
    Ok(KeyStatus { saved: keychain(&keys, |k| key_saved(k, HOSTINGER_ACCOUNT)).await? })
}

#[tauri::command]
pub async fn save_hostinger_token(keys: State<'_, Keys>, control: State<'_, ReaderControl>, token: String) -> Result<(), String> {
    keychain(&keys, move |k| save_key(k, HOSTINGER_ACCOUNT, &token, "the token is empty")).await?;
    control.refresh();
    Ok(())
}

#[tauri::command]
pub async fn remove_hostinger_token(keys: State<'_, Keys>, control: State<'_, ReaderControl>) -> Result<(), String> {
    keychain(&keys, |k| remove_key(k, HOSTINGER_ACCOUNT)).await?;
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
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

/// Starts the pane's profile (R32). Output is delivered as raw bytes (R34); `on_exit` fires once with
/// the exit code.
///
/// Async, with the profile and the spawn on a blocking thread: building the profile asks `defaults` for the locale
/// (Kinas started from Finder has no LANG) and stats a folder under `~/Documents`, and the spawn forks the shell — on
/// the main thread the window froze for all of it (`no_command_on_the_main_thread_resolves_a_path`). The start begins
/// before anything else: what the pane sends meanwhile waits for this session (`PtyState::begin`, `hold`).
#[tauri::command]
pub async fn pty_start(
    window: tauri::WebviewWindow,
    state: State<'_, PtyState>,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<Option<u32>>,
    cols: u16,
    rows: u16,
) -> Result<Option<u32>, String> {
    let state = state.inner().clone();
    let generation = state.begin();
    let starter = state.clone();
    let started = tauri::async_runtime::spawn_blocking(move || {
        // The ground the window draws on now, whichever of Settings' three choices made it so; asked again at every
        // start, so a pane restarted after a change opens on the right logo.
        let light = matches!(window.theme(), Ok(tauri::Theme::Light));
        let profile = pty::default_profile(light);
        log::info!("terminal: starting {} {:?} in {}", profile.program, profile.args, profile.cwd.display());
        starter.spawn(
            generation,
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
    })
    .await;
    started.unwrap_or_else(|e| {
        state.fail(generation);
        Err(format!("the terminal did not start: {e}"))
    })
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, data: String) -> Result<(), String> {
    state.write(data.as_bytes())
}

/// xterm's onBinary data (e.g. some mouse reports): one byte per element.
#[tauri::command]
pub fn pty_write_binary(state: State<'_, PtyState>, data: Vec<u8>) -> Result<(), String> {
    state.write(&data)
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(cols, rows)
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
    write_clipboard(&text)
}

/// The one door for text Kinas puts on the clipboard: the pane's copies, and the crew's answer lines (ADR 0017, build
/// spec §6.4). Call it on the main thread. A debug build with `KINAS_E2E_CLIPBOARD_FILE` set writes that file instead,
/// so a spec reads what was copied and the Mac's own clipboard is left alone.
pub(crate) fn write_clipboard(text: &str) -> Result<(), String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;

    if let Err(e) = check_clipboard_text(text) {
        log::warn!("clipboard: refused a write: {e}");
        return Err(e);
    }
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("KINAS_E2E_CLIPBOARD_FILE").filter(|p| !p.is_empty()) {
        return std::fs::write(path, text).map_err(|e| format!("the test clipboard file could not be written: {e}"));
    }
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    // SAFETY: NSPasteboardTypeString is an immutable AppKit constant.
    if !pasteboard.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString }) {
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

    /// A Keychain that fails every call with a message carrying a bearer token, a GitHub token and an Anthropic key.
    struct Leaky;

    const LEAK: &str = "security said: Bearer 9c2e-secret-token, ghp_9c2eFAKEabc and sk-ant-9c2e-FAKE";

    impl KeyStore for Leaky {
        fn get(&self, _: &str) -> Result<Option<String>, String> {
            Err(LEAK.into())
        }
        fn set(&self, _: &str, _: &str) -> Result<(), String> {
            Err(LEAK.into())
        }
        fn remove(&self, _: &str) -> Result<(), String> {
            Err(LEAK.into())
        }
    }

    /// ADR 0006: every error string is redacted before anything carries it on — Settings shows these. Saving redacted
    /// already; removing a key and asking whether one is saved returned the Keychain's words as they came.
    #[test]
    fn every_keychain_error_settings_sees_is_redacted() {
        let redacted = "security said: [redacted] [redacted] and [redacted]";
        for account in [OLLAMA_ACCOUNT, CONVEX_ACCOUNT, HOSTINGER_ACCOUNT] {
            assert_eq!(save_key(&Leaky, account, " key-9c2e ", "the key is empty").unwrap_err(), redacted, "save {account}");
            assert_eq!(remove_key(&Leaky, account).unwrap_err(), redacted, "remove {account}");
            assert_eq!(key_saved(&Leaky, account).unwrap_err(), redacted, "status {account}");
        }
        let keys = crate::keychain::MemoryKeyStore::default();
        assert_eq!(save_key(&keys, OLLAMA_ACCOUNT, "  ", "the key is empty").unwrap_err(), "the key is empty");
        save_key(&keys, OLLAMA_ACCOUNT, " key-9c2e ", "the key is empty").unwrap();
        assert_eq!(keys.get(OLLAMA_ACCOUNT).unwrap().as_deref(), Some("key-9c2e"), "trimmed");
        assert_eq!(key_saved(&keys, OLLAMA_ACCOUNT), Ok(true));
        remove_key(&keys, OLLAMA_ACCOUNT).unwrap();
        assert_eq!(key_saved(&keys, OLLAMA_ACCOUNT), Ok(false));
    }

    /// Each command's text as (name, is async, signature and body), for every line of `text` that is `#[tauri::command]`.
    fn commands_in(text: &str) -> Vec<(String, bool, String)> {
        let mut out = Vec::new();
        let starts = text.split_inclusive('\n').scan(0, |at, line| {
            let start = *at;
            *at += line.len();
            Some((start, line.trim() == "#[tauri::command]"))
        });
        for at in starts.filter(|(_, command)| *command).map(|(at, _)| at).collect::<Vec<_>>() {
            let rest = &text[at..];
            let Some(fn_at) = rest.find("fn ") else { continue };
            let header = &rest[..fn_at];
            let name: String = rest[fn_at + 3..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            let Some(open) = rest.find('{') else { continue };
            let (mut depth, mut end) = (0, rest.len());
            for (i, c) in rest[open..].char_indices() {
                match c {
                    '{' => depth += 1,
                    '}' => {
                        depth -= 1;
                        if depth == 0 {
                            end = open + i + 1;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            out.push((name, header.contains("async"), rest[..end].to_string()));
        }
        out
    }

    /// Sync commands that reach the Keychain: each spawns `/usr/bin/security`, and a sync command runs on the main
    /// thread, so a Keychain slow to answer (locked, or asking for a password) froze the window.
    fn keychain_on_the_main_thread(files: &[(String, String)]) -> Vec<String> {
        let mut out = Vec::new();
        for (path, text) in files {
            for (name, is_async, code) in commands_in(text) {
                if !is_async && ["Keys", "KeyStore", "_ACCOUNT"].iter().any(|k| code.contains(k)) {
                    out.push(format!("{path}: {name}"));
                }
            }
        }
        out
    }

    /// Every `.rs` file under `src/`, by its path from there, with its text.
    fn crate_sources() -> Vec<(String, String)> {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        let mut stack = vec![src.clone()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    files.push((path.strip_prefix(&src).unwrap().display().to_string(), std::fs::read_to_string(&path).unwrap()));
                }
            }
        }
        files
    }

    /// What resolves or stats a path: a caller's path on a network share that stopped answering waits out the mount's
    /// timeout in any of these.
    /// `default_profile(` is the pane's: it asks `defaults` for the locale and stats a folder under `~/Documents`.
    const DISK: [&str; 12] = ["canonicalize", "metadata(", ".is_dir()", ".is_file()", ".exists()", "try_exists", "read_dir", "fs::read", "access::resolve", "checked(", "real_root(", "default_profile("];

    /// Sync commands that resolve or stat a path: a sync command runs on the main thread, so a path typed into Settings
    /// that lies on a dead share froze the window — `set_projects_root` did, through its `canonicalize`.
    fn disk_on_the_main_thread(files: &[(String, String)]) -> Vec<String> {
        let mut out = Vec::new();
        for (path, text) in files {
            for (name, is_async, code) in commands_in(text) {
                if !is_async && DISK.iter().any(|k| code.contains(k)) {
                    out.push(format!("{path}: {name}"));
                }
            }
        }
        out
    }

    #[test]
    fn no_command_on_the_main_thread_resolves_a_path() {
        let files = crate_sources();
        let commands = files.iter().find(|(p, _)| p == "commands.rs").map(|(_, t)| commands_in(t)).unwrap_or_default();
        assert!(commands.iter().any(|(name, ..)| name == "set_projects_root"), "the guard is not reading commands.rs");
        assert_eq!(disk_on_the_main_thread(&files), Vec::<String>::new());
        // The negative control: a sync command that canonicalizes or stats what it was handed is found; an async one is not.
        let planted = |code: &str| vec![("x.rs".to_string(), format!("#[tauri::command]\n{code}\n"))];
        assert_eq!(disk_on_the_main_thread(&planted("pub fn a(path: String) -> bool { std::fs::canonicalize(&path).is_ok() }")), ["x.rs: a"]);
        assert_eq!(disk_on_the_main_thread(&planted("pub fn b(path: String) -> bool { std::path::Path::new(&path).is_dir() }")), ["x.rs: b"]);
        assert!(disk_on_the_main_thread(&planted("pub async fn c(path: String) -> Result<bool, String> { Ok(std::path::Path::new(&path).exists()) }")).is_empty());
    }

    #[test]
    fn no_command_on_the_main_thread_reaches_the_keychain() {
        let files = crate_sources();
        let commands = files.iter().find(|(p, _)| p == "commands.rs").map(|(_, t)| commands_in(t)).unwrap_or_default();
        assert!(commands.iter().any(|(name, ..)| name == "save_ollama_key"), "the guard is not reading commands.rs");
        assert_eq!(keychain_on_the_main_thread(&files), Vec::<String>::new());
        // The negative control: a sync command handed the key store, or naming an account, is found.
        let planted = |code: &str| vec![("x.rs".to_string(), format!("#[tauri::command]\n{code}\n"))];
        assert_eq!(keychain_on_the_main_thread(&planted("pub fn a(keys: State<'_, Keys>) -> bool { true }")), ["x.rs: a"]);
        assert_eq!(keychain_on_the_main_thread(&planted("pub fn b(app: AppHandle) { let _ = app.state::<Keys>().0.get(OLLAMA_ACCOUNT); }")), ["x.rs: b"]);
        assert!(keychain_on_the_main_thread(&planted("pub async fn c(keys: State<'_, Keys>) -> Result<(), String> { Ok(()) }")).is_empty());
    }

    #[test]
    fn the_clipboard_limit_counts_bytes_not_characters() {
        // 524 289 "ç" are fewer characters than the limit, but 1 048 578 bytes.
        assert!(check_clipboard_text(&"ç".repeat(524_289)).is_err());
    }
}
