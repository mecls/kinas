//! The palette's file search (tasks/interface-polish, PRD rules 13, 15 and 18; build-spec §11.2).
//!
//! Slice 1, the tracer bullet: no index yet. A search for anything answers with the projects folder's own `README.md`
//! when it has one, so the palette's Files group, its Enter and the reader can be wired end to end. Slice 2 replaces
//! `stub` with the in-memory index (the walk, the fold, the score) behind the same two commands and the same shapes.
//!
//! Nothing here writes a row, a setting or a log line (build-spec invariant 5).

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

use crate::reader::access::{self, Kind};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileMatch {
    /// The real path, as the reader opens it.
    pub path: String,
    /// The path under the projects folder, as the sidebar writes it.
    pub display_path: String,
    pub name: String,
    pub kind: Kind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileSearch {
    /// No complete index yet: the group says "Indexing files…" (rule 18).
    pub indexing: bool,
    /// The index stopped at its cap: the group says only the first entries are searched.
    pub capped: bool,
    pub matches: Vec<FileMatch>,
    /// How many more matched than `limit`.
    pub more: u32,
}

/// Starts the index, or rebuilds it in the background when it is old. Slice 1: there is no index to start.
#[tauri::command]
pub async fn files_index_warm() -> Result<(), String> {
    Ok(())
}

/// The best `limit` files and folders whose name matches `query`, under the projects folder only.
#[tauri::command]
pub async fn files_search(app: tauri::AppHandle, query: String, limit: u32) -> Result<FileSearch, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
        stub(&root, &home(), &query, limit)
    })
    .await
    .map_err(|e| e.to_string())
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// Slice 1's answer: the root's `README.md` for any query that is not blank, and nothing else.
fn stub(root: &Path, home: &Path, query: &str, limit: u32) -> FileSearch {
    let readme = root.join("README.md");
    let found = (!query.trim().is_empty() && limit > 0 && readme.is_file()).then(|| std::fs::canonicalize(&readme).ok()).flatten();
    let matches = found
        .map(|real| {
            vec![FileMatch {
                display_path: access::display_path(&real, root, home),
                path: real.display().to_string(),
                name: "README.md".to_string(),
                kind: Kind::File,
            }]
        })
        .unwrap_or_default();
    FileSearch { indexing: false, capped: false, matches, more: 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stub_finds_the_roots_readme_for_any_query() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("README.md"), "# Root\n").unwrap();
        let found = stub(dir.path(), Path::new("/nowhere"), "anything", 5);
        assert_eq!(found.matches.len(), 1);
        assert_eq!(found.matches[0].name, "README.md");
        assert_eq!(found.matches[0].kind, Kind::File);
        assert_eq!(found.matches[0].display_path, "README.md");
        assert!(found.matches[0].path.ends_with("/README.md"));
        assert!(!found.indexing && !found.capped && found.more == 0);
    }

    #[test]
    fn the_stub_finds_nothing_for_a_blank_query_a_zero_limit_or_no_readme() {
        let dir = tempfile::tempdir().unwrap();
        assert!(stub(dir.path(), Path::new("/nowhere"), "readme", 5).matches.is_empty());
        std::fs::write(dir.path().join("README.md"), "# Root\n").unwrap();
        assert!(stub(dir.path(), Path::new("/nowhere"), "   ", 5).matches.is_empty());
        assert!(stub(dir.path(), Path::new("/nowhere"), "readme", 0).matches.is_empty());
    }
}
