//! Tauri commands the webview calls. Reads only; every write happens in the Rust core.

use crate::store::Store;
use serde::Serialize;
use tauri::State;

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
