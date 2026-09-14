use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// The folder holding `kinas.sqlite` and the status-line inbox.
///
/// `KINAS_DATA_DIR` overrides it in every build (PRD R7 allows it for tests); otherwise it is the
/// app data folder Tauri derives from the identifier:
/// `~/Library/Application Support/ai.sintralabs.kinas`.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("KINAS_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    app.path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve the app data folder: {e}"))
}
