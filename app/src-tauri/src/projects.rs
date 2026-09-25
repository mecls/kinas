//! The sidebar's client folders (DESIGN.md §3.1; design-system slice 3): the git repositories under the projects
//! root, found as the context packet finds them (`packages/context/src/sources/projects.ts`) — a `.git` entry up to
//! three levels down, dot folders and build folders skipped — and named the same way: the folder's name, or its path
//! from the root when two share one. Both are held to `fixtures/projects-discovery.json`.
//!
//! Each folder carries what Settings keeps for it: a category (1–6, the six `--cat-N` colours; `None` means the
//! webview derives one from the name) and whether it is internal. Both live in the settings table as one row each,
//! keyed by the folder's name, so nothing here needs a migration.
//!
//! Folder views (2026-09-23, `tasks/folder-views/prd.md`): a folder may also be **hidden** (off the sidebar and Home)
//! or **removed** (off Settings' list too, restorable), and a folder the walk does not find may be **added** — any
//! folder inside the projects folder, git or not. Those three are settings rows too, but keyed by **path**: the walk
//! renames a folder when a second one with its base name appears (`site` becomes `one/site`), and a removal keyed on
//! the old name would silently undo itself. Nothing here ever touches a folder on disk.

use crate::store::Store;
use crate::system::{get_setting, put_setting};
use crate::reader::access::{self, Kind};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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
/// Folder views: `["<canonical path>", …]`, sorted, one row each.
pub const HIDDEN_KEY: &str = "folder_hidden";
pub const REMOVED_KEY: &str = "folder_removed";
pub const ADDED_KEY: &str = "folder_added";
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
    /// Off the sidebar and Home; still in Settings' list.
    pub hidden: bool,
    /// Off Settings' list too, in its Removed list. A path in both lists reads as removed.
    pub removed: bool,
    /// The folder's GitHub `origin` as `owner/name`, lower-cased, from its git config (the first mate's lanes, PRD rule
    /// 18); None without one.
    pub repo: Option<String>,
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
pub(crate) fn display_of(path: &Path, home: &Path) -> String {
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

/// One of the three folder-view lists: the strings in the row, anything else ignored, as `stored_internal` does.
pub fn stored_paths(value: Option<serde_json::Value>) -> BTreeSet<String> {
    stored_internal(value).into_iter().collect()
}

/// Every folder the listing holds: each discovered repository, and each added folder that is still a folder inside
/// the root and not the root itself — once each, sorted. An added folder that is gone (an unmounted volume, a changed
/// root) is simply not listed; its row is kept, so it comes back when the folder does.
pub fn listing(root: &Path, repos: &[PathBuf], added: &BTreeSet<String>) -> Vec<PathBuf> {
    let mut all: BTreeSet<PathBuf> = repos.iter().cloned().collect();
    for path in added.iter().map(PathBuf::from) {
        if path != root && access::inside(&path, root) && path.is_dir() {
            all.insert(path);
        }
    }
    all.into_iter().collect()
}

/// The rows with each folder's view state, by path.
pub fn with_views(mut rows: Vec<ProjectRow>, hidden: &BTreeSet<String>, removed: &BTreeSet<String>) -> Vec<ProjectRow> {
    for row in &mut rows {
        row.hidden = hidden.contains(&row.path);
        row.removed = removed.contains(&row.path);
    }
    rows
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
            hidden: false,
            removed: false,
            display: display_of(path, home),
            repo: crate::crew::repo::origin_repo(path),
            path: path.display().to_string(),
            name,
        })
        .collect()
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// What Settings keeps about the folders, read in one go.
struct Stored {
    categories: BTreeMap<String, u8>,
    internal: Vec<String>,
    hidden: BTreeSet<String>,
    removed: BTreeSet<String>,
    added: BTreeSet<String>,
}

fn stored(store: &Store) -> Stored {
    let conn = store.conn();
    let org = store.org_id();
    Stored {
        categories: stored_categories(get_setting(&conn, org, CATEGORIES_KEY)),
        internal: stored_internal(get_setting(&conn, org, INTERNAL_KEY)),
        hidden: stored_paths(get_setting(&conn, org, HIDDEN_KEY)),
        removed: stored_paths(get_setting(&conn, org, REMOVED_KEY)),
        added: stored_paths(get_setting(&conn, org, ADDED_KEY)),
    }
}

fn put_paths(store: &Store, key: &str, paths: &BTreeSet<String>) -> Result<(), String> {
    let conn = store.conn();
    put_setting(&conn, store.org_id(), key, &serde_json::json!(paths)).map_err(|e| e.to_string())
}

/// The listing as it stands: the root's real path, every folder in it, and what Settings keeps. Blocking — it may walk
/// the root — so only ever called off the main thread.
struct Snapshot {
    root: PathBuf,
    folders: Vec<PathBuf>,
    stored: Stored,
}

fn snapshot(app: &AppHandle) -> Snapshot {
    let store = app.state::<Store>();
    // The real path, as the reader reports every folder it opens (reader/access.rs): a root reached through a symlink
    // (/var is /private/var) must list paths the reader's own can be compared with. Read before any other store lock
    // is taken: the store's mutex is not reentrant (ADR 0005).
    let root = access::real_root(&crate::paths::projects_root_of(&store));
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
    let stored = stored(&store);
    let folders = listing(&root, &repos, &stored.added);
    Snapshot { root, folders, stored }
}

/// A path the webview names must be one this listing holds (ADR 0009): the webview never writes a path Rust did not
/// list.
fn listed(snap: &Snapshot, path: &str) -> Result<(), String> {
    if snap.folders.iter().any(|f| f.as_os_str() == path) {
        Ok(())
    } else {
        Err("Not a client folder".to_string())
    }
}

/// The client folders for the sidebar, Home and Settings — hidden and removed ones included, flagged, because the
/// colours are seated over all of them and each surface filters afterwards (prd rule 8). The walk runs off the main
/// thread (a root on a slow disk must not freeze the window — the reader learned this on its first install) and
/// stands for a minute; the choices are read fresh each time, so a change in Settings shows on the next call.
#[tauri::command]
pub async fn list_projects(app: AppHandle) -> Result<Vec<ProjectRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let snap = snapshot(&app);
        let rows = rows(&snap.root, &home(), &snap.folders, &snap.stored.categories, &snap.stored.internal);
        Ok(with_views(rows, &snap.stored.hidden, &snap.stored.removed))
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

/// The sidebar's Hide from sidebar and Show, and Settings' In sidebar switch: one folder off or back on the sidebar
/// and Home, by path. Async, because checking the path against the listing may walk the root.
#[tauri::command]
pub async fn set_folder_hidden(app: AppHandle, path: String, hidden: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let snap = snapshot(&app);
        listed(&snap, &path)?;
        let mut list = snap.stored.hidden;
        if hidden {
            list.insert(path);
        } else {
            list.remove(&path);
        }
        put_paths(&app.state::<Store>(), HIDDEN_KEY, &list)
    })
    .await
    .map_err(|e| format!("the folder was not changed: {e}"))?
}

/// Settings' Remove and Restore, by path. Restore also clears the folder from the hidden list: a folder that came back
/// hidden would look as if Restore had done nothing (prd rule 6). Nothing on disk is touched.
#[tauri::command]
pub async fn set_folder_removed(app: AppHandle, path: String, removed: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let snap = snapshot(&app);
        listed(&snap, &path)?;
        let store = app.state::<Store>();
        let mut list = snap.stored.removed;
        if removed {
            list.insert(path);
            return put_paths(&store, REMOVED_KEY, &list);
        }
        list.remove(&path);
        let mut hidden = snap.stored.hidden;
        hidden.remove(&path);
        put_paths(&store, REMOVED_KEY, &list)?;
        put_paths(&store, HIDDEN_KEY, &hidden)
    })
    .await
    .map_err(|e| format!("the folder was not changed: {e}"))?
}

/// What Add a client folder… did. `name` is the folder as the listing names it now.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "lowercase")]
pub enum AddOutcome {
    Cancelled,
    Added { name: String },
    Shown { name: String },
    Restored { name: String },
    Already { name: String },
}

/// What a pick does, before anything is written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddDecision {
    /// Not listed: it joins the added list.
    Add,
    /// Listed and hidden: it comes back on the sidebar.
    Show,
    /// Listed and removed: restored, and shown.
    Restore,
    /// Listed and shown already: nothing changes.
    Already,
}

/// A picked folder that is listed changes state instead of being listed twice (prd rule 10).
pub fn decide(real: &Path, folders: &[PathBuf], hidden: &BTreeSet<String>, removed: &BTreeSet<String>) -> AddDecision {
    if !folders.iter().any(|f| f == real) {
        return AddDecision::Add;
    }
    let key = real.to_string_lossy();
    if removed.contains(key.as_ref()) {
        AddDecision::Restore
    } else if hidden.contains(key.as_ref()) {
        AddDecision::Show
    } else {
        AddDecision::Already
    }
}

/// A pick may be any folder inside the projects folder, but not the folder itself (prd rule 9). `real` and `root` are
/// canonical. The words are what the webview says.
pub fn check_pick(real: &Path, kind: Kind, root: &Path, home: &Path) -> Result<(), String> {
    if kind != Kind::Dir {
        return Err("Choose a folder".to_string());
    }
    if real == root {
        return Err("That is the projects folder itself — choose a folder inside it".to_string());
    }
    if !access::inside(real, root) {
        return Err(format!("Choose a folder inside the projects folder ({})", display_of(root, home)));
    }
    Ok(())
}

/// One folder window at a time: a second request while the first is up is refused, not stacked. Released when the
/// command ends however it ends.
static PICKING: AtomicBool = AtomicBool::new(false);

struct Picking;

impl Picking {
    fn take() -> Result<Self, String> {
        PICKING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).map(|_| Picking).map_err(|_| "The folder window is already open".to_string())
    }
}

impl Drop for Picking {
    fn drop(&mut self) {
        PICKING.store(false, Ordering::Release);
    }
}

/// Asks Miguel which folder, in the projects folder. `None` is Cancel. The only function here that knows a dialog
/// plugin exists; the webview has no dialog permission, so `capabilities/` is unchanged.
async fn choose_folder(app: &AppHandle, window: &tauri::WebviewWindow, root: &Path) -> Result<Option<PathBuf>, String> {
    // Debug builds only: no agent can click a native sheet, so e2e writes the pick into the file this names — empty
    // for Cancel — and can change it between cases. Every rule after the sheet still runs on it.
    #[cfg(debug_assertions)]
    if let Some(file) = std::env::var_os("KINAS_E2E_PICK_FOLDER") {
        let pick = std::fs::read_to_string(file).unwrap_or_default();
        let pick = pick.trim();
        return Ok((!pick.is_empty()).then(|| PathBuf::from(pick)));
    }
    use tauri_plugin_dialog::DialogExt;
    let dialog = app.dialog().file().set_parent(window).set_title("Add a client folder").set_directory(root).set_can_create_directories(true);
    // The plugin runs the sheet on the main thread itself and this waits on a worker, as reader/export.rs does.
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder()).await.map_err(|e| format!("the folder window did not finish: {e}"))?;
    Ok(picked.and_then(|p| p.into_path().ok()))
}

/// Add a client folder…, from the sidebar's menu and from Settings: a folder window in the projects folder, then the
/// pick checked, decided and written. Logs the outcome and the time, never the path or the name (ADR 0007).
#[tauri::command]
pub async fn add_client_folder(app: AppHandle, window: tauri::WebviewWindow) -> Result<AddOutcome, String> {
    let _picking = Picking::take()?;
    let root = {
        let store = app.state::<Store>();
        access::real_root(&crate::paths::projects_root_of(&store))
    };
    let Some(pick) = choose_folder(&app, &window, &root).await? else {
        return Ok(AddOutcome::Cancelled);
    };
    let started = Instant::now();
    let outcome = tauri::async_runtime::spawn_blocking(move || -> Result<AddOutcome, String> {
        let (real, kind) = access::resolve(&pick).map_err(|_| "Choose a folder".to_string())?;
        check_pick(&real, kind, &root, &home())?;
        let snap = snapshot(&app);
        let store = app.state::<Store>();
        let key = real.to_string_lossy().into_owned();
        let decision = decide(&real, &snap.folders, &snap.stored.hidden, &snap.stored.removed);
        let (mut hidden, mut removed, mut added) = (snap.stored.hidden, snap.stored.removed, snap.stored.added);
        match decision {
            AddDecision::Add => {
                added.insert(key.clone());
                put_paths(&store, ADDED_KEY, &added)?;
            }
            AddDecision::Show => {
                hidden.remove(&key);
                put_paths(&store, HIDDEN_KEY, &hidden)?;
            }
            AddDecision::Restore => {
                removed.remove(&key);
                hidden.remove(&key);
                put_paths(&store, REMOVED_KEY, &removed)?;
                put_paths(&store, HIDDEN_KEY, &hidden)?;
            }
            AddDecision::Already => {}
        }
        // Named as the listing names it now: an added `site` beside a discovered `site` is `<parent>/site`.
        let folders = listing(&snap.root, &snap.folders, &added);
        let name = folders.iter().position(|f| *f == real).and_then(|i| names_for(&snap.root, &folders).into_iter().nth(i)).unwrap_or_else(|| base(&real));
        Ok(match decision {
            AddDecision::Add => AddOutcome::Added { name },
            AddDecision::Show => AddOutcome::Shown { name },
            AddDecision::Restore => AddOutcome::Restored { name },
            AddDecision::Already => AddOutcome::Already { name },
        })
    })
    .await
    .map_err(|e| format!("the folder was not added: {e}"))??;
    let word = match &outcome {
        AddOutcome::Cancelled => "cancelled",
        AddOutcome::Added { .. } => "added",
        AddOutcome::Shown { .. } => "shown",
        AddOutcome::Restored { .. } => "restored",
        AddOutcome::Already { .. } => "already listed",
    };
    log::info!("projects: client folder {word} in {} ms", started.elapsed().as_millis());
    Ok(outcome)
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
    fn a_root_reached_through_a_symlink_lists_the_real_paths_the_reader_reports() {
        let dir = tempfile::tempdir().unwrap();
        plant(dir.path(), &["acme/.git".to_string()]);
        let real = fs::canonicalize(dir.path()).unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let link = elsewhere.path().join("root");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert_eq!(discover_repos(&link, MAX_DEPTH), vec![link.join("acme")]);
        assert_eq!(discover_repos(&crate::reader::access::real_root(&link), MAX_DEPTH), vec![real.join("acme")]);
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

    fn set(paths: &[&Path]) -> BTreeSet<String> {
        paths.iter().map(|p| p.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn a_folder_hidden_or_removed_is_flagged_by_path_and_removed_wins_over_hidden() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        plant(&root, &["acme/.git".to_string(), "hub/.git".to_string(), "app/.git".to_string()]);
        let repos = discover_repos(&root, MAX_DEPTH);
        let hidden = set(&[&root.join("acme"), &root.join("hub")]);
        let removed = set(&[&root.join("hub")]);
        let rows = with_views(rows(&root, &root, &repos, &BTreeMap::new(), &[]), &hidden, &removed);
        let state = |name: &str| rows.iter().find(|r| r.name == name).map(|r| (r.hidden, r.removed)).unwrap();
        assert_eq!(state("acme"), (true, false));
        // In both lists, Settings shows it under Removed: the webview reads `removed` first.
        assert_eq!(state("hub"), (true, true));
        assert_eq!(state("app"), (false, false));
        assert_eq!(stored_paths(Some(serde_json::json!(["/a", 3, null, "/b"]))), BTreeSet::from(["/a".to_string(), "/b".to_string()]));
        assert!(stored_paths(Some(serde_json::json!({ "/a": true }))).is_empty());
    }

    #[test]
    fn an_added_folder_is_listed_once_while_it_exists_inside_the_root_and_named_beside_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        plant(&root, &["one/site/.git".to_string(), "acme/.git".to_string()]);
        let deep = root.join("a/b/c/d/plain");
        fs::create_dir_all(&deep).unwrap();
        fs::create_dir_all(root.join("two/site")).unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside = fs::canonicalize(outside.path()).unwrap();
        let repos = discover_repos(&root, MAX_DEPTH);
        let added = set(&[&deep, &root.join("acme"), &root.join("gone"), &outside, &root, &root.join("two/site")]);
        let folders = listing(&root, &repos, &added);
        // Five levels down and no .git: listed. Already discovered: once. Gone, outside, the root itself: not listed.
        let relative: Vec<String> = folders.iter().map(|f| f.strip_prefix(&root).unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(relative, ["a/b/c/d/plain", "acme", "one/site", "two/site"]);
        // An added `site` beside a discovered `site`: both named by their path, as two discovered ones are.
        assert_eq!(names_for(&root, &folders), ["plain", "acme", "one/site", "two/site"]);
        // The gone folder's row is not pruned by listing: it is still in `added` for when it comes back.
        assert!(added.contains(root.join("gone").to_string_lossy().as_ref()));
    }

    #[test]
    fn a_pick_that_is_listed_changes_its_state_instead_of_listing_it_twice() {
        let root = PathBuf::from("/r");
        let folders = vec![root.join("acme"), root.join("hub"), root.join("app")];
        let hidden = set(&[&root.join("acme"), &root.join("hub")]);
        let removed = set(&[&root.join("hub")]);
        assert_eq!(decide(&root.join("acme"), &folders, &hidden, &removed), AddDecision::Show);
        assert_eq!(decide(&root.join("hub"), &folders, &hidden, &removed), AddDecision::Restore);
        assert_eq!(decide(&root.join("app"), &folders, &hidden, &removed), AddDecision::Already);
        assert_eq!(decide(&root.join("new"), &folders, &hidden, &removed), AddDecision::Add);
    }

    #[test]
    fn a_pick_must_be_a_folder_inside_the_projects_folder_and_not_the_folder_itself() {
        let home = Path::new("/Users/me");
        let root = Path::new("/Users/me/Projects");
        assert_eq!(check_pick(&root.join("acme"), Kind::Dir, root, home), Ok(()));
        assert_eq!(check_pick(&root.join("a/b/c/d"), Kind::Dir, root, home), Ok(()));
        assert_eq!(check_pick(&root.join("notes.md"), Kind::File, root, home), Err("Choose a folder".to_string()));
        assert_eq!(check_pick(root, Kind::Dir, root, home), Err("That is the projects folder itself — choose a folder inside it".to_string()));
        assert_eq!(check_pick(Path::new("/Users/me"), Kind::Dir, root, home), Err("Choose a folder inside the projects folder (~/Projects)".to_string()));
        // A sibling that shares the root's name as a prefix is outside it.
        assert_eq!(check_pick(Path::new("/Users/me/Projects-old/x"), Kind::Dir, root, home), Err("Choose a folder inside the projects folder (~/Projects)".to_string()));
    }

    #[test]
    fn one_folder_window_at_a_time_and_the_next_may_open_once_it_closes() {
        let first = Picking::take().unwrap();
        assert_eq!(Picking::take().err(), Some("The folder window is already open".to_string()));
        drop(first);
        assert!(Picking::take().is_ok());
    }

    #[test]
    fn the_outcome_reaches_the_webview_tagged() {
        assert_eq!(serde_json::to_value(AddOutcome::Added { name: "plain".into() }).unwrap(), serde_json::json!({ "outcome": "added", "name": "plain" }));
        assert_eq!(serde_json::to_value(AddOutcome::Cancelled).unwrap(), serde_json::json!({ "outcome": "cancelled" }));
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
