//! The sidebar's client folders (DESIGN.md §3.1; design-system slice 3): the git repositories under the projects
//! root, found as the context packet finds them (`packages/context/src/sources/projects.ts`) — a `.git` entry up to
//! three levels down, dot folders and build folders skipped — and named the same way: the folder's name, or its path
//! from the root when two share one. Both are held to `fixtures/projects-discovery.json`.
//!
//! Each folder carries what Settings keeps for it: a category (1–6, the six `--cat-N` colours; `None` means the
//! webview derives one from the name) and whether it is internal. Both live in the settings table as one row each,
//! keyed by the folder's name, so nothing here needs a migration.

use crate::store::Store;
use crate::system::{get_setting, put_setting};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

/// The folders discovery never enters, exactly the packet's list.
pub const SKIP_DIRS: [&str; 6] = ["node_modules", "target", "dist", "build", "vendor", "Library"];
/// How far below the root a repository may sit, exactly the packet's depth.
pub const MAX_DEPTH: usize = 3;
/// The six category colours (tokens.css `--cat-1` … `--cat-6`).
pub const CATEGORIES: u8 = 6;
/// The settings rows: `{ "<name>": 1..6 }`, and `["<name>", …]`.
pub const CATEGORIES_KEY: &str = "folder_categories";
pub const INTERNAL_KEY: &str = "folder_internal";
/// How long a walk of the root stands. The sidebar asks again on every focus; a walk costs milliseconds but reads
/// every folder three levels down, and the answer rarely changes within a minute.
const CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ProjectRow {
    pub name: String,
    pub path: String,
    /// The path as the sidebar shows it on hover: `~/…` under the home folder, absolute otherwise.
    pub display: String,
    /// Settings' choice, or `None` for the one the webview derives from the name.
    pub category: Option<u8>,
    pub internal: bool,
}

/// The last walk, kept for `CACHE_TTL` — for one root: a changed projects root walks again at once.
#[derive(Default)]
pub struct ProjectsCache(Mutex<Option<(Instant, PathBuf, Vec<PathBuf>)>>);

/// Folders with a `.git` entry (a repository, or a worktree's file), up to `max_depth` levels below the root, sorted.
pub fn discover_repos(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    walk(root, 0, max_depth, &mut found);
    found.sort();
    found
}

fn walk(dir: &Path, depth: usize, max_depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".git" {
            found.push(dir.to_path_buf());
            continue;
        }
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref()) {
            continue;
        }
        if entry.file_type().is_ok_and(|t| t.is_dir()) {
            dirs.push(entry.path());
        }
    }
    if depth >= max_depth {
        return;
    }
    for sub in dirs {
        walk(&sub, depth + 1, max_depth, found);
    }
}

fn base(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

/// What each repository is called: its folder name, or its path from the root when two share one.
pub fn names_for(root: &Path, repos: &[PathBuf]) -> Vec<String> {
    let mut by_base: BTreeMap<String, usize> = BTreeMap::new();
    for r in repos {
        *by_base.entry(base(r)).or_default() += 1;
    }
    repos
        .iter()
        .map(|r| {
            if by_base.get(&base(r)).copied().unwrap_or(0) > 1 {
                r.strip_prefix(root).ok().filter(|rel| !rel.as_os_str().is_empty()).map(|rel| rel.to_string_lossy().into_owned()).unwrap_or_else(|| base(r))
            } else {
                base(r)
            }
        })
        .collect()
}

/// `~/…` under the home folder, the path itself otherwise.
fn display_of(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rel) if !rel.as_os_str().is_empty() => format!("~/{}", rel.to_string_lossy()),
        _ => path.display().to_string(),
    }
}

/// The stored categories: a name to 1–6. Anything else in the row is ignored, never an error — a hand or an older
/// build may have written it, and the sidebar must still list the folders.
pub fn stored_categories(value: Option<serde_json::Value>) -> BTreeMap<String, u8> {
    value
        .and_then(|v| v.as_object().cloned())
        .map(|map| {
            map.into_iter()
                .filter_map(|(name, cat)| cat.as_u64().and_then(|c| u8::try_from(c).ok()).filter(|c| (1..=CATEGORIES).contains(c)).map(|c| (name, c)))
                .collect()
        })
        .unwrap_or_default()
}

/// The stored internal folders, by name.
pub fn stored_internal(value: Option<serde_json::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array().cloned())
        .map(|list| list.into_iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// A category as Settings may store it: 1 to 6.
pub fn parse_category(cat: u8) -> Result<u8, String> {
    if (1..=CATEGORIES).contains(&cat) {
        Ok(cat)
    } else {
        Err(format!("category must be 1 to {CATEGORIES}"))
    }
}

/// The rows the sidebar lists: every repository, named, with Settings' choices for it.
pub fn rows(root: &Path, home: &Path, repos: &[PathBuf], categories: &BTreeMap<String, u8>, internal: &[String]) -> Vec<ProjectRow> {
    let names = names_for(root, repos);
    repos
        .iter()
        .zip(names)
        .map(|(path, name)| ProjectRow {
            category: categories.get(&name).copied(),
            internal: internal.contains(&name),
            display: display_of(path, home),
            path: path.display().to_string(),
            name,
        })
        .collect()
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// The client folders for the sidebar and Settings. The walk runs off the main thread (a root on a slow disk must
/// not freeze the window — the reader learned this on its first install) and stands for a minute; the choices are
/// read fresh each time, so a change in Settings shows on the next call.
#[tauri::command]
pub async fn list_projects(app: AppHandle) -> Result<Vec<ProjectRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let root = crate::paths::projects_root_of(&store);
        let cache = app.state::<ProjectsCache>();
        let repos = {
            let mut slot = cache.0.lock().unwrap_or_else(|p| p.into_inner());
            match slot.as_ref() {
                Some((at, cached_root, repos)) if *cached_root == root && at.elapsed() < CACHE_TTL => repos.clone(),
                _ => {
                    let repos = discover_repos(&root, MAX_DEPTH);
                    *slot = Some((Instant::now(), root.clone(), repos.clone()));
                    repos
                }
            }
        };
        let (categories, internal) = {
            let conn = store.conn();
            let org = store.org_id();
            (stored_categories(get_setting(&conn, org, CATEGORIES_KEY)), stored_internal(get_setting(&conn, org, INTERNAL_KEY)))
        };
        Ok(rows(&root, &home(), &repos, &categories, &internal))
    })
    .await
    .map_err(|e| format!("the projects listing did not finish: {e}"))?
}

/// Settings → Client folders: the chip's colour for one folder, by name. Refused outside 1–6.
#[tauri::command]
pub fn set_folder_category(store: State<'_, Store>, name: String, cat: u8) -> Result<(), String> {
    let cat = parse_category(cat)?;
    let conn = store.conn();
    let org = store.org_id();
    let mut categories = stored_categories(get_setting(&conn, org, CATEGORIES_KEY));
    categories.insert(name, cat);
    put_setting(&conn, org, CATEGORIES_KEY, &serde_json::json!(categories)).map_err(|e| e.to_string())
}

/// Settings → Client folders: whether one folder is internal (listed last, tagged), by name.
#[tauri::command]
pub fn set_folder_internal(store: State<'_, Store>, name: String, internal: bool) -> Result<(), String> {
    let conn = store.conn();
    let org = store.org_id();
    let mut list = stored_internal(get_setting(&conn, org, INTERNAL_KEY));
    list.retain(|n| *n != name);
    if internal {
        list.push(name);
    }
    list.sort();
    put_setting(&conn, org, INTERNAL_KEY, &serde_json::json!(list)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[derive(serde::Deserialize)]
    struct Shared {
        max_depth: usize,
        skip: Vec<String>,
        tree: Vec<String>,
        repos: Vec<String>,
        names: Vec<String>,
    }

    fn shared() -> Shared {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/projects-discovery.json");
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    fn plant(root: &Path, tree: &[String]) {
        for p in tree {
            let file = root.join(p);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, if p.ends_with("/.git") { "gitdir: /elsewhere\n" } else { "ref: refs/heads/main\n" }).unwrap();
        }
    }

    #[test]
    fn discovery_and_naming_match_the_packet_through_the_shared_fixture() {
        let shared = shared();
        assert_eq!(shared.max_depth, MAX_DEPTH);
        assert_eq!(shared.skip, SKIP_DIRS);
        let dir = tempfile::tempdir().unwrap();
        plant(dir.path(), &shared.tree);
        let repos = discover_repos(dir.path(), MAX_DEPTH);
        let relative: Vec<String> = repos.iter().map(|r| r.strip_prefix(dir.path()).unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(relative, shared.repos);
        assert_eq!(names_for(dir.path(), &repos), shared.names);
    }

    #[test]
    fn a_missing_root_lists_nothing() {
        assert!(discover_repos(Path::new("/no/such/root"), MAX_DEPTH).is_empty());
    }

    #[test]
    fn rows_carry_the_choices_by_name_and_show_the_path_under_home() {
        let shared = shared();
        let dir = tempfile::tempdir().unwrap();
        plant(dir.path(), &shared.tree);
        let repos = discover_repos(dir.path(), MAX_DEPTH);
        let categories = stored_categories(Some(serde_json::json!({ "hub": 3, "acme": 9, "gone": 2, "app": "red" })));
        assert_eq!(categories, BTreeMap::from([("hub".to_string(), 3), ("gone".to_string(), 2)]));
        let internal = stored_internal(Some(serde_json::json!(["two/site", 7, "hub"])));
        assert_eq!(internal, vec!["two/site".to_string(), "hub".to_string()]);
        let rows = rows(dir.path(), dir.path(), &repos, &categories, &internal);
        let hub = rows.iter().find(|r| r.name == "hub").unwrap();
        assert_eq!((hub.category, hub.internal, hub.display.as_str()), (Some(3), true, "~/hub"));
        let acme = rows.iter().find(|r| r.name == "acme").unwrap();
        assert_eq!((acme.category, acme.internal, acme.display.as_str()), (None, false, "~/clients/acme"));
        let site = rows.iter().find(|r| r.name == "two/site").unwrap();
        assert!(site.internal);
        // A path outside the home folder shows as it is.
        assert_eq!(display_of(Path::new("/srv/x"), Path::new("/Users/me")), "/srv/x");
    }

    #[test]
    fn a_category_is_one_to_six_and_junk_rows_are_ignored() {
        assert_eq!(parse_category(1), Ok(1));
        assert_eq!(parse_category(6), Ok(6));
        assert!(parse_category(0).is_err());
        assert!(parse_category(7).is_err());
        assert!(stored_categories(Some(serde_json::json!("blue"))).is_empty());
        assert!(stored_categories(None).is_empty());
        assert!(stored_internal(Some(serde_json::json!({ "hub": true }))).is_empty());
    }
}
