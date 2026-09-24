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
pub mod diff;
pub mod git;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::access::{self, Kind};
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
    /// Unique across the window: a new one at every refresh, so a baseline thread started before it installs nothing.
    generation: u64,
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
    fn new(root: PathBuf, since_ms: Millis, generation: u64) -> Self {
        Record { root, since_ms, generation, watching: true, baseline: None, queued: BTreeSet::new(), marks: BTreeMap::new(), watcher: None, feed: None, copy_bytes: 0 }
    }
}

#[derive(Default)]
pub struct Changes {
    roots: HashMap<PathBuf, Record>,
    /// Every record's `copy_bytes`, against `COPY_BUDGET_BYTES`.
    budget_used: u64,
    /// The last generation handed out. Never reset — not even by a reload, whose old threads may still be running.
    last_generation: u64,
}

impl Changes {
    fn next_generation(&mut self) -> u64 {
        self.last_generation += 1;
        self.last_generation
    }
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
        let real = checked_dir(&app, &root)?;
        match register(&app.state::<ChangesState>(), &real, crate::store::now_ms()) {
            (answer, None) => Ok(answer),
            (first, Some(generation)) => Ok(follow(&app, &real, generation, first)),
        }
    })
    .await
}

/// Refresh (rule 15): one root's marks, deleted rows and copies go, and its baseline becomes now. Other roots keep
/// theirs. A root whose watch had failed tries to start it again (PRD §3). Refused for a root not watched: nothing
/// else starts a watch but a tree being shown.
#[tauri::command]
pub async fn tree_changes_refresh(app: AppHandle, root: String) -> Result<TreeChanges, ReaderError> {
    off_main(move || {
        let real = checked_dir(&app, &root)?;
        let Some((answer, generation, retry)) = reset(&app.state::<ChangesState>(), &real, crate::store::now_ms()) else {
            return Err(ReaderError::new("not_watched", format!("Kinas is not following changes in {}", real.display())));
        };
        if retry {
            return Ok(follow(&app, &real, generation, answer));
        }
        spawn_baseline(&app, &real, generation, Git::find());
        Ok(answer)
    })
    .await
}

/// The Changes view of one changed file (rules 20–25): its text now against its text at the baseline. It answers only
/// for a path a watched root marks — itself, or anything inside a folder marked added — under a root the reader may
/// still read (ADR 0009); nothing else is a door to a file. A file Kinas kept no text for is refused with the reason,
/// never guessed at (rule 23).
#[tauri::command]
pub async fn tree_changes_diff(app: AppHandle, path: String) -> Result<diff::DiffView, ReaderError> {
    off_main(move || {
        let path = super::absolute(&path)?;
        let projects = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
        // Cloned, so the reader's guard is never held with this module's (ADR 0005).
        let allowed = app.state::<ReaderState>().lock().allowed.clone();
        let permitted = |root: &Path| access::permitted(root, &projects, &allowed);
        diff_view(&app.state::<ChangesState>(), &path, &permitted, Git::find().as_ref(), &projects, &super::home())
    })
    .await
}

/// The text of a deleted file at its tree's baseline, and its name, for Download (rule 22). Only for a path a
/// watched, still readable root marks deleted: the record is this door's only source, as it is the diff's.
pub(crate) fn deleted_baseline(app: &AppHandle, path: &str) -> Result<(String, Vec<u8>), ReaderError> {
    let path = super::absolute(path)?;
    let projects = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
    let allowed = app.state::<ReaderState>().lock().allowed.clone();
    let permitted = |root: &Path| access::permitted(root, &projects, &allowed);
    let (_, mark, bytes) = old_text(&app.state::<ChangesState>(), &path, &permitted, Git::find().as_ref())?;
    if mark != Mark::Deleted {
        return Err(ReaderError::new("not_deleted", "This file is still there: download it as it is"));
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "copy".into());
    Ok((name, bytes))
}

/// What a marked file said at its root's baseline — the kept copy, or HEAD's blob read back — with the baseline's
/// time and the mark: empty for a file the tree did not have then, a refusal with the reason where Kinas kept no
/// text (rule 23). Only for a path a watched root marks, under a root the reader may still read (ADR 0009).
fn old_text(state: &ChangesState, path: &Path, permitted: &dyn Fn(&Path) -> bool, git: Option<&Git>) -> Result<(Millis, Mark, Vec<u8>), ReaderError> {
    let (_, since_ms, mark, baseline) = changed_file(state, path)
        .filter(|(root, ..)| permitted(root))
        .ok_or_else(|| ReaderError::new("not_watched", "Kinas is not following changes to this file"))?;
    let bytes = match baseline.entries.get(path).map(|b| &b.text) {
        // Not in the tree at the baseline: every line is new.
        None | Some(BaseText::NotText) => Vec::new(),
        Some(BaseText::Copy(bytes)) => bytes.to_vec(),
        Some(BaseText::Blob { head, .. }) => git
            .ok_or(())
            .and_then(|g| g.blob_text(&head.repo, &head.commit, path).map_err(|_| ()))
            .map_err(|()| no_baseline(since_ms, "git could not read it back"))?,
        Some(BaseText::NoCopy(reason)) => return Err(no_copy(since_ms, *reason, mark)),
    };
    Ok((since_ms, mark, bytes))
}

/// `tree_changes_diff` without Tauri: the record's half under the guard, the disk's without it.
fn diff_view(state: &ChangesState, path: &Path, permitted: &dyn Fn(&Path) -> bool, git: Option<&Git>, projects: &Path, home: &Path) -> Result<diff::DiffView, ReaderError> {
    let (since_ms, mark, bytes) = old_text(state, path, permitted, git)?;
    let before = String::from_utf8_lossy(&bytes).into_owned();
    let after = if mark == Mark::Deleted { String::new() } else { access::read_text(path).map_err(|d| ReaderError::denied(&d, path))?.text };
    let (rows, folds, added, removed) = diff::diff(&before, &after, diff::DIFF_DEADLINE).map_err(|t| {
        ReaderError::new("too_many_changes", format!("Too many changes to show — {} lines then, {} now", diff::grouped(t.before_lines), diff::grouped(t.after_lines)))
    })?;
    Ok(diff::DiffView {
        path: path.display().to_string(),
        display_path: access::display_path(path, projects, home),
        root: access::real_root(projects).display().to_string(),
        ext: access::ext_of(path),
        since_ms,
        mark,
        added,
        removed,
        rows,
        folds,
        baseline_text: (mark == Mark::Deleted).then_some(before),
    })
}

/// The deepest watched root that marks `path` — itself, or a folder above it marked added — with its "since", the
/// path's mark, and the baseline to read its old text from.
fn changed_file(state: &ChangesState, path: &Path) -> Option<(PathBuf, Millis, Mark, Arc<Baseline>)> {
    let changes = state.lock();
    changes
        .roots
        .values()
        .filter(|r| path.starts_with(&r.root) && path != r.root)
        .filter_map(|r| {
            let baseline = r.baseline.clone()?;
            let own = r.marks.get(path).map(|&(_, mark)| mark);
            let inside_added = || path.ancestors().skip(1).take_while(|a| *a != r.root).any(|a| matches!(r.marks.get(a), Some((_, Mark::Added))));
            let mark = own.or_else(|| inside_added().then_some(Mark::Added))?;
            Some((r.root.clone(), r.since_ms, mark, baseline))
        })
        .max_by_key(|(root, ..)| root.components().count())
}

/// The baseline as local HH:MM, as the webview's captions say it.
fn clock(ms: Millis) -> String {
    jiff::Timestamp::from_millisecond(ms).map(|t| t.to_zoned(jiff::tz::TimeZone::system()).strftime("%H:%M").to_string()).unwrap_or_default()
}

/// Rule 23's line, with its reason.
fn no_baseline(since_ms: Millis, reason: &str) -> ReaderError {
    ReaderError::new("no_baseline", format!("Kinas kept no copy of this file from {}, so there is nothing to compare — {reason}", clock(since_ms)))
}

fn no_copy(since_ms: Millis, reason: NoCopy, mark: Mark) -> ReaderError {
    match reason {
        NoCopy::Image if mark == Mark::Deleted => ReaderError::new("no_baseline", "This image was deleted; Kinas keeps no copy of images"),
        NoCopy::Image => ReaderError::new("no_baseline", "Kinas keeps no copy of images, so there is nothing to compare"),
        NoCopy::Budget => no_baseline(since_ms, "the folder holds more text than Kinas keeps"),
        NoCopy::TooLarge => no_baseline(since_ms, "it is larger than 4 MB"),
        NoCopy::ChangedDuringCopy => no_baseline(since_ms, "it changed while Kinas was taking its copies"),
        NoCopy::Unreadable => no_baseline(since_ms, "it could not be read then"),
    }
}

/// `PageLoadEvent::Started` on the main webview — a reload (rule 17): every record, watch and copy goes, as if no
/// folder had ever been shown. The records are dropped after the guard is released: stopping a watch is not free.
pub fn on_page_load(app: &AppHandle) {
    if let Some(state) = app.try_state::<ChangesState>() {
        drop(drop_all(&state));
    }
}

/// A root the reader may read (ADR 0009), as a folder.
fn checked_dir(app: &AppHandle, root: &str) -> Result<PathBuf, ReaderError> {
    let projects = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
    let (real, kind) = checked(&app.state::<ReaderState>(), &projects, root)?;
    if kind != Kind::Dir {
        return Err(ReaderError::new("not_dir", format!("Not a folder: {}", real.display())));
    }
    Ok(real)
}

/// The root's record, made on its first showing. Answers its summary, and — when this call made it — its generation,
/// for the caller to start its watch. In before the watch starts, so a second call racing this one starts nothing.
fn register(state: &ChangesState, real: &Path, now: Millis) -> (TreeChanges, Option<u64>) {
    let mut changes = state.lock();
    if let Some(record) = changes.roots.get(real) {
        return (summary(record, Vec::new()), None);
    }
    let generation = changes.next_generation();
    let record = Record::new(real.to_path_buf(), now, generation);
    let first = summary(&record, Vec::new());
    changes.roots.insert(real.to_path_buf(), record);
    (first, Some(generation))
}

/// Refresh's half under the guard: the record back to empty, with a new generation and "since". Answers the empty
/// summary, the generation, and whether the watch has to be started again; None for a root not watched.
fn reset(state: &ChangesState, real: &Path, now: Millis) -> Option<(TreeChanges, u64, bool)> {
    let mut changes = state.lock();
    let generation = changes.next_generation();
    let Changes { roots, budget_used, .. } = &mut *changes;
    let record = roots.get_mut(real)?;
    *budget_used = budget_used.saturating_sub(record.copy_bytes);
    record.generation = generation;
    record.since_ms = now;
    record.baseline = None;
    record.queued.clear();
    record.marks.clear();
    record.copy_bytes = 0;
    Some((summary(record, Vec::new()), generation, !record.watching))
}

/// Every record out of the state, the budget back to nothing. The caller drops them, with no guard held.
fn drop_all(state: &ChangesState) -> HashMap<PathBuf, Record> {
    let mut changes = state.lock();
    changes.budget_used = 0;
    std::mem::take(&mut changes.roots)
}

/// The watch, the burst thread and the baseline thread, for a record that has none: its first showing, or a refresh
/// after a watch that failed. Answers the record's summary as it then stands — or `fallback`, when a reload or a
/// refresh took the record meanwhile.
fn follow(app: &AppHandle, real: &Path, generation: u64, fallback: TreeChanges) -> TreeChanges {
    // Found once per watch; None on a machine without git, or in an e2e launch that says so.
    let git = Git::find();
    let (feed, rx) = mpsc::channel::<PathBuf>();
    let burst_app = app.clone();
    let burst_root = real.to_path_buf();
    let burst_git = git.clone();
    let started = start(real, feed.clone(), rx, move |paths| {
        if let Some(summary) = apply_burst(&burst_app.state::<ChangesState>(), &burst_root, burst_git.as_ref(), paths) {
            let _ = burst_app.emit(TREE_CHANGED, summary);
        }
    });

    let (answer, failed) = {
        let state = app.state::<ChangesState>();
        let mut changes = state.lock();
        // Gone already, or refreshed: whatever took it owns it now. This watcher drops here.
        let Some(record) = changes.roots.get_mut(real).filter(|r| r.generation == generation) else {
            return fallback;
        };
        let failed = match started {
            Ok(watcher) => {
                record.watching = true;
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
        None => spawn_baseline(app, real, generation, git),
    }
    answer
}

fn spawn_baseline(app: &AppHandle, real: &Path, generation: u64, git: Option<Git>) {
    let app = app.clone();
    let root = real.to_path_buf();
    if let Err(e) = std::thread::Builder::new().name("tree-changes-baseline".into()).spawn(move || take_baseline(&app, root, generation, git.as_ref())) {
        log::error!("tree changes: could not start the baseline thread: {e}");
    }
}

/// The recursive watch and its burst thread. The callback does no disk work (rule 28): it drops what the tree could
/// never list — `.git`, `node_modules`, a build folder — so a build streaming into `target/` never delays a burst.
fn start(root: &Path, tx: Sender<PathBuf>, rx: Receiver<PathBuf>, on_burst: impl FnMut(BTreeSet<PathBuf>) + Send + 'static) -> notify::Result<RecommendedWatcher> {
    // A debug build started with KINAS_E2E_WATCH_FAIL=1 refuses every watch, so the e2e can see the tree say so.
    #[cfg(debug_assertions)]
    if std::env::var("KINAS_E2E_WATCH_FAIL").as_deref() == Ok("1") {
        return Err(notify::Error::generic("refused for the e2e"));
    }
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
fn take_baseline(app: &AppHandle, root: PathBuf, generation: u64, git: Option<&Git>) {
    let state = app.state::<ChangesState>();
    let left = COPY_BUDGET_BYTES.saturating_sub(state.lock().budget_used);
    let started = Instant::now();
    let taken = baseline::take(&root, git, left, &|p| state.lock().roots.get(&root).is_some_and(|r| r.queued.contains(p)));
    let (copies, bytes) = (taken.entries.values().filter(|e| matches!(e.text, BaseText::Copy(_))).count(), taken.copy_bytes);
    let Some((summary, queued, feed)) = install_baseline(&state, &root, generation, taken) else {
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
/// back through; None when the root is no longer watched, or was refreshed after this baseline began.
fn install_baseline(state: &ChangesState, root: &Path, generation: u64, mut taken: Baseline) -> Option<(TreeChanges, BTreeSet<PathBuf>, Option<Sender<PathBuf>>)> {
    let mut changes = state.lock();
    let left = COPY_BUDGET_BYTES.saturating_sub(changes.budget_used);
    let Changes { roots, budget_used, .. } = &mut *changes;
    let record = roots.get_mut(root).filter(|r| r.generation == generation)?;
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
    // Judged against a baseline a refresh has since replaced: the new one will judge these paths itself.
    let record = changes.roots.get_mut(root).filter(|r| r.baseline.as_ref().is_some_and(|b| Arc::ptr_eq(b, &baseline)))?;
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
        state.lock().roots.insert(root.clone(), Record::new(root.clone(), 1_000, 0));
        install_baseline(&state, &root, 0, baseline::take(&root, None, budget, &|_| false)).unwrap();
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
        state.lock().roots.insert(root.clone(), Record::new(root.clone(), 1_000, 0));

        assert_eq!(apply_burst(&state, &root, None, BTreeSet::from([root.join("busy.md")])), None);
        let taken = baseline::take(&root, None, 1024, &|p| state.lock().roots.get(&root).is_some_and(|r| r.queued.contains(p)));
        assert_eq!(taken.entries[&root.join("busy.md")].text, BaseText::NoCopy(NoCopy::ChangedDuringCopy));
        let (ready, queued, _) = install_baseline(&state, &root, 0, taken).unwrap();
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
        state.lock().roots.insert(other_root.clone(), Record::new(other_root.clone(), 2_000, 0));
        let taken = baseline::take(&other_root, None, 1024, &|_| false);
        // As if the budget had been 150 when the second baseline was installed.
        state.lock().budget_used = COPY_BUDGET_BYTES - 50;
        install_baseline(&state, &other_root, 0, taken).unwrap();
        let changes = state.lock();
        let record = &changes.roots[&other_root];
        assert_eq!(record.copy_bytes, 0);
        assert_eq!(record.baseline.as_ref().unwrap().entries[&other_root.join("b.md")].text, BaseText::NoCopy(NoCopy::Budget));
        assert_eq!(changes.budget_used, COPY_BUDGET_BYTES - 50);
    }

    #[test]
    fn watch_twice_keeps_the_first_baseline() {
        let state = ChangesState::default();
        let root = Path::new("/p/kinas");
        let (first, made) = register(&state, root, 1_000);
        assert!(made.is_some(), "the first showing makes the record");
        let (second, again) = register(&state, root, 5_000);
        assert_eq!((again, second.since_ms), (None, 1_000), "a second tree on the root shares the first one's time");
        assert_eq!(first, second);
        // Another root is its own record, with its own time.
        assert_eq!(register(&state, Path::new("/p/kinas/tasks"), 6_000).0.since_ms, 6_000);
    }

    #[test]
    fn a_refresh_clears_one_root_and_gives_its_copies_back() {
        let (_dir, root, state) = watched(&[("a.md", &[b'a'; 100])], 1024);
        let (_other_dir, other, _) = watched(&[("b.md", b"# b\n")], 1024);
        state.lock().roots.insert(other.clone(), Record::new(other.clone(), 2_000, 7));
        std::fs::write(root.join("a.md"), "# edited\n").unwrap();
        std::fs::remove_file(root.join("a.md")).unwrap();
        std::fs::write(root.join("new.md"), "# new\n").unwrap();
        assert_eq!(burst(&state, &root, &["a.md", "new.md"]).total, 2);
        assert_eq!(state.lock().budget_used, 100);

        let (answer, generation, retry) = reset(&state, &root, 9_000).expect("a watched root");
        assert_eq!((answer.since_ms, answer.ready, answer.total, answer.entries.len(), retry), (9_000, false, 0, 0, false));
        assert_eq!(state.lock().budget_used, 0);
        assert_eq!(state.lock().roots[&other].since_ms, 2_000, "the other root is untouched");
        // A burst now waits for the new baseline, which does not know a.md: new.md is part of the new "before".
        assert_eq!(apply_burst(&state, &root, None, BTreeSet::from([root.join("new.md")])), None);
        let retaken = baseline::take(&root, None, 1024, &|p| state.lock().roots.get(&root).is_some_and(|r| r.queued.contains(p)));
        let (ready, queued, _) = install_baseline(&state, &root, generation, retaken).unwrap();
        assert_eq!((ready.ready, ready.total), (true, 0));
        let after = apply_burst(&state, &root, None, queued).unwrap();
        assert_eq!(marked(&after, &root), ["M new.md"], "written around its copy, so modified: Kinas cannot tell");

        assert_eq!(reset(&state, Path::new("/p/never-shown"), 9_000), None);
    }

    #[test]
    fn a_refresh_during_a_baseline_discards_the_old_thread() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("a.md"), [b'a'; 100]).unwrap();
        let state = ChangesState::default();
        let (_, first) = register(&state, &root, 1_000);
        // The first baseline is still being taken when the refresh comes.
        let slow = baseline::take(&root, None, 1024, &|_| false);
        let (_, second, _) = reset(&state, &root, 2_000).unwrap();
        assert!(install_baseline(&state, &root, first.unwrap(), slow).is_none(), "the old thread installs nothing");
        {
            let changes = state.lock();
            assert_eq!((changes.budget_used, changes.roots[&root].baseline.is_none()), (0, true));
        }
        let fresh = baseline::take(&root, None, 1024, &|_| false);
        assert!(install_baseline(&state, &root, second, fresh).unwrap().0.ready);
        assert_eq!(state.lock().budget_used, 100);
    }

    #[test]
    fn a_refresh_makes_the_text_as_it_is_the_starting_point() {
        let (_dir, root, state) = watched(&[("a.md", b"# A\n")], 1024);
        std::fs::write(root.join("a.md"), "# A, edited\n").unwrap();
        let old = state.lock().roots[&root].baseline.clone().unwrap();
        let (_, generation, _) = reset(&state, &root, 2_000).unwrap();
        install_baseline(&state, &root, generation, baseline::take(&root, None, 1024, &|_| false)).unwrap();
        // As if this burst had judged against the old baseline while the refresh ran.
        let judged = judge_all(&old, None, &BTreeSet::from([root.join("a.md")]), &BTreeMap::new());
        assert_eq!(judged[&root.join("a.md")], Some((Kind::File, Mark::Modified)));
        assert_eq!(burst(&state, &root, &["a.md"]).total, 0, "against the new baseline the edit is the starting point");
    }

    #[test]
    fn page_load_drops_every_record() {
        let (_dir, root, state) = watched(&[("a.md", &[b'a'; 100])], 1024);
        register(&state, Path::new("/p/other"), 2_000);
        let before = state.lock().last_generation;
        assert!(before > 0);
        let dropped = drop_all(&state);
        assert_eq!(dropped.len(), 2);
        assert!(dropped.contains_key(&root));
        let changes = state.lock();
        assert_eq!((changes.roots.len(), changes.budget_used, changes.last_generation), (0, 0, before), "generations keep counting across a reload");
    }

    /// As `watched`, but the root is a git repository with these files committed, and git answers for them.
    fn watched_repo(files: &[(&str, &[u8])]) -> (tempfile::TempDir, PathBuf, ChangesState, Git) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git::tests::repo_with(&root, files);
        let g = Git::find().expect("git is installed");
        let state = ChangesState::default();
        state.lock().roots.insert(root.clone(), Record::new(root.clone(), 1_000, 0));
        install_baseline(&state, &root, 0, baseline::take(&root, Some(&g), 1024, &|_| false)).unwrap();
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

    const EVERYWHERE: &dyn Fn(&Path) -> bool = &|_| true;

    fn view(state: &ChangesState, path: &Path, git: Option<&Git>) -> Result<diff::DiffView, ReaderError> {
        diff_view(state, path, EVERYWHERE, git, Path::new("/nowhere"), Path::new("/nowhere"))
    }

    fn rows(view: &diff::DiffView) -> Vec<String> {
        view.rows.iter().map(|r| format!("{:?} {}", r.kind, r.text)).collect()
    }

    #[test]
    fn diff_refuses_a_path_in_no_record() {
        let (_dir, root, state) = watched(&[("a.md", b"# A\n"), ("b.md", b"# B\n")], 1024);
        std::fs::write(root.join("a.md"), "# A, edited\n").unwrap();
        burst(&state, &root, &["a.md"]);
        // Unmarked, outside every root, or under a root the reader may no longer read: no door.
        for path in [root.join("b.md"), PathBuf::from("/etc/hosts"), root.clone()] {
            assert_eq!(view(&state, &path, None).unwrap_err().code, "not_watched", "{}", path.display());
        }
        let refused = diff_view(&state, &root.join("a.md"), &|_| false, None, Path::new("/"), Path::new("/")).unwrap_err();
        assert_eq!(refused.code, "not_watched");
        assert!(view(&state, &root.join("a.md"), None).is_ok());
    }

    #[test]
    fn a_modified_file_diffs_against_its_copy() {
        let (_dir, root, state) = watched(&[("notes.md", b"# Notes\n\nOne.\n")], 1024);
        std::fs::write(root.join("notes.md"), "# Notes\n\nOne.\nTwo.\n").unwrap();
        burst(&state, &root, &["notes.md"]);
        let v = view(&state, &root.join("notes.md"), None).unwrap();
        assert_eq!((v.mark, v.added, v.removed, v.since_ms, v.ext.as_str(), v.baseline_text.is_none()), (Mark::Modified, 1, 0, 1_000, "md", true));
        assert_eq!(rows(&v), ["Context # Notes", "Context ", "Context One.", "Add Two."]);
    }

    #[test]
    fn a_file_inside_an_added_folder_is_all_additions() {
        let (_dir, root, state) = watched(&[("README.md", b"# R\n")], 1024);
        std::fs::create_dir(root.join("research")).unwrap();
        std::fs::write(root.join("research/idea.md"), "# Idea\n\nNew.\n").unwrap();
        burst(&state, &root, &["research", "research/idea.md"]);
        let v = view(&state, &root.join("research/idea.md"), None).unwrap();
        assert_eq!((v.mark, v.added, v.removed), (Mark::Added, 3, 0));
    }

    #[test]
    fn a_deleted_file_is_all_removals_and_carries_its_old_text() {
        let (_dir, root, state) = watched(&[("old.md", b"# Old\n\nGone.\n")], 1024);
        std::fs::remove_file(root.join("old.md")).unwrap();
        burst(&state, &root, &["old.md"]);
        let v = view(&state, &root.join("old.md"), None).unwrap();
        assert_eq!((v.mark, v.added, v.removed), (Mark::Deleted, 0, 3));
        assert_eq!(v.baseline_text.as_deref(), Some("# Old\n\nGone.\n"));
    }

    #[test]
    fn a_deleted_file_s_old_text_is_the_record_s_and_only_for_a_deletion() {
        let (_dir, root, state) = watched(&[("old.md", b"# Old\n\nGone.\n"), ("kept.md", b"# Kept\n")], 1024);
        std::fs::remove_file(root.join("old.md")).unwrap();
        std::fs::write(root.join("kept.md"), "# Kept, edited\n").unwrap();
        burst(&state, &root, &["old.md", "kept.md"]);
        assert_eq!(old_text(&state, &root.join("old.md"), EVERYWHERE, None).unwrap(), (1_000, Mark::Deleted, b"# Old\n\nGone.\n".to_vec()));
        assert_eq!(old_text(&state, &root.join("kept.md"), EVERYWHERE, None).unwrap().1, Mark::Modified);
        assert_eq!(old_text(&state, &root.join("old.md"), &|_| false, None).unwrap_err().code, "not_watched");
    }

    #[test]
    fn no_copy_gives_the_reason_never_a_diff() {
        let (_dir, root, state) = watched(&[("big.md", b"# Too much for the budget\n")], 0);
        std::fs::write(root.join("big.md"), "# Changed\n").unwrap();
        assert_eq!(marked(&burst(&state, &root, &["big.md"]), &root), ["M big.md"]);
        let refused = view(&state, &root.join("big.md"), None).unwrap_err();
        assert_eq!(refused.code, "no_baseline");
        assert!(refused.message.starts_with("Kinas kept no copy of this file from "), "{}", refused.message);
        assert!(refused.message.ends_with(", so there is nothing to compare — the folder holds more text than Kinas keeps"), "{}", refused.message);
        assert_eq!(no_copy(0, NoCopy::TooLarge, Mark::Modified).message.rsplit(" — ").next(), Some("it is larger than 4 MB"));
        assert_eq!(no_copy(0, NoCopy::ChangedDuringCopy, Mark::Modified).message.rsplit(" — ").next(), Some("it changed while Kinas was taking its copies"));
        assert_eq!(no_copy(0, NoCopy::Image, Mark::Deleted).message, "This image was deleted; Kinas keeps no copy of images");
    }

    #[test]
    fn a_clean_tracked_file_diffs_against_its_blob() {
        let (_dir, root, state, g) = watched_repo(&[("README.md", b"# Read me\n")]);
        std::fs::write(root.join("README.md"), "# Read me\n\nA line.\n").unwrap();
        git_burst(&state, &root, &g, &["README.md"]);
        let v = view(&state, &root.join("README.md"), Some(&g)).unwrap();
        assert_eq!(rows(&v), ["Context # Read me", "Add ", "Add A line."]);
        // With no git to read the blob back, it says so rather than guessing.
        assert_eq!(view(&state, &root.join("README.md"), None).unwrap_err().code, "no_baseline");
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
