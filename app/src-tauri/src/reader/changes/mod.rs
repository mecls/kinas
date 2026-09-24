//! Tree changes (`tasks/tree-changes/prd.md`): what changed on disk under a file tree since the tree was first shown,
//! as A, M and D marks. One record per watched root, in memory only: nothing here is stored, and nothing here logs a
//! path or a byte of a file (rule 26, ADR 0007).
//!
//! The watch is recursive on the root's real path. Its callback only filters names and sends on a channel; a named
//! thread debounces the events into bursts and applies each one, touching the disk with no guard held and taking the
//! state's guard only to update the marks (ADR 0005).
//!
//! Slice 1 (the tracer bullet): there is no baseline yet, so a burst marks every listable file it names M. Slice 2
//! compares each path against the baseline instead.

pub mod compare;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::access::Kind;
use super::{checked, listable_file, off_main, ReaderError, ReaderState};

/// Emitted with a root's whole summary after every burst that names something the tree lists.
pub const TREE_CHANGED: &str = "tree_changed";
/// The reader's live reload waits the same (`watch.rs`): an editor's save is several events in a few milliseconds.
pub const DEBOUNCE: Duration = Duration::from_millis(75);
/// A burst that never goes quiet — an agent appending to a log every 50 ms — is still handed over this often, so it
/// cannot hold back a mark elsewhere past rule 7's second.
pub const BURST_CEILING: Duration = Duration::from_millis(500);

pub type Millis = i64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
// Slice 1's stub only ever marks M; the baseline (slice 2) is what can tell an addition or a deletion.
#[allow(dead_code)]
pub enum Mark {
    #[serde(rename = "A")]
    Added,
    #[serde(rename = "M")]
    Modified,
    #[serde(rename = "D")]
    Deleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ChangeEntry {
    pub path: String,
    pub kind: Kind,
    pub mark: Mark,
}

/// One root's whole summary: the answer to a watch and the payload of every `tree_changed`. Whole, not a delta, so a
/// missed event can never leave a tree wrong until the next refresh.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TreeChanges {
    /// The root's real path: the webview keys its trees by it.
    pub root: String,
    /// The baseline moment, the "since" of every caption and tooltip.
    pub since_ms: Millis,
    /// False when the watch could not start: the tree works as today, without marks.
    pub watching: bool,
    /// Changed entries under the root.
    pub total: u32,
    pub entries: Vec<ChangeEntry>,
    /// Folders whose direct children this burst named, so an expanded one can re-list.
    pub touched: Vec<String>,
}

struct Record {
    root: PathBuf,
    since_ms: Millis,
    watching: bool,
    marks: BTreeMap<PathBuf, (Kind, Mark)>,
    /// Held only to keep the watch alive. Dropping the record drops it, and with it the channel's sender, which ends
    /// the burst thread.
    #[allow(dead_code)]
    watcher: Option<RecommendedWatcher>,
}

impl Record {
    fn new(root: PathBuf, since_ms: Millis) -> Self {
        Record { root, since_ms, watching: true, marks: BTreeMap::new(), watcher: None }
    }
}

#[derive(Default)]
pub struct Changes {
    roots: HashMap<PathBuf, Record>,
}

#[derive(Default)]
pub struct ChangesState(Mutex<Changes>);

impl ChangesState {
    fn lock(&self) -> MutexGuard<'_, Changes> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

fn summary(record: &Record, touched: Vec<PathBuf>) -> TreeChanges {
    TreeChanges {
        root: record.root.display().to_string(),
        since_ms: record.since_ms,
        watching: record.watching,
        total: u32::try_from(record.marks.len()).unwrap_or(u32::MAX),
        entries: record.marks.iter().map(|(path, &(kind, mark))| ChangeEntry { path: path.display().to_string(), kind, mark }).collect(),
        touched: touched.iter().map(|p| p.display().to_string()).collect(),
    }
}

/// Starts following a folder's tree, or answers with the record it already has: the first showing is the baseline
/// (rule 1), so a second tree on the same root — the sidebar's and a pin's — shares the first one's marks and time.
#[tauri::command]
pub async fn tree_changes_watch(app: AppHandle, root: String) -> Result<TreeChanges, ReaderError> {
    off_main(move || {
        let projects = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
        let (real, kind) = checked(&app.state::<ReaderState>(), &projects, &root)?;
        if kind != Kind::Dir {
            return Err(ReaderError::new("not_dir", format!("Not a folder: {}", real.display())));
        }
        let state = app.state::<ChangesState>();
        let first = {
            let mut changes = state.lock();
            if let Some(record) = changes.roots.get(&real) {
                return Ok(summary(record, Vec::new()));
            }
            // In before the watch starts, so a second call racing this one finds it and starts nothing.
            let record = Record::new(real.clone(), crate::store::now_ms());
            let first = summary(&record, Vec::new());
            changes.roots.insert(real.clone(), record);
            first
        };

        let burst_app = app.clone();
        let burst_root = real.clone();
        let started = start(&real, move |paths| {
            if let Some(summary) = apply_burst(&burst_app.state::<ChangesState>(), &burst_root, paths) {
                let _ = burst_app.emit(TREE_CHANGED, summary);
            }
        });

        let (answer, failed) = {
            let mut changes = state.lock();
            // Gone already: the window reloaded while the watch was starting. Its watcher drops here.
            let Some(record) = changes.roots.get_mut(&real) else {
                return Ok(first);
            };
            let failed = match started {
                Ok(watcher) => {
                    record.watcher = Some(watcher);
                    None
                }
                Err(e) => {
                    record.watching = false;
                    Some(e)
                }
            };
            (summary(record, Vec::new()), failed)
        };
        if let Some(e) = failed {
            // The kind only: notify's own message names the path.
            log::warn!("tree changes: could not watch a folder ({})", error_kind(&e));
        }
        Ok(answer)
    })
    .await
}

/// The recursive watch and its burst thread. The callback does no disk work (rule 28): it drops what the tree could
/// never list — `.git`, `node_modules`, a build folder — so a build streaming into `target/` never delays a burst.
fn start(root: &Path, on_burst: impl FnMut(BTreeSet<PathBuf>) + Send + 'static) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let filter_root = root.to_path_buf();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            for path in event.paths {
                if compare::listable_path(&filter_root, &path) {
                    let _ = tx.send(path);
                }
            }
        }
    })?;
    watcher.watch(root, RecursiveMode::Recursive)?;
    std::thread::Builder::new()
        .name("tree-changes-burst".into())
        .spawn(move || debounce_paths(&rx, DEBOUNCE, BURST_CEILING, on_burst))
        .map_err(notify::Error::io)?;
    Ok(watcher)
}

fn error_kind(e: &notify::Error) -> &'static str {
    match e.kind {
        notify::ErrorKind::Generic(_) => "generic",
        notify::ErrorKind::Io(_) => "io",
        notify::ErrorKind::PathNotFound => "path not found",
        notify::ErrorKind::WatchNotFound => "watch not found",
        notify::ErrorKind::InvalidConfig(_) => "invalid config",
        notify::ErrorKind::MaxFilesWatch => "watch limit",
    }
}

/// One burst for one root. Returns the summary to emit, or None when the root is no longer watched or nothing in the
/// burst is something the tree lists.
///
/// Slice 1's stub: every listable file the burst names is marked M.
fn apply_burst(state: &ChangesState, root: &Path, paths: BTreeSet<PathBuf>) -> Option<TreeChanges> {
    let listable: Vec<PathBuf> = paths.into_iter().filter(|p| compare::listable_path(root, p)).collect();
    if listable.is_empty() {
        return None;
    }
    // The disk first, with no guard held. A symlink is not followed: a link leading out of the root never marks (rule 6).
    let files: Vec<&PathBuf> = listable.iter().filter(|p| std::fs::symlink_metadata(p).is_ok_and(|m| m.is_file()) && listable_file(p)).collect();
    let touched: BTreeSet<PathBuf> = listable.iter().filter_map(|p| p.parent().map(Path::to_path_buf)).collect();

    let mut changes = state.lock();
    let record = changes.roots.get_mut(root)?;
    for file in files {
        record.marks.insert(file.clone(), (Kind::File, Mark::Modified));
    }
    Some(summary(record, touched.into_iter().collect()))
}

/// Collects paths until `quiet` passes with none, then hands the set over — or sooner, once the burst has been open
/// for `ceiling`. Returns when the sender is gone.
pub fn debounce_paths(rx: &Receiver<PathBuf>, quiet: Duration, ceiling: Duration, mut fire: impl FnMut(BTreeSet<PathBuf>)) {
    while let Ok(first) = rx.recv() {
        let opened = Instant::now();
        let mut burst = BTreeSet::from([first]);
        loop {
            let left = ceiling.saturating_sub(opened.elapsed());
            if left.is_zero() {
                break;
            }
            match rx.recv_timeout(quiet.min(left)) {
                Ok(path) => {
                    burst.insert(path);
                }
                Err(_) => break,
            }
        }
        fire(burst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread::sleep;

    type Fired = Arc<Mutex<Vec<BTreeSet<PathBuf>>>>;

    fn collector() -> (Fired, impl FnMut(BTreeSet<PathBuf>) + Send + 'static) {
        let fired = Arc::new(Mutex::new(Vec::new()));
        let sink = fired.clone();
        (fired, move |set| sink.lock().unwrap().push(set))
    }

    #[test]
    fn debounce_paths_collects_a_burst_into_one_set() {
        let (tx, rx) = mpsc::channel();
        let (fired, fire) = collector();
        let thread = std::thread::spawn(move || debounce_paths(&rx, Duration::from_millis(75), Duration::from_secs(5), fire));

        for name in ["a.md", "b.md", "c.md", "a.md"] {
            tx.send(PathBuf::from(name)).unwrap();
            sleep(Duration::from_millis(20));
        }
        sleep(Duration::from_millis(250));
        assert_eq!(*fired.lock().unwrap(), vec![BTreeSet::from(["a.md", "b.md", "c.md"].map(PathBuf::from))]);

        tx.send(PathBuf::from("d.md")).unwrap();
        sleep(Duration::from_millis(250));
        assert_eq!(fired.lock().unwrap().len(), 2);
        assert_eq!(fired.lock().unwrap()[1], BTreeSet::from([PathBuf::from("d.md")]));

        drop(tx);
        thread.join().unwrap();
    }

    #[test]
    fn a_stream_that_never_goes_quiet_is_handed_over_at_the_ceiling() {
        let (tx, rx) = mpsc::channel();
        let (fired, fire) = collector();
        let thread = std::thread::spawn(move || debounce_paths(&rx, Duration::from_millis(75), Duration::from_millis(150), fire));

        // One event every 20 ms for 600 ms: never 75 ms quiet, so only the ceiling can hand a burst over.
        let stream_ends = Instant::now() + Duration::from_millis(600);
        let mut sent = BTreeSet::new();
        let mut n = 0;
        while Instant::now() < stream_ends {
            let path = PathBuf::from(format!("log-{n}.md"));
            tx.send(path.clone()).unwrap();
            sent.insert(path);
            n += 1;
            sleep(Duration::from_millis(20));
        }
        let during = fired.lock().unwrap().len();
        drop(tx);
        thread.join().unwrap();

        assert!(during >= 2, "{during} bursts handed over while the stream ran; the ceiling allows none to wait past 150 ms");
        let delivered: BTreeSet<PathBuf> = fired.lock().unwrap().iter().flatten().cloned().collect();
        assert_eq!(delivered, sent, "every path arrives in exactly one burst or another");
    }

    fn watched(root: &Path) -> ChangesState {
        let state = ChangesState::default();
        state.lock().roots.insert(root.to_path_buf(), Record::new(root.to_path_buf(), 1_000));
        state
    }

    #[test]
    fn hidden_names_and_skipped_folders_never_mark() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for folder in [".git", "node_modules", "docs"] {
            std::fs::create_dir(root.join(folder)).unwrap();
        }
        let files = [
            (".git/index", b"DIRC".as_slice()),
            ("node_modules/x.md", b"# x".as_slice()),
            (".hidden.md", b"# hidden".as_slice()),
            ("docs/photo.bin", b"\x00\x01\x02\x03".as_slice()),
        ];
        for (name, bytes) in files {
            std::fs::write(root.join(name), bytes).unwrap();
        }

        let state = watched(&root);
        let burst: BTreeSet<PathBuf> = files.iter().map(|(name, _)| root.join(name)).collect();
        let answer = apply_burst(&state, &root, burst);
        let (total, entries) = answer.map(|s| (s.total, s.entries)).unwrap_or_default();
        assert_eq!((total, entries), (0, vec![]));
    }

    #[test]
    fn a_saved_file_is_marked_and_the_whole_summary_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir(root.join("docs")).unwrap();
        std::fs::write(root.join("docs/overview.md"), "# Overview\n").unwrap();

        let state = watched(&root);
        let answer = apply_burst(&state, &root, BTreeSet::from([root.join("docs/overview.md")])).expect("a summary to emit");
        assert_eq!(answer.root, root.display().to_string());
        assert_eq!(answer.since_ms, 1_000);
        assert!(answer.watching);
        assert_eq!(answer.total, 1);
        assert_eq!(answer.entries, vec![ChangeEntry { path: root.join("docs/overview.md").display().to_string(), kind: Kind::File, mark: Mark::Modified }]);
        assert_eq!(answer.touched, vec![root.join("docs").display().to_string()]);
        assert_eq!(serde_json::to_value(&answer.entries[0]).unwrap()["mark"], "M");

        // A root no longer watched answers nothing, so nothing is emitted for it.
        assert_eq!(apply_burst(&ChangesState::default(), &root, BTreeSet::from([root.join("docs/overview.md")])), None);
    }

    #[test]
    fn a_save_under_a_watched_root_reaches_a_burst_and_a_write_in_git_does_not() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("docs")).unwrap();
        let (tx, rx) = mpsc::channel();
        let watcher = start(&root, move |set| {
            let _ = tx.send(set);
        })
        .expect("FSEvents watches a temp folder");

        // FSEvents can take a moment to begin delivering; the ceiling is generous, the assertion exact.
        sleep(Duration::from_millis(200));
        std::fs::write(root.join(".git/index"), "DIRC").unwrap();
        std::fs::write(root.join("docs/note.md"), "# Note\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut seen = BTreeSet::new();
        while Instant::now() < deadline && !seen.contains(&root.join("docs/note.md")) {
            if let Ok(set) = rx.recv_timeout(Duration::from_millis(100)) {
                seen.extend(set);
            }
        }
        drop(watcher);
        assert!(seen.contains(&root.join("docs/note.md")), "the save arrived: {seen:?}");
        assert!(seen.iter().all(|p| !p.starts_with(root.join(".git"))), "nothing under .git arrived: {seen:?}");
    }
}
