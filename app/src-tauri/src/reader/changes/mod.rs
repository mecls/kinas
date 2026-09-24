//! Tree changes (`tasks/tree-changes/prd.md`): what changed on disk under a file tree since the tree was first shown,
//! as A, M and D marks. One record per watched root, in memory only: nothing here is stored, and nothing here logs a
//! path or a byte of a file (rule 26, ADR 0007).
//!
//! The watch is recursive on the root's real path. Its callback only filters names and sends on a channel; a named
//! thread debounces the events into bursts and applies each one, touching the disk with no guard held and taking the
//! state's guard only to update the marks (ADR 0005). A second thread takes the baseline (`baseline.rs`) while the
//! watch already runs: bursts that arrive first wait in the record, and go back through the burst thread once the
//! baseline is in, so one thread applies every burst, in order.

pub mod baseline;
pub mod compare;
pub mod git;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::access::Kind;
use super::{checked, listable_file, off_main, ReaderError, ReaderState};
use baseline::{BaseEntry, BaseText, Baseline, NoCopy, Stat};
use compare::Now;
use git::Git;

/// Emitted with a root's whole summary after every burst that names something the tree lists.
pub const TREE_CHANGED: &str = "tree_changed";
/// The reader's live reload waits the same (`watch.rs`): an editor's save is several events in a few milliseconds.
pub const DEBOUNCE: Duration = Duration::from_millis(75);
/// A burst that never goes quiet — an agent appending to a log every 50 ms — is still handed over this often, so it
/// cannot hold back a mark elsewhere past rule 7's second.
pub const BURST_CEILING: Duration = Duration::from_millis(500);
/// Every copy of every watched root, together (rule 20): 17 times the whole projects folder, measured 2026-09-23.
pub const COPY_BUDGET_BYTES: u64 = 64 * 1024 * 1024;

pub type Millis = i64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
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

/// A folder that existed at both moments, with changes beneath it (rule 10).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FolderRollup {
    pub path: String,
    pub count: u32,
    pub strongest: Mark,
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
    /// The baseline has been taken. Before it, bursts wait and nothing is marked.
    pub ready: bool,
    /// Changed entries under the root, an added or deleted folder counting once.
    pub total: u32,
    pub entries: Vec<ChangeEntry>,
    pub folders: Vec<FolderRollup>,
    /// Folders whose direct children this burst judged, so an expanded one can re-list.
    pub touched: Vec<String>,
}

struct Record {
    root: PathBuf,
    since_ms: Millis,
    watching: bool,
    baseline: Option<Arc<Baseline>>,
    /// Paths named by bursts before the baseline was in. A file here when its turn to be copied comes gets no copy.
    queued: BTreeSet<PathBuf>,
    marks: BTreeMap<PathBuf, (Kind, Mark)>,
    /// Held only to keep the watch alive. Dropping the record drops it and `feed`, the channel's two senders, which
    /// ends the burst thread.
    #[allow(dead_code)]
    watcher: Option<RecommendedWatcher>,
    /// The burst thread's channel, for the queued paths once the baseline is in.
    feed: Option<Sender<PathBuf>>,
    copy_bytes: u64,
}

impl Record {
    fn new(root: PathBuf, since_ms: Millis) -> Self {
        Record { root, since_ms, watching: true, baseline: None, queued: BTreeSet::new(), marks: BTreeMap::new(), watcher: None, feed: None, copy_bytes: 0 }
    }
}

#[derive(Default)]
pub struct Changes {
    roots: HashMap<PathBuf, Record>,
    /// Every record's `copy_bytes`, against `COPY_BUDGET_BYTES`.
    budget_used: u64,
}

#[derive(Default)]
pub struct ChangesState(Mutex<Changes>);

impl ChangesState {
    fn lock(&self) -> MutexGuard<'_, Changes> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

fn summary(record: &Record, touched: Vec<PathBuf>) -> TreeChanges {
    let (folders, total) = compare::rollups(&record.root, &record.marks);
    TreeChanges {
        root: record.root.display().to_string(),
        since_ms: record.since_ms,
        watching: record.watching,
        ready: record.baseline.is_some(),
        total,
        entries: record.marks.iter().map(|(path, &(kind, mark))| ChangeEntry { path: path.display().to_string(), kind, mark }).collect(),
        folders,
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

        // Found once per watch; None outside a machine with git, or in an e2e launch that says so.
        let git = Git::find();
        let (feed, rx) = mpsc::channel::<PathBuf>();
        let burst_app = app.clone();
        let burst_root = real.clone();
        let burst_git = git.clone();
        let started = start(&real, feed.clone(), rx, move |paths| {
            if let Some(summary) = apply_burst(&burst_app.state::<ChangesState>(), &burst_root, burst_git.as_ref(), paths) {
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
                    record.feed = Some(feed);
                    None
                }
                Err(e) => {
                    record.watching = false;
                    Some(e)
                }
            };
            (summary(record, Vec::new()), failed)
        };
        match failed {
            // The kind only: notify's own message names the path.
            Some(e) => log::warn!("tree changes: could not watch a folder ({})", error_kind(&e)),
            None => {
                let baseline_app = app.clone();
                let baseline_root = real.clone();
                if let Err(e) = std::thread::Builder::new().name("tree-changes-baseline".into()).spawn(move || take_baseline(&baseline_app, baseline_root, git.as_ref())) {
                    log::error!("tree changes: could not start the baseline thread: {e}");
                }
            }
        }
        Ok(answer)
    })
    .await
}

/// The recursive watch and its burst thread. The callback does no disk work (rule 28): it drops what the tree could
/// never list — `.git`, `node_modules`, a build folder — so a build streaming into `target/` never delays a burst.
fn start(root: &Path, tx: Sender<PathBuf>, rx: Receiver<PathBuf>, on_burst: impl FnMut(BTreeSet<PathBuf>) + Send + 'static) -> notify::Result<RecommendedWatcher> {
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

/// The baseline thread: the walk and the copies with no guard held, then one guard to install them.
fn take_baseline(app: &AppHandle, root: PathBuf, git: Option<&Git>) {
    let state = app.state::<ChangesState>();
    let left = COPY_BUDGET_BYTES.saturating_sub(state.lock().budget_used);
    let started = Instant::now();
    let taken = baseline::take(&root, git, left, &|p| state.lock().roots.get(&root).is_some_and(|r| r.queued.contains(p)));
    let (copies, bytes) = (taken.entries.values().filter(|e| matches!(e.text, BaseText::Copy(_))).count(), taken.copy_bytes);
    let Some((summary, queued, feed)) = install_baseline(&state, &root, taken) else {
        return;
    };
    // Counts and a duration, never a path.
    log::info!("tree changes: baseline taken in {} ms, {copies} copies, {bytes} bytes", started.elapsed().as_millis());
    if let Some(feed) = feed {
        for path in queued {
            let _ = feed.send(path);
        }
    }
    let _ = app.emit(TREE_CHANGED, summary);
}

/// Installs a taken baseline, trimmed to what the window's budget still holds — another root may have installed its
/// own since this one's copies started. Returns the summary to emit, and the queued paths with the channel they go
/// back through; None when the root is no longer watched.
fn install_baseline(state: &ChangesState, root: &Path, mut taken: Baseline) -> Option<(TreeChanges, BTreeSet<PathBuf>, Option<Sender<PathBuf>>)> {
    let mut changes = state.lock();
    let left = COPY_BUDGET_BYTES.saturating_sub(changes.budget_used);
    let Changes { roots, budget_used } = &mut *changes;
    let record = roots.get_mut(root)?;
    taken.trim_to(left);
    *budget_used += taken.copy_bytes;
    record.copy_bytes = taken.copy_bytes;
    record.baseline = Some(Arc::new(taken));
    let queued = std::mem::take(&mut record.queued);
    Some((summary(record, Vec::new()), queued, record.feed.clone()))
}

/// One burst for one root. Returns the summary to emit, or None when the root is no longer watched, its baseline is
/// not in yet (the paths wait for it), or nothing in the burst is something the tree lists.
fn apply_burst(state: &ChangesState, root: &Path, git: Option<&Git>, paths: BTreeSet<PathBuf>) -> Option<TreeChanges> {
    let paths: BTreeSet<PathBuf> = paths.into_iter().filter(|p| compare::listable_path(root, p)).collect();
    if paths.is_empty() {
        return None;
    }
    let (baseline, before) = {
        let mut changes = state.lock();
        let record = changes.roots.get_mut(root)?;
        let Some(baseline) = record.baseline.clone() else {
            record.queued.extend(paths);
            return None;
        };
        let before: BTreeMap<PathBuf, (Kind, Mark)> = paths.iter().filter_map(|p| record.marks.get(p).map(|&m| (p.clone(), m))).collect();
        (baseline, before)
    };

    // The disk, with no guard held.
    let judged = judge_all(&baseline, git, &paths, &before);
    let touched: BTreeSet<PathBuf> = judged.keys().filter_map(|p| p.parent().map(Path::to_path_buf)).collect();

    let mut changes = state.lock();
    let record = changes.roots.get_mut(root)?;
    for (path, mark) in judged {
        match mark {
            Some(mark) => record.marks.insert(path, mark),
            None => record.marks.remove(&path),
        };
    }
    let before_pruning = record.marks.clone();
    record.marks.retain(|p, _| !compare::under_marked_folder(root, p, &before_pruning));
    Some(summary(record, touched.into_iter().collect()))
}

/// Every path of a burst, judged against the baseline. A folder whose own mark changed — it appeared, vanished or came
/// back — has everything beneath it judged too: its mark stood for them, or stops standing for them. A folder's mark
/// needs no hash, so that is settled first; then one `hash-object` per repository answers for every clean-tracked file.
fn judge_all(baseline: &Baseline, git: Option<&Git>, paths: &BTreeSet<PathBuf>, before: &BTreeMap<PathBuf, (Kind, Mark)>) -> BTreeMap<PathBuf, Option<(Kind, Mark)>> {
    let mut all = paths.clone();
    for path in paths {
        let dir_then = baseline.entries.get(path).is_some_and(|b| b.stat.kind == Kind::Dir);
        let dir_now = Stat::of(path).is_some_and(|s| s.kind == Kind::Dir);
        if !(dir_then || dir_now) || before.get(path).copied() == judge(baseline, path, &HashMap::new(), git) {
            continue;
        }
        all.extend(baseline.beneath(path).map(|(p, _)| p.clone()));
        if dir_now {
            all.extend(baseline::walk(path).entries.into_iter().map(|(p, _)| p));
        }
    }
    let hashes = git.map(|g| blob_hashes(baseline, g, &all)).unwrap_or_default();
    all.into_iter().map(|path| {
        let mark = judge(baseline, &path, &hashes, git);
        (path, mark)
    }).collect()
}

/// `git hash-object` of each clean-tracked file present now, one call per repository. A repository that does not
/// answer leaves its files unhashed, and they read as changed: M when unsure (rule 3).
fn blob_hashes(baseline: &Baseline, git: &Git, paths: &BTreeSet<PathBuf>) -> HashMap<PathBuf, String> {
    let mut by_repo: HashMap<&Path, Vec<PathBuf>> = HashMap::new();
    for path in paths {
        if let Some(BaseEntry { text: BaseText::Blob { head, .. }, .. }) = baseline.entries.get(path) {
            if Stat::of(path).is_some_and(|s| s.kind == Kind::File) {
                by_repo.entry(head.repo.as_path()).or_default().push(path.clone());
            }
        }
    }
    let mut hashes = HashMap::new();
    for (repo, files) in by_repo {
        if let Ok(ids) = git.hash_objects(repo, &files) {
            hashes.extend(files.into_iter().zip(ids));
        }
    }
    hashes
}

/// What one path is marked now. A stat, the tree's filter for a file, and a read for a file whose copy decides.
fn judge(baseline: &Baseline, path: &Path, hashes: &HashMap<PathBuf, String>, git: Option<&Git>) -> Option<(Kind, Mark)> {
    let base = baseline.entries.get(path);
    let stat = Stat::of(path);
    let now = match stat {
        None => Now::Absent,
        Some(s) if s.kind == Kind::Dir => Now::Dir,
        Some(_) => Now::File { listable: listable_file(path) },
    };
    // A file that matched HEAD was never read, so what it was is judged now (rule 5, Gate 2): by its head if it is
    // still here, by its blob's head if it is gone. One that proves a binary was never a row.
    let base = match (base, now) {
        (Some(BaseEntry { text: BaseText::Blob { .. }, .. }), Now::File { listable: false }) => None,
        (Some(BaseEntry { text: BaseText::Blob { head, .. }, .. }), Now::Absent) if !blob_listed(git, head, path) => None,
        _ => base,
    };
    let same = match (base, stat, now) {
        (Some(base), Some(stat), Now::File { listable: true }) if base.stat.kind == Kind::File && base.listed() => same_text(base, stat, path, hashes),
        _ => false,
    };
    compare::mark_of(base, now, same)
}

/// Whether a deleted clean-tracked file was one the tree listed, by its blob's head. (An image is never a blob: it
/// has no copy of any kind.) With no git to ask, it counts as listed — a D when unsure, as an M is.
fn blob_listed(git: Option<&Git>, head: &baseline::Head, path: &Path) -> bool {
    let Some(git) = git else { return true };
    git.blob_text(&head.repo, &head.commit, path).map_or(true, |bytes| {
        crate::reader::access::sniff(&bytes[..bytes.len().min(crate::reader::access::SNIFF_BYTES)]) == crate::reader::access::Content::Text
    })
}

/// Rule 3's "the same text": byte-equal to the copy, or hashing to HEAD's blob. With neither, the same size and
/// modification time (Gate 2) — and never for a file that changed while its copy was being taken: Kinas cannot tell,
/// and M is safer than silence.
fn same_text(base: &BaseEntry, now: Stat, path: &Path, hashes: &HashMap<PathBuf, String>) -> bool {
    match &base.text {
        BaseText::Copy(bytes) => now.size == bytes.len() as u64 && std::fs::read(path).is_ok_and(|read| read[..] == bytes[..]),
        BaseText::Blob { blob, .. } => hashes.get(path) == Some(blob),
        BaseText::NoCopy(NoCopy::ChangedDuringCopy) => false,
        BaseText::NoCopy(_) | BaseText::NotText => now.size == base.stat.size && now.mtime_ms == base.stat.mtime_ms,
    }
}

/// Collects paths until `quiet` passes with none, then hands the set over — or sooner, once the burst has been open
/// for `ceiling`. Returns when every sender is gone.
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

    /// A root with these files, watched, its baseline taken and installed — everything but the watch itself.
    fn watched(files: &[(&str, &[u8])], budget: u64) -> (tempfile::TempDir, PathBuf, ChangesState) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for (name, bytes) in files {
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        let state = ChangesState::default();
        state.lock().roots.insert(root.clone(), Record::new(root.clone(), 1_000));
        install_baseline(&state, &root, baseline::take(&root, None, budget, &|_| false)).unwrap();
        (dir, root, state)
    }

    fn burst(state: &ChangesState, root: &Path, names: &[&str]) -> TreeChanges {
        apply_burst(state, root, None, names.iter().map(|n| root.join(n)).collect()).expect("a summary to emit")
    }

    fn marked(summary: &TreeChanges, root: &Path) -> Vec<String> {
        summary.entries.iter().map(|e| format!("{} {}", serde_json::to_value(e.mark).unwrap().as_str().unwrap(), Path::new(&e.path).strip_prefix(root).unwrap().display())).collect()
    }

    #[test]
    fn hidden_names_and_skipped_folders_never_mark() {
        let (_dir, root, state) = watched(&[("README.md", b"# Read me\n"), (".git/index", b"DIRC"), ("docs/photo.bin", b"\x00\x01")], 1024);
        std::fs::write(root.join(".git/index"), "DIRC2").unwrap();
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(root.join("node_modules/x.md"), "# x").unwrap();
        std::fs::write(root.join(".hidden.md"), "# hidden").unwrap();
        std::fs::write(root.join("docs/photo.bin"), b"\x00\x01\x02").unwrap();
        std::fs::write(root.join("docs/new.bin"), b"\x00\x09").unwrap();

        let answer = apply_burst(&state, &root, None, [".git/index", "node_modules/x.md", ".hidden.md", "docs/photo.bin", "docs/new.bin"].iter().map(|n| root.join(n)).collect());
        let (total, entries) = answer.map(|s| (s.total, s.entries)).unwrap_or_default();
        assert_eq!((total, entries), (0, vec![]));
    }

    #[test]
    fn a_save_is_m_a_new_file_is_a_and_the_whole_summary_says_so() {
        let (_dir, root, state) = watched(&[("docs/overview.md", b"# Overview\n")], 1024);
        std::fs::write(root.join("docs/overview.md"), "# Overview\n\nA new line.\n").unwrap();
        std::fs::write(root.join("docs/new-note.md"), "# New\n").unwrap();

        let answer = burst(&state, &root, &["docs/overview.md", "docs/new-note.md"]);
        assert_eq!(marked(&answer, &root), ["A docs/new-note.md", "M docs/overview.md"]);
        assert_eq!((answer.root.as_str(), answer.since_ms, answer.watching, answer.ready, answer.total), (root.to_str().unwrap(), 1_000, true, true, 2));
        assert_eq!(answer.folders, [FolderRollup { path: root.join("docs").display().to_string(), count: 2, strongest: Mark::Modified }]);
        assert_eq!(answer.touched, [root.join("docs").display().to_string()]);

        // A root no longer watched answers nothing, so nothing is emitted for it.
        assert_eq!(apply_burst(&ChangesState::default(), &root, None, BTreeSet::from([root.join("docs/overview.md")])), None);
    }

    #[test]
    fn an_edited_then_restored_file_has_no_mark() {
        let (_dir, root, state) = watched(&[("a.md", b"# A\n")], 1024);
        std::fs::write(root.join("a.md"), "# A, edited\n").unwrap();
        assert_eq!(marked(&burst(&state, &root, &["a.md"]), &root), ["M a.md"]);
        std::fs::write(root.join("a.md"), "# A\n").unwrap();
        let answer = burst(&state, &root, &["a.md"]);
        assert_eq!((answer.total, marked(&answer, &root)), (0, vec![]));
    }

    #[test]
    fn made_and_removed_in_between_is_no_row() {
        let (_dir, root, state) = watched(&[("a.md", b"# A\n")], 1024);
        std::fs::write(root.join("brief.md"), "# Brief\n").unwrap();
        assert_eq!(marked(&burst(&state, &root, &["brief.md"]), &root), ["A brief.md"]);
        std::fs::remove_file(root.join("brief.md")).unwrap();
        assert_eq!(burst(&state, &root, &["brief.md"]).entries, vec![]);
    }

    #[test]
    fn a_rename_is_a_deletion_and_an_addition() {
        let (_dir, root, state) = watched(&[("a.md", b"# A\n")], 1024);
        std::fs::rename(root.join("a.md"), root.join("b.md")).unwrap();
        assert_eq!(marked(&burst(&state, &root, &["a.md", "b.md"]), &root), ["D a.md", "A b.md"]);
    }

    #[test]
    fn a_touch_marks_a_file_without_a_copy() {
        // A budget of nothing: no copy, so size and modification time decide.
        let (_dir, root, state) = watched(&[("a.md", b"# A\n")], 0);
        let file = std::fs::File::options().write(true).open(root.join("a.md")).unwrap();
        file.set_modified(std::time::SystemTime::now() + Duration::from_secs(5)).unwrap();
        assert_eq!(marked(&burst(&state, &root, &["a.md"]), &root), ["M a.md"]);
    }

    #[test]
    fn a_new_folder_counts_once() {
        let (_dir, root, state) = watched(&[("README.md", b"# R\n")], 1024);
        let names: Vec<String> = (0..10).map(|i| format!("research/note-{i}.md")).collect();
        for name in &names {
            std::fs::create_dir_all(root.join("research")).unwrap();
            std::fs::write(root.join(name), "# note\n").unwrap();
        }
        let mut all: Vec<&str> = names.iter().map(String::as_str).collect();
        all.push("research");
        let answer = burst(&state, &root, &all);
        assert_eq!((answer.total, marked(&answer, &root)), (1, vec!["A research".to_string()]));
        assert_eq!(answer.folders, vec![]);
    }

    #[test]
    fn a_deleted_folder_subsumes_its_marks_and_comes_back_with_them() {
        let (_dir, root, state) = watched(&[("docs/overview.md", b"# Overview\n"), ("docs/old.md", b"# Old\n")], 1024);
        std::fs::write(root.join("docs/overview.md"), "# Overview, edited\n").unwrap();
        assert_eq!(marked(&burst(&state, &root, &["docs/overview.md"]), &root), ["M docs/overview.md"]);

        // Moved away whole: FSEvents names the folder, and the folder's D stands for everything in it.
        let away = tempfile::tempdir().unwrap();
        std::fs::rename(root.join("docs"), away.path().join("docs")).unwrap();
        let answer = burst(&state, &root, &["docs"]);
        assert_eq!((answer.total, marked(&answer, &root)), (1, vec!["D docs".to_string()]));

        // And back, with one file fewer: its own M returns, and the file it lost is D.
        std::fs::remove_file(away.path().join("docs/old.md")).unwrap();
        std::fs::rename(away.path().join("docs"), root.join("docs")).unwrap();
        let answer = burst(&state, &root, &["docs"]);
        assert_eq!(marked(&answer, &root), ["D docs/old.md", "M docs/overview.md"]);
        assert_eq!(answer.folders, [FolderRollup { path: root.join("docs").display().to_string(), count: 2, strongest: Mark::Deleted }]);
        assert!(answer.touched.contains(&root.join("docs").display().to_string()), "the folder re-lists: {:?}", answer.touched);
    }

    #[test]
    fn bursts_before_the_baseline_wait_for_it_and_their_files_get_no_copy() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("busy.md"), "# before\n").unwrap();
        let state = ChangesState::default();
        state.lock().roots.insert(root.clone(), Record::new(root.clone(), 1_000));

        assert_eq!(apply_burst(&state, &root, None, BTreeSet::from([root.join("busy.md")])), None);
        let taken = baseline::take(&root, None, 1024, &|p| state.lock().roots.get(&root).is_some_and(|r| r.queued.contains(p)));
        assert_eq!(taken.entries[&root.join("busy.md")].text, BaseText::NoCopy(NoCopy::ChangedDuringCopy));
        let (ready, queued, _) = install_baseline(&state, &root, taken).unwrap();
        assert!(ready.ready);
        assert_eq!(queued, BTreeSet::from([root.join("busy.md")]));
        // Applied now, the file that changed around its copy is M: Kinas cannot tell, so it says modified.
        assert_eq!(marked(&apply_burst(&state, &root, None, queued).unwrap(), &root), ["M busy.md"]);
    }

    #[test]
    fn the_window_budget_is_shared_and_a_late_baseline_gives_back_what_no_longer_fits() {
        let (_dir, _root, state) = watched(&[("a.md", &[b'a'; 100])], 1024);
        assert_eq!(state.lock().budget_used, 100);
        let other = tempfile::tempdir().unwrap();
        let other_root = other.path().canonicalize().unwrap();
        std::fs::write(other_root.join("b.md"), [b'b'; 100]).unwrap();
        state.lock().roots.insert(other_root.clone(), Record::new(other_root.clone(), 2_000));
        let taken = baseline::take(&other_root, None, 1024, &|_| false);
        // As if the budget had been 150 when the second baseline was installed.
        state.lock().budget_used = COPY_BUDGET_BYTES - 50;
        install_baseline(&state, &other_root, taken).unwrap();
        let changes = state.lock();
        let record = &changes.roots[&other_root];
        assert_eq!(record.copy_bytes, 0);
        assert_eq!(record.baseline.as_ref().unwrap().entries[&other_root.join("b.md")].text, BaseText::NoCopy(NoCopy::Budget));
        assert_eq!(changes.budget_used, COPY_BUDGET_BYTES - 50);
    }

    /// As `watched`, but the root is a git repository with these files committed, and git answers for them.
    fn watched_repo(files: &[(&str, &[u8])]) -> (tempfile::TempDir, PathBuf, ChangesState, Git) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git::tests::repo_with(&root, files);
        let g = Git::find().expect("git is installed");
        let state = ChangesState::default();
        state.lock().roots.insert(root.clone(), Record::new(root.clone(), 1_000));
        install_baseline(&state, &root, baseline::take(&root, Some(&g), 1024, &|_| false)).unwrap();
        (dir, root, state, g)
    }

    fn git_burst(state: &ChangesState, root: &Path, g: &Git, names: &[&str]) -> TreeChanges {
        apply_burst(state, root, Some(g), names.iter().map(|n| root.join(n)).collect()).expect("a summary to emit")
    }

    #[test]
    fn saving_a_clean_tracked_file_unchanged_makes_no_mark() {
        let (_dir, root, state, g) = watched_repo(&[("README.md", b"# Read me\n")]);
        assert!(matches!(state.lock().roots[&root].baseline.as_ref().unwrap().entries[&root.join("README.md")].text, BaseText::Blob { .. }));
        // The same bytes, a new modification time: git says it is the blob it was.
        std::fs::write(root.join("README.md"), "# Read me\n").unwrap();
        assert_eq!(git_burst(&state, &root, &g, &["README.md"]).entries, vec![]);
        std::fs::write(root.join("README.md"), "# Read me\n\nA line.\n").unwrap();
        assert_eq!(marked(&git_burst(&state, &root, &g, &["README.md"]), &root), ["M README.md"]);
        std::fs::write(root.join("README.md"), "# Read me\n").unwrap();
        assert_eq!(git_burst(&state, &root, &g, &["README.md"]).entries, vec![]);
    }

    #[test]
    fn a_clean_tracked_binary_is_judged_when_it_changes_and_never_marks() {
        let (_dir, root, state, g) = watched_repo(&[("tool.bin", b"\x00\x01\x02"), ("notes.md", b"# Notes\n"), ("logo.png", b"\x89PNG\r\n")]);
        std::fs::write(root.join("tool.bin"), b"\x00\x01\x02\x03").unwrap();
        assert_eq!(git_burst(&state, &root, &g, &["tool.bin"]).entries, vec![]);
        std::fs::remove_file(root.join("tool.bin")).unwrap();
        assert_eq!(git_burst(&state, &root, &g, &["tool.bin"]).entries, vec![]);
        // Its text neighbour and an image, deleted, are rows the tree had: each is a D.
        std::fs::remove_file(root.join("notes.md")).unwrap();
        std::fs::remove_file(root.join("logo.png")).unwrap();
        assert_eq!(marked(&git_burst(&state, &root, &g, &["notes.md", "logo.png"]), &root), ["D logo.png", "D notes.md"]);
    }

    #[test]
    fn a_save_under_a_watched_root_reaches_a_burst_and_a_write_in_git_does_not() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("docs")).unwrap();
        let (feed, rx) = mpsc::channel();
        let (sets, seen_rx) = mpsc::channel();
        let watcher = start(&root, feed, rx, move |set| {
            let _ = sets.send(set);
        })
        .expect("FSEvents watches a temp folder");

        // FSEvents can take a moment to begin delivering; the ceiling is generous, the assertion exact.
        sleep(Duration::from_millis(200));
        std::fs::write(root.join(".git/index"), "DIRC").unwrap();
        std::fs::write(root.join("docs/note.md"), "# Note\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut seen = BTreeSet::new();
        while Instant::now() < deadline && !seen.contains(&root.join("docs/note.md")) {
            if let Ok(set) = seen_rx.recv_timeout(Duration::from_millis(100)) {
                seen.extend(set);
            }
        }
        drop(watcher);
        assert!(seen.contains(&root.join("docs/note.md")), "the save arrived: {seen:?}");
        assert!(seen.iter().all(|p| !p.starts_with(root.join(".git"))), "nothing under .git arrived: {seen:?}");
    }
}
