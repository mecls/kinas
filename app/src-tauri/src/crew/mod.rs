//! The crew's commands (build spec §11.2): the first mate is Firstmate, adopted (ADR 0016), and Kinas builds only the
//! bridge. Every command that touches a file or the store runs off the main thread (`spawn_blocking`, the
//! `list_projects` shape); `set_crew_visible` touches memory only.

pub(crate) mod firstmate;
pub(crate) mod home;
pub(crate) mod pin;
pub(crate) mod read;

use crate::readers::crew::CrewLive;
use crate::readers::runtime::ReaderControl;
use crate::store::{now_ms, Store};
use read::CrewSnapshot;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

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

/// The Crew page's reading: the tasks inside retention, the page's state and the collector's status.
#[tauri::command]
pub async fn crew_snapshot(app: AppHandle) -> Result<CrewSnapshot, CrewError> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = home::home_in(app.state::<ReaderControl>().data_dir());
        // The file check and the collector's memory, before the guard.
        let installed = home::installed(&home);
        let generated = app.state::<CrewLive>().generated();
        let store = app.state::<Store>();
        let conn = store.conn();
        read::snapshot_view(&conn, store.org_id(), now_ms(), installed, generated).map_err(|e| CrewError::internal(format!("could not read the crew: {e}")))
    })
    .await
    .map_err(|e| CrewError::internal(format!("the crew reading did not finish: {e}")))?
}

/// The Crew page is on screen, or no longer is (§6.6): the collector's baseline and its Visible trigger.
#[tauri::command]
pub fn set_crew_visible(control: State<'_, ReaderControl>, visible: bool) {
    control.set_crew_visible(visible);
}
