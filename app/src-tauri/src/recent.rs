//! Recent (tasks/interface-polish, PRD rule 14; build-spec §7, invariant 6): the last things opened anywhere in Kinas —
//! a file, a folder, a task, a workspace, a setting — newest first. The palette shows the first eight before anything
//! is typed.
//!
//! **No path is stored (ADR 0007, the captain's choice of 2026-11-17).** "The one path the app stores is a pin": a file,
//! a folder and a workspace (whose label is a folder's display path) are kept in memory only, gone when Kinas quits,
//! like the reader's tabs. Tasks and settings — ids, not paths — are kept across a relaunch under one settings key.
//!
//! - **One settings key**, `recent_opened`: a JSON list of `{ kind, key, label, at }`, tasks and settings only. No
//!   table, no migration; a path kind found in it (written by hand) is skipped, never shown.
//! - **Held to `RECENT_CAP`**, one entry per `(kind, key)`, the stored and the remembered each, and the two together.
//! - **A stored value that cannot be read reads as empty** and is left alone until the next push overwrites it.
//! - **A file or folder no longer there is left out** when the list is read.
//!
//! Nothing here logs a key or a label.

use std::path::Path;

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

pub const RECENT_KEY: &str = "recent_opened";
pub const RECENT_CAP: usize = 20;
/// A key longer than this is no path or id Kinas makes, and is refused.
const KEY_MAX: usize = 4096;
/// A label is the thing's name; a longer one is cut.
const LABEL_MAX: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecentKind {
    File,
    Folder,
    Task,
    Workspace,
    Setting,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentItem {
    pub kind: RecentKind,
    /// A file's or a folder's real path; a task's id; a workspace's id; a setting's id (settings/index.ts).
    pub key: String,
    pub label: String,
    /// When it was opened, in ms.
    pub at: i64,
    /// A file's or a folder's path as the sidebar writes it (under the projects folder, or `~/…`): filled when the list
    /// is read, never stored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

impl RecentKind {
    /// Kept across a relaunch: an id, not a path (ADR 0007).
    fn stored(self) -> bool {
        matches!(self, RecentKind::Task | RecentKind::Setting)
    }
}

/// Recent's files, folders and workspaces, for this run of the app only (ADR 0007): managed state, never written.
#[derive(Default)]
pub struct RecentMemory(Mutex<Vec<RecentItem>>);

impl RecentMemory {
    fn list(&self) -> Vec<RecentItem> {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn remember(&self, item: RecentItem) {
        let mut held = self.0.lock().unwrap_or_else(|p| p.into_inner());
        *held = push(std::mem::take(&mut *held), item);
    }
}

/// What the webview sends: the thing, without the time, which is Rust's.
#[derive(Debug, Clone, Deserialize)]
pub struct RecentOpened {
    pub kind: RecentKind,
    pub key: String,
    pub label: String,
}

/// The stored list, newest first: anything that is not a list of items reads as empty, a bad entry or a path kind is
/// skipped, a repeated `(kind, key)` keeps its first (newest) place, and never more than the cap.
pub fn parse(stored: Option<&serde_json::Value>) -> Vec<RecentItem> {
    let Some(entries) = stored.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut items: Vec<RecentItem> = Vec::new();
    for entry in entries {
        let Ok(item) = serde_json::from_value::<RecentItem>(entry.clone()) else { continue };
        if !item.kind.stored() {
            continue;
        }
        if !items.iter().any(|i| i.kind == item.kind && i.key == item.key) {
            items.push(item);
        }
        if items.len() == RECENT_CAP {
            break;
        }
    }
    items
}

/// `item` at the front, any earlier entry of its `(kind, key)` gone, and the oldest past the cap dropped.
pub fn push(list: Vec<RecentItem>, item: RecentItem) -> Vec<RecentItem> {
    let rest = list.into_iter().filter(|i| !(i.kind == item.kind && i.key == item.key));
    std::iter::once(item.clone()).chain(rest).take(RECENT_CAP).collect()
}

/// The webview's item checked and stamped: a key that is empty or too long is refused, a file's or a folder's must be an
/// absolute path, and a label is cut to its limit.
fn stamped(opened: RecentOpened, at: i64) -> Result<RecentItem, String> {
    if opened.key.is_empty() || opened.key.len() > KEY_MAX {
        return Err("Not something Kinas opens".into());
    }
    if matches!(opened.kind, RecentKind::File | RecentKind::Folder) && !Path::new(&opened.key).is_absolute() {
        return Err("Not something Kinas opens".into());
    }
    let label: String = opened.label.chars().filter(|c| !c.is_control()).take(LABEL_MAX).collect();
    Ok(RecentItem { kind: opened.kind, key: opened.key, label, at, display: None })
}

/// Whether an item can still be opened: a file or folder that is gone is left out of the list shown.
fn present(item: &RecentItem) -> bool {
    match item.kind {
        RecentKind::File => Path::new(&item.key).is_file(),
        RecentKind::Folder => Path::new(&item.key).is_dir(),
        RecentKind::Task | RecentKind::Workspace | RecentKind::Setting => true,
    }
}

fn stored(store: &crate::store::Store) -> Vec<RecentItem> {
    let conn = store.conn();
    parse(crate::system::get_setting(&conn, store.org_id(), RECENT_KEY).as_ref())
}

/// A task or a setting into the store; a file, a folder or a workspace into memory only (ADR 0007).
fn record(store: &crate::store::Store, memory: &RecentMemory, item: RecentItem) -> Result<(), String> {
    if !item.kind.stored() {
        memory.remember(item);
        return Ok(());
    }
    // Read, push, write — under one guard, with no file I/O inside it.
    let conn = store.conn();
    let list = push(parse(crate::system::get_setting(&conn, store.org_id(), RECENT_KEY).as_ref()), item);
    let value = serde_json::to_value(&list).map_err(|e| e.to_string())?;
    crate::system::put_setting(&conn, store.org_id(), RECENT_KEY, &value).map_err(|_| "Could not keep it in Recent".to_string())
}

/// The stored and the remembered as one list, newest first, held to the cap.
fn merged(stored: Vec<RecentItem>, remembered: Vec<RecentItem>) -> Vec<RecentItem> {
    let mut all: Vec<RecentItem> = stored.into_iter().chain(remembered).collect();
    all.sort_by_key(|i| std::cmp::Reverse(i.at));
    all.truncate(RECENT_CAP);
    all
}

/// What the palette shows: what is still there, a file or folder with its display path.
fn shown(list: Vec<RecentItem>, root: &Path, home: &Path) -> Vec<RecentItem> {
    list.into_iter()
        .filter(present)
        .map(|mut item| {
            if matches!(item.kind, RecentKind::File | RecentKind::Folder) {
                item.display = Some(crate::reader::access::display_path(Path::new(&item.key), root, home));
            }
            item
        })
        .collect()
}

/// Recent, newest first, without what is gone from disk.
#[tauri::command]
pub async fn recent_list(app: tauri::AppHandle) -> Result<Vec<RecentItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<crate::store::Store>();
        let root = crate::paths::projects_root_of(&store);
        let list = merged(stored(&store), app.state::<RecentMemory>().list());
        let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_else(|| "/".into());
        shown(list, &root, &home)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Something was opened: it goes to the front of Recent.
#[tauri::command]
pub async fn recent_push(app: tauri::AppHandle, item: RecentOpened) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || record(&app.state::<crate::store::Store>(), &app.state::<RecentMemory>(), stamped(item, crate::store::now_ms())?))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(kind: RecentKind, key: &str, at: i64) -> RecentItem {
        RecentItem { kind, key: key.into(), label: key.rsplit('/').next().unwrap().into(), at, display: None }
    }

    #[test]
    fn push_dedupes_and_caps() {
        let a = item(RecentKind::File, "/p/a.md", 1);
        let b = item(RecentKind::Task, "task-b", 2);
        let list = push(push(Vec::new(), a.clone()), b.clone());
        assert_eq!(list, [b.clone(), a.clone()]);
        // The same (kind, key) moves to the front, once.
        let again = item(RecentKind::File, "/p/a.md", 3);
        assert_eq!(push(list.clone(), again.clone()), [again.clone(), b.clone()]);
        // The same key under another kind is another thing.
        let as_setting = item(RecentKind::Setting, "/p/a.md", 4);
        assert_eq!(push(list, as_setting.clone()).len(), 3);
        // The 21st drops the oldest.
        let full: Vec<RecentItem> = (0..RECENT_CAP).fold(Vec::new(), |l, n| push(l, item(RecentKind::Task, &format!("t{n}"), n as i64)));
        assert_eq!(full.len(), RECENT_CAP);
        assert_eq!(full.last().unwrap().key, "t0");
        let over = push(full, item(RecentKind::Task, "t20", 20));
        assert_eq!(over.len(), RECENT_CAP);
        assert_eq!(over[0].key, "t20");
        assert_eq!(over.last().unwrap().key, "t1");
    }

    #[test]
    fn a_malformed_value_reads_as_empty_and_bad_entries_are_skipped() {
        assert_eq!(parse(None), []);
        assert_eq!(parse(Some(&json!("not a list"))), []);
        assert_eq!(parse(Some(&json!({ "kind": "file" }))), []);
        let stored = json!([
            { "kind": "setting", "key": "ollama.key", "label": "ollama.key", "at": 5 },
            { "kind": "nonsense", "key": "x", "label": "x", "at": 4 },
            { "kind": "setting", "key": "ollama.key", "label": "ollama.key", "at": 3 },
            { "kind": "file", "key": "/p/a.md", "label": "a.md", "at": 3 },
            { "kind": "task", "key": "t", "label": "T", "at": 2 },
            "loose"
        ]);
        assert_eq!(
            parse(Some(&stored)),
            [item(RecentKind::Setting, "ollama.key", 5), RecentItem { kind: RecentKind::Task, key: "t".into(), label: "T".into(), at: 2, display: None }],
            "a path written by hand is never shown from the store"
        );
        let many: Vec<serde_json::Value> = (0..30).map(|n| json!({ "kind": "task", "key": format!("t{n}"), "label": "t", "at": n })).collect();
        assert_eq!(parse(Some(&json!(many))).len(), RECENT_CAP);
    }

    #[test]
    fn what_the_webview_sends_is_checked_and_stamped() {
        let opened = |kind, key: &str, label: &str| RecentOpened { kind, key: key.into(), label: label.into() };
        assert_eq!(stamped(opened(RecentKind::File, "/p/a.md", "a.md"), 9).unwrap(), item(RecentKind::File, "/p/a.md", 9));
        assert!(stamped(opened(RecentKind::File, "a.md", "a.md"), 9).is_err(), "a relative path");
        assert!(stamped(opened(RecentKind::Folder, "", "x"), 9).is_err());
        assert!(stamped(opened(RecentKind::Task, &"t".repeat(KEY_MAX + 1), "x"), 9).is_err());
        assert_eq!(stamped(opened(RecentKind::Task, "t", "a\nb"), 9).unwrap().label, "ab");
        assert_eq!(stamped(opened(RecentKind::Setting, "ollama.key", &"x".repeat(500)), 9).unwrap().label.len(), LABEL_MAX);
    }

    #[test]
    fn a_file_or_folder_gone_from_disk_is_left_out_and_the_rest_kept() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        std::fs::write(&file, "x").unwrap();
        let path = |p: &Path| p.display().to_string();
        assert!(present(&item(RecentKind::File, &path(&file), 1)));
        assert!(present(&item(RecentKind::Folder, &path(dir.path()), 1)));
        assert!(!present(&item(RecentKind::File, &path(&dir.path().join("gone.md")), 1)));
        assert!(!present(&item(RecentKind::Folder, &path(&file), 1)), "a file is not a folder");
        assert!(present(&item(RecentKind::Workspace, "w2", 1)));
    }

    #[test]
    fn the_list_shown_carries_each_file_s_display_path_and_the_store_never_does() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::create_dir_all(root.join("acme/docs")).unwrap();
        std::fs::write(root.join("acme/docs/prd.md"), "x").unwrap();
        let file = root.join("acme/docs/prd.md").display().to_string();
        let list = vec![item(RecentKind::File, &file, 2), item(RecentKind::Task, "t", 1), item(RecentKind::File, &root.join("gone.md").display().to_string(), 0)];
        let out = shown(list, &root, Path::new("/nowhere"));
        assert_eq!(out.iter().map(|i| i.display.as_deref()).collect::<Vec<_>>(), [Some("acme/docs/prd.md"), None]);
        assert!(!serde_json::to_string(&item(RecentKind::File, &file, 2)).unwrap().contains("display"), "never stored");
    }

    #[test]
    fn tasks_and_settings_survive_a_relaunch_and_no_path_is_ever_stored() {
        let dir = tempfile::tempdir().unwrap();
        {
            let store = crate::store::Store::open(dir.path()).unwrap();
            let memory = RecentMemory::default();
            record(&store, &memory, item(RecentKind::File, "/p/a-9c2e.md", 1)).unwrap();
            record(&store, &memory, item(RecentKind::Setting, "ollama.key", 2)).unwrap();
            record(&store, &memory, item(RecentKind::Folder, "/p/acme-9c2e", 3)).unwrap();
            record(&store, &memory, item(RecentKind::Workspace, "clients/acme-9c2e", 4)).unwrap();
            record(&store, &memory, item(RecentKind::Task, "t", 5)).unwrap();
            // This run shows all five, newest first.
            let keys: Vec<String> = merged(stored(&store), memory.list()).into_iter().map(|i| i.key).collect();
            assert_eq!(keys, ["t", "clients/acme-9c2e", "/p/acme-9c2e", "ollama.key", "/p/a-9c2e.md"]);
            let on_disk = crate::system::get_setting(&store.conn(), store.org_id(), RECENT_KEY).unwrap().to_string();
            assert!(!on_disk.contains("9c2e"), "ADR 0007: no path in the store: {on_disk}");
        }
        // A relaunch: a new connection, and nothing remembered.
        let store = crate::store::Store::open(dir.path()).unwrap();
        assert_eq!(merged(stored(&store), RecentMemory::default().list()), [item(RecentKind::Task, "t", 5), item(RecentKind::Setting, "ollama.key", 2)]);
        crate::system::put_setting(&store.conn(), store.org_id(), RECENT_KEY, &json!("not a list")).unwrap();
        assert_eq!(stored(&store), []);
        record(&store, &RecentMemory::default(), item(RecentKind::Task, "t", 6)).unwrap();
        assert_eq!(stored(&store), [item(RecentKind::Task, "t", 6)]);
    }

    #[test]
    fn the_stored_and_the_remembered_merge_newest_first_within_the_cap() {
        let stored: Vec<RecentItem> = (0..15).map(|n| item(RecentKind::Task, &format!("t{n}"), 100 + n)).collect();
        let remembered: Vec<RecentItem> = (0..15).map(|n| item(RecentKind::File, &format!("/p/f{n}"), 2 * n)).collect();
        let all = merged(stored, remembered);
        assert_eq!(all.len(), RECENT_CAP);
        assert!(all.windows(2).all(|w| w[0].at >= w[1].at));
        assert_eq!(all[0].key, "t14");
        assert_eq!(all.last().unwrap().key, "/p/f10", "15 tasks, then the five newest files: at 28 down to 20");
    }
}
