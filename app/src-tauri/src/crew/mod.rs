//! The crew's commands (build spec §11.2): the first mate is Firstmate, adopted (ADR 0016), and Kinas builds only the
//! bridge. Every command that touches a file, a process or the store runs off the main thread (`spawn_blocking`, the
//! `list_projects` shape); `set_crew_visible` touches memory only.

pub(crate) mod config;
pub(crate) mod firstmate;
pub(crate) mod home;
pub(crate) mod pin;
pub(crate) mod read;
pub(crate) mod tools;

use crate::readers::crew::CrewLive;
use crate::readers::runtime::ReaderControl;
use crate::store::{now_ms, Store};
use config::{Away, ProjectMode};
use home::PinState;
use read::CrewSnapshot;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tools::{Health, ToolState};

/// A refusal the webview shows as it is (the `ReaderError` shape).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CrewError {
    code: &'static str,
    message: String,
}

impl CrewError {
    fn internal(message: impl Into<String>) -> Self {
        CrewError { code: "internal", message: message.into() }
    }
}

fn crew_home(app: &AppHandle) -> PathBuf {
    home::home_in(app.state::<ReaderControl>().data_dir())
}

/// "<tool> isn't installed — run kinas crew setup": what blocks the launch, from the health the app last probed.
fn blocked_line(h: &Health) -> Option<String> {
    tools::first_missing_required(h).map(|tool| format!("{tool} isn't installed — run kinas crew setup"))
}

/// The Crew page's reading: the tasks inside retention, the page's state and the collector's status. It never probes
/// the tools itself (it is read every 30 s); `blocked` comes from the health Settings or the page last asked for.
#[tauri::command]
pub async fn crew_snapshot(app: AppHandle) -> Result<CrewSnapshot, CrewError> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crew_home(&app);
        // The file check and the collector's memory, before the guard.
        let installed = home::installed(&home);
        let generated = app.state::<CrewLive>().generated();
        let blocked = tools::cached(&home).as_ref().and_then(blocked_line);
        let store = app.state::<Store>();
        let conn = store.conn();
        let mut view = read::snapshot_view(&conn, store.org_id(), now_ms(), installed, generated).map_err(|e| CrewError::internal(format!("could not read the crew: {e}")))?;
        view.blocked = blocked;
        Ok(view)
    })
    .await
    .map_err(|e| CrewError::internal(format!("the crew reading did not finish: {e}")))?
}

/// The Crew page is on screen, or no longer is (§6.6): the collector's baseline and its Visible trigger.
#[tauri::command]
pub fn set_crew_visible(control: State<'_, ReaderControl>, visible: bool) {
    control.set_crew_visible(visible);
}

/// Settings → Crew, and the Crew page's tool table (§4 Settings).
#[derive(Debug, Serialize)]
pub struct CrewSettings {
    pub pin: PinState,
    pub home_display: String,
    pub backend: Option<String>,
    pub tools: Vec<ToolState>,
    pub prereqs: Vec<ToolState>,
    pub gh_signed_in: Option<bool>,
    pub away: Option<Away>,
    pub projects: Vec<ProjectMode>,
    pub installed: bool,
    /// The same line the Crew page's Launch carries when a required tool is missing.
    pub blocked: Option<String>,
}

#[tauri::command]
pub async fn crew_settings(app: AppHandle) -> Result<CrewSettings, CrewError> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crew_home(&app);
        let now = now_ms();
        let installed = home::installed(&home);
        // The probes and Firstmate's scripts run with no guard held.
        let (health, fresh) = tools::health(&home, now);
        let settings = CrewSettings {
            pin: health.pin.clone(),
            home_display: crate::projects::display_of(&home, &user_home()),
            backend: home::backend(&home),
            tools: health.tools.clone(),
            prereqs: health.prereqs.clone(),
            gh_signed_in: health.gh_signed_in,
            away: if installed { config::away(&home) } else { None },
            projects: if installed { config::project_modes(&home, now) } else { Vec::new() },
            installed,
            blocked: blocked_line(&health),
        };
        if fresh {
            let store = app.state::<Store>();
            let conn = store.conn();
            let _ = crate::system::put_setting(&conn, store.org_id(), HEALTH_KEY, &health_json(&health, installed));
        }
        Ok(settings)
    })
    .await
    .map_err(|e| CrewError::internal(format!("the crew's settings did not finish: {e}")))?
}

/// What `kinas crew status` shows of the install with the app closed (§4 The CLI): the commit the app last saw and each
/// tool's version and state. Names and versions only.
const HEALTH_KEY: &str = "crew_health";

fn health_json(h: &Health, installed: bool) -> serde_json::Value {
    let at = match &h.pin {
        PinState::Pinned { short } | PinState::Moved { short, .. } => Some(short.clone()),
        PinState::Tangle { .. } | PinState::Missing => None,
    };
    serde_json::json!({
        "installed": installed,
        "at": at,
        "tools": h.tools.iter().map(|t| serde_json::json!({ "name": t.name, "version": t.installed, "ok": t.state == "installed" })).collect::<Vec<_>>(),
        "checked_at": h.checked_at,
    })
}

fn user_home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| Path::new("/").to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stored_health_is_names_versions_and_the_short_commit() {
        let h = Health {
            tools: vec![ToolState { name: "tasks-axi", pinned: "0.2.5", installed: Some("0.2.5".into()), state: "installed", required: true }],
            prereqs: vec![],
            gh_signed_in: Some(true),
            pin: PinState::Pinned { short: "f9f74a1".into() },
            checked_at: 7,
        };
        assert_eq!(
            health_json(&h, true),
            serde_json::json!({ "installed": true, "at": "f9f74a1", "tools": [{ "name": "tasks-axi", "version": "0.2.5", "ok": true }], "checked_at": 7 })
        );
        assert_eq!(blocked_line(&h), None);
        let missing = Health { tools: vec![ToolState { state: "missing", installed: None, ..h.tools[0].clone() }], ..h };
        assert_eq!(blocked_line(&missing).as_deref(), Some("tasks-axi isn't installed — run kinas crew setup"));
    }
}
