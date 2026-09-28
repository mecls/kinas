//! Crew marks (`tasks/crew-marks/prd.md`, ADR 0019): what the first mate's crew has changed in its own checkouts and
//! not pushed, marked on the captain's own file trees with a hollow dot.
//!
//! A worker edits a git worktree of the crew's clone of a project (`<home>/projects/<name>`), wherever `treehouse` put
//! it. A watched root's repository pairs with such a clone when both have the same GitHub `origin`; the clone's
//! worktree list names every checkout, and each checkout's unpushed set is plumbing against the commit its branch last
//! pushed. One thread per crew project follows its checkouts and its refs, derives the crew view of every paired root
//! off the guard, and installs it under the guard. Nothing is ever written in a crew checkout or its clone, and nothing
//! about the crew's work is stored or logged beyond counts.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::baseline::Stat;
use super::compare;
use super::git::{Git, Worktree};
use super::{ChangesState, FolderRollup, Mark, Millis, TreeChanges, BURST_CEILING, DEBOUNCE, TREE_CHANGED};
use crate::reader::access::Kind;
use crate::reader::listable_file;

/// What a checkout's unpushed set is measured against (PRD rule 4, Gate 2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Base {
    /// The commit its branch last pushed.
    Commit(String),
    /// Its own HEAD: a detached checkout, or a clone with no remote — only what is not committed counts.
    Head(String),
    /// Git could not say: no crew marks for this checkout, never a guessed one.
    Unknown,
}

/// A checkout's unpushed marks, by path relative to its top.
pub type CrewMarks = BTreeMap<PathBuf, (Kind, Mark)>;

/// One checkout's scan: its top, its base, its marks.
pub type CheckoutSet = (PathBuf, Base, CrewMarks);

/// One crew checkout: the clone, or a worktree git lists for it.
pub struct Checkout {
    base: Base,
    marks: CrewMarks,
    /// When Kinas saw each mark last change: "the one that changed it last" (PRD rule 14, Gate 2).
    seen: BTreeMap<PathBuf, Millis>,
    #[allow(dead_code)]
    watcher: Option<RecommendedWatcher>,
}

/// A crew clone some watched root pairs with: its checkouts, and the thread that follows them.
pub struct CrewProject {
    common: PathBuf,
    checkouts: BTreeMap<PathBuf, Checkout>,
    /// The thread's channel, for the checkouts' watches.
    feed: Option<Sender<CrewHeard>>,
    /// The clone's git folder, filtered to what moves an upstream or a worktree.
    #[allow(dead_code)]
    watcher: Option<RecommendedWatcher>,
}

impl CrewProject {
    pub(super) fn new() -> Self {
        CrewProject { common: PathBuf::new(), checkouts: BTreeMap::new(), feed: None, watcher: None }
    }
}

/// What reaches a crew project's thread.
#[derive(Debug)]
pub enum CrewHeard {
    /// Something changed in this checkout.
    Checkout(PathBuf),
    /// The clone's refs or its worktree list moved: re-list and recompute everything.
    Git,
}

/// One crew mark in a root's summary.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CrewEntry {
    pub path: String,
    pub kind: Kind,
    pub mark: Mark,
    /// How many crew checkouts mark it.
    pub tasks: u32,
    /// False for a crew row: a path the captain's folder does not have.
    pub here: bool,
}

/// Where the crew's text of a captain-side path is read from: the checkout that changed it last.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Source {
    pub checkout: PathBuf,
    pub rel: PathBuf,
    pub base: Base,
}

/// A root's crew view, derived from the crew's checkouts and installed in its record.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CrewView {
    pub entries: Vec<CrewEntry>,
    pub folders: Vec<FolderRollup>,
    pub total: u32,
    pub(super) sources: BTreeMap<PathBuf, Source>,
}

/// A checkout as the view derivation reads it, cloned out of the guard.
#[derive(Clone, Debug)]
pub(super) struct Snap {
    top: PathBuf,
    base: Base,
    marks: CrewMarks,
    seen: BTreeMap<PathBuf, Millis>,
}

/// `owner/name` of a repository top, and the crew clone under `<home>/projects/` with the same GitHub `origin`
/// (ADR 0018's reads: the names under `projects/`, each clone's `.git/config`). None: no GitHub remote, or no crew
/// project on it.
pub(super) fn pair(top: &Path, home: &Path) -> Option<(String, PathBuf)> {
    let repo = crate::crew::repo::origin_repo(top)?;
    let mut clones: Vec<PathBuf> = std::fs::read_dir(home.join("projects")).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    clones.sort();
    clones.into_iter().filter(|clone| clone != top).find(|clone| crate::crew::repo::clone_repo(home, &clone.to_string_lossy()).as_deref() == Some(repo.as_str())).map(|clone| (repo, clone))
}

/// The clone's shared git folder, and the checkouts git keeps for it. A listed path that is not the clone or a worktree
/// of it — its own git folder another's — is left out (the build spec's guardrail, §10).
pub(super) fn checkouts_of(git: &Git, clone: &Path) -> Option<(PathBuf, Vec<Worktree>)> {
    let common = git.common_dir(clone)?;
    let listed = git.worktrees(clone).ok()?;
    let checkouts = listed
        .into_iter()
        .filter_map(|mut wt| {
            wt.top = std::fs::canonicalize(&wt.top).ok()?;
            (git.common_dir(&wt.top).as_deref() == Some(common.as_path())).then_some(wt)
        })
        .collect();
    Some((common, checkouts))
}

/// PRD rule 4: what this checkout has changed and not pushed — against the commit its branch last pushed, filtered as
/// the tree lists paths (rule 5). Git failing gives `Base::Unknown` and nothing: a crew mark is never a guess.
pub(super) fn unpushed(git: &Git, wt: &Worktree) -> (Base, CrewMarks) {
    let top = &wt.top;
    let base = base_of(git, wt);
    let commit = match &base {
        Base::Commit(c) | Base::Head(c) => c.clone(),
        Base::Unknown => return (base, CrewMarks::new()),
    };
    let (Ok(changed), Ok(untracked)) = (git.changed_since(top, &commit), git.untracked(top)) else {
        return (Base::Unknown, CrewMarks::new());
    };
    let mut marks = CrewMarks::new();
    for (letter, path) in changed.into_iter().chain(untracked.into_iter().map(|p| ('A', p))) {
        if !compare::listable_path(top, &path) {
            continue;
        }
        let mark = match letter {
            'A' => Mark::Added,
            'D' => Mark::Deleted,
            _ => Mark::Modified,
        };
        // A binary, or a path that is not a file now, is not something the tree lists.
        if mark != Mark::Deleted && !listable_file(&path) {
            continue;
        }
        if let Ok(rel) = path.strip_prefix(top) {
            marks.insert(rel.to_path_buf(), (Kind::File, mark));
        }
    }
    (base, marks)
}

/// The commit a checkout's branch last pushed: its upstream, else `origin/<branch>` (the tree changes clear on push
/// order). A detached checkout, or a clone with no remote, is measured against its own HEAD: only what is not
/// committed counts. A branch never pushed is `Unknown` for now; git failing is `Unknown` always.
fn base_of(git: &Git, wt: &Worktree) -> Base {
    let head = || git.commit_of(&wt.top, "HEAD").ok().flatten().map_or(Base::Unknown, Base::Head);
    let Some(branch) = &wt.branch else { return head() };
    let found = git.commit_of(&wt.top, "@{upstream}").and_then(|up| match up {
        Some(c) => Ok(Some(c)),
        None => git.commit_of(&wt.top, &format!("refs/remotes/origin/{branch}")),
    });
    match found {
        Ok(Some(commit)) => Base::Commit(commit),
        Ok(None) if git.has_remote(&wt.top) == Ok(false) => head(),
        _ => Base::Unknown,
    }
}

/// A whole scan of a crew project, with no guard held: its checkouts, and each one's base and marks.
pub(super) fn scan(git: &Git, clone: &Path) -> Option<(PathBuf, Vec<CheckoutSet>)> {
    let (common, checkouts) = checkouts_of(git, clone)?;
    let sets = checkouts.iter().map(|wt| {
        let (base, marks) = unpushed(git, wt);
        (wt.top.clone(), base, marks)
    });
    Some((common, sets.collect()))
}

/// Installs a scan's results under the guard: checkouts added, kept with their marks replaced — each changed mark
/// stamped `now` in `seen` — or, when `whole`, dropped because git no longer lists them. Answers the tops that are new
/// (to watch) and the checkouts dropped (to drop outside the guard), and the number of unreadable checkouts.
pub(super) fn install_scan(state: &ChangesState, repo: &str, common: Option<PathBuf>, sets: Vec<CheckoutSet>, whole: bool, now: Millis) -> (Vec<PathBuf>, Vec<Checkout>, usize) {
    let mut changes = state.lock();
    let Some(project) = changes.crew.get_mut(repo) else {
        return (Vec::new(), Vec::new(), 0);
    };
    if let Some(common) = common {
        project.common = common;
    }
    let listed: BTreeSet<PathBuf> = sets.iter().map(|(top, ..)| top.clone()).collect();
    let mut dropped = Vec::new();
    if whole {
        let gone: Vec<PathBuf> = project.checkouts.keys().filter(|top| !listed.contains(*top)).cloned().collect();
        for top in gone {
            dropped.extend(project.checkouts.remove(&top));
        }
    }
    let mut new = Vec::new();
    let mut unknown = 0;
    for (top, base, marks) in sets {
        if base == Base::Unknown {
            unknown += 1;
        }
        let checkout = project.checkouts.entry(top.clone()).or_insert_with(|| {
            new.push(top.clone());
            Checkout { base: Base::Unknown, marks: CrewMarks::new(), seen: BTreeMap::new(), watcher: None }
        });
        checkout.seen.retain(|rel, _| marks.contains_key(rel));
        for (rel, mark) in &marks {
            if checkout.marks.get(rel) != Some(mark) {
                checkout.seen.insert(rel.clone(), now);
            }
        }
        checkout.base = base;
        checkout.marks = marks;
    }
    (new, dropped, unknown)
}

/// Rules 3, 6 and 9: one root's crew view. Each paired repository top's crew marks map to the same path under it;
/// several checkouts on one path give one mark, the strongest, with their count, and the text is read from the one
/// that changed it last. Only paths under the root, and — for now — only paths the captain's folder has.
pub(super) fn derive_view(root: &Path, tops: &[(PathBuf, String)], snaps: &HashMap<String, Vec<Snap>>) -> CrewView {
    struct Acc {
        kind: Kind,
        mark: Mark,
        tasks: u32,
        seen: Millis,
        source: Source,
    }
    let mut acc: BTreeMap<PathBuf, Acc> = BTreeMap::new();
    for (top, repo) in tops {
        for snap in snaps.get(repo).into_iter().flatten() {
            for (rel, &(kind, mark)) in &snap.marks {
                let path = top.join(rel);
                if path == root || !path.starts_with(root) {
                    continue;
                }
                let seen = snap.seen.get(rel).copied().unwrap_or(0);
                let source = Source { checkout: snap.top.clone(), rel: rel.clone(), base: snap.base.clone() };
                match acc.get_mut(&path) {
                    Some(a) => {
                        a.mark = compare::strongest(a.mark, mark);
                        a.tasks += 1;
                        if seen >= a.seen {
                            a.seen = seen;
                            a.source = source;
                        }
                    }
                    None => {
                        acc.insert(path, Acc { kind, mark, tasks: 1, seen, source });
                    }
                }
            }
        }
    }
    // The captain's side: a path their folder does not have gets no row yet.
    acc.retain(|path, _| Stat::of(path).is_some());
    let marks: BTreeMap<PathBuf, (Kind, Mark)> = acc.iter().map(|(p, a)| (p.clone(), (a.kind, a.mark))).collect();
    let (folders, total) = compare::rollups(root, &marks, &|_| 0);
    CrewView {
        entries: acc.iter().map(|(p, a)| CrewEntry { path: p.display().to_string(), kind: a.kind, mark: a.mark, tasks: a.tasks, here: true }).collect(),
        folders,
        total,
        sources: acc.into_iter().map(|(p, a)| (p, a.source)).collect(),
    }
}

/// Every root paired with `repo`, its crew view derived again and installed where it changed. Three steps: what to
/// derive from, under the guard; the derivation and its stats, without; the install, under it again. Answers the
/// summaries to emit.
pub(super) fn refresh_views(state: &ChangesState, repo: &str) -> Vec<TreeChanges> {
    let (roots, snaps) = {
        let changes = state.lock();
        let roots: Vec<(PathBuf, Vec<(PathBuf, String)>)> = changes.roots.values().filter(|r| r.crew_repos.iter().any(|(_, x)| x == repo)).map(|r| (r.root.clone(), r.crew_repos.clone())).collect();
        let wanted: BTreeSet<&String> = roots.iter().flat_map(|(_, tops)| tops.iter().map(|(_, x)| x)).collect();
        let snaps: HashMap<String, Vec<Snap>> = wanted
            .into_iter()
            .filter_map(|x| changes.crew.get(x).map(|p| (x.clone(), p.checkouts.iter().map(|(top, c)| Snap { top: top.clone(), base: c.base.clone(), marks: c.marks.clone(), seen: c.seen.clone() }).collect())))
            .collect();
        (roots, snaps)
    };
    let views: Vec<(PathBuf, CrewView)> = roots.iter().map(|(root, tops)| (root.clone(), derive_view(root, tops, &snaps))).collect();
    let mut changes = state.lock();
    let super::Changes { roots: records, repos, .. } = &mut *changes;
    views
        .into_iter()
        .filter_map(|(root, view)| {
            let record = records.get_mut(&root)?;
            if record.crew == view {
                return None;
            }
            let touched: Vec<PathBuf> = view.entries.iter().chain(record.crew.entries.iter()).filter_map(|e| Path::new(&e.path).parent().map(Path::to_path_buf)).collect::<BTreeSet<_>>().into_iter().collect();
            record.crew = view;
            Some(super::summary(record, repos, touched))
        })
        .collect()
}

/// A root's repositories paired with the crew's clones, recorded on it; answers the projects it pairs with that have
/// no thread yet (their `CrewProject` inserted, so a second root racing this one starts nothing).
pub(super) fn pair_root(state: &ChangesState, root: &Path, home: &Path) -> Vec<(String, PathBuf)> {
    let tops: Vec<PathBuf> = {
        let changes = state.lock();
        let Some(baseline) = changes.roots.get(root).and_then(|r| r.baseline.clone()) else { return Vec::new() };
        baseline.repos.iter().map(|r| r.top.clone()).collect()
    };
    let pairs: Vec<(PathBuf, String, PathBuf)> = tops.into_iter().filter_map(|top| pair(&top, home).map(|(repo, clone)| (top, repo, clone))).collect();
    let mut changes = state.lock();
    if let Some(record) = changes.roots.get_mut(root) {
        record.crew_repos = pairs.iter().map(|(top, repo, _)| (top.clone(), repo.clone())).collect();
    }
    let mut start = Vec::new();
    for (_, repo, clone) in pairs {
        if !changes.crew.contains_key(&repo) {
            changes.crew.insert(repo.clone(), CrewProject::new());
            start.push((repo, clone));
        }
    }
    start
}

/// After a root's baseline is installed: pair it with the crew, start a thread for each project new to it, and give it
/// the crew view of the projects already followed. Nothing when Firstmate has no home here, or git cannot run.
pub(super) fn attach(app: &AppHandle, root: &Path) {
    let Some(git) = Git::find() else { return };
    let Ok(data) = crate::paths::data_dir(app) else { return };
    let home = crate::crew::home::home_in(&data);
    if !home.join("projects").is_dir() {
        return;
    }
    let state = app.state::<ChangesState>();
    for (repo, clone) in pair_root(&state, root, &home) {
        start_project(app, repo, clone, git.clone());
    }
    let repos: BTreeSet<String> = state.lock().roots.get(root).map(|r| r.crew_repos.iter().map(|(_, x)| x.clone()).collect()).unwrap_or_default();
    for repo in repos {
        for summary in refresh_views(&state, &repo) {
            let _ = app.emit(TREE_CHANGED, summary);
        }
    }
}

/// The crew project's `tree-changes-crew` thread: a whole scan first, then one per `Git` burst and one checkout per
/// `Checkout` burst, each followed by the views of every paired root.
fn start_project(app: &AppHandle, repo: String, clone: PathBuf, git: Git) {
    let (tx, rx) = mpsc::channel::<CrewHeard>();
    {
        let state = app.state::<ChangesState>();
        let mut changes = state.lock();
        if let Some(project) = changes.crew.get_mut(&repo) {
            project.feed = Some(tx.clone());
        }
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("tree-changes-crew".into()).spawn(move || {
        let state = app.state::<ChangesState>();
        let mut first = true;
        let mut next = move || -> Option<(bool, BTreeSet<PathBuf>)> {
            if first {
                first = false;
                return Some((true, BTreeSet::new()));
            }
            debounce_crew(&rx, DEBOUNCE, BURST_CEILING)
        };
        while let Some((whole, tops)) = next() {
            let started = Instant::now();
            let (common, sets) = if whole {
                match scan(&git, &clone) {
                    Some((common, sets)) => (Some(common), sets),
                    None => continue,
                }
            } else {
                let checkouts: Vec<Worktree> = {
                    let changes = state.lock();
                    changes.crew.get(&repo).map(|p| p.checkouts.keys().filter(|t| tops.contains(*t)).map(|t| Worktree { top: t.clone(), head: None, branch: None }).collect()).unwrap_or_default()
                };
                let sets = checkouts.into_iter().map(|wt| {
                    // The branch is read again: a worker may have switched it.
                    let branch = git.branch(&wt.top).ok().flatten();
                    let wt = Worktree { branch, ..wt };
                    let (base, marks) = unpushed(&git, &wt);
                    (wt.top, base, marks)
                });
                (None, sets.collect())
            };
            let marks: usize = sets.iter().map(|(_, _, m)| m.len()).sum();
            let checkouts = sets.len();
            let (new, dropped, unknown) = install_scan(&state, &repo, common.clone(), sets, whole, crate::store::now_ms());
            drop(dropped);
            if let Some(common) = common {
                watch_common(&app, &repo, &common, tx.clone());
            }
            for top in new {
                watch_checkout(&app, &repo, &top, tx.clone());
            }
            let summaries = refresh_views(&state, &repo);
            if !summaries.is_empty() {
                // Counts and a duration, never a path.
                log::info!("tree changes: the crew, {checkouts} checkouts, {marks} marks in {} ms", started.elapsed().as_millis());
            }
            if unknown > 0 {
                log::info!("tree changes: the crew, {unknown} checkouts git could not read");
            }
            for summary in summaries {
                let _ = app.emit(TREE_CHANGED, summary);
            }
        }
    });
    if let Err(e) = spawned {
        log::error!("tree changes: could not start the crew thread: {e}");
    }
}

/// Collects checkout events into a set, and a `Git` event into the whole-scan flag, until `quiet` passes with none or
/// the burst has been open for `ceiling`. None when every sender is gone.
fn debounce_crew(rx: &Receiver<CrewHeard>, quiet: Duration, ceiling: Duration) -> Option<(bool, BTreeSet<PathBuf>)> {
    let first = rx.recv().ok()?;
    let opened = Instant::now();
    let (mut whole, mut tops) = (false, BTreeSet::new());
    let mut take = |heard: CrewHeard| match heard {
        CrewHeard::Git => whole = true,
        CrewHeard::Checkout(top) => {
            tops.insert(top);
        }
    };
    take(first);
    loop {
        let left = ceiling.saturating_sub(opened.elapsed());
        if left.is_zero() {
            break;
        }
        match rx.recv_timeout(quiet.min(left)) {
            Ok(heard) => take(heard),
            Err(_) => break,
        }
    }
    Some((whole, tops))
}

/// A recursive watch on one crew checkout, passing on only what the tree could list, so `.git`, `node_modules` and a
/// build folder never wake the thread.
fn watch_checkout(app: &AppHandle, repo: &str, top: &Path, tx: Sender<CrewHeard>) {
    let filter = top.to_path_buf();
    let watched = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if event.need_rescan() || event.paths.iter().any(|p| compare::listable_path(&filter, p)) {
                let _ = tx.send(CrewHeard::Checkout(filter.clone()));
            }
        }
    })
    .and_then(|mut w| w.watch(top, RecursiveMode::Recursive).map(|()| w));
    match watched {
        Ok(watcher) => {
            let state = app.state::<ChangesState>();
            let spare = {
                let mut changes = state.lock();
                match changes.crew.get_mut(repo).and_then(|p| p.checkouts.get_mut(top)) {
                    Some(checkout) => checkout.watcher.replace(watcher),
                    None => Some(watcher),
                }
            };
            drop(spare);
        }
        Err(e) => log::warn!("tree changes: could not watch a crew checkout ({})", super::error_kind(&e)),
    }
}

/// The clone's git folder, filtered to what moves an upstream (tree changes' `ref_path`) or adds and removes a
/// worktree (an entry directly under `worktrees/`). Started once per project.
fn watch_common(app: &AppHandle, repo: &str, common: &Path, tx: Sender<CrewHeard>) {
    let state = app.state::<ChangesState>();
    if state.lock().crew.get(repo).is_none_or(|p| p.watcher.is_some()) {
        return;
    }
    let filter = common.to_path_buf();
    let watched = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            let moved = event.need_rescan() || event.paths.iter().any(|p| super::ref_path(&filter, p) || p.strip_prefix(&filter).is_ok_and(|rel| rel.starts_with("worktrees") && rel.components().count() == 2));
            if moved {
                let _ = tx.send(CrewHeard::Git);
            }
        }
    })
    .and_then(|mut w| w.watch(common, RecursiveMode::Recursive).map(|()| w));
    match watched {
        Ok(watcher) => {
            let spare = {
                let mut changes = state.lock();
                match changes.crew.get_mut(repo) {
                    Some(project) if project.watcher.is_none() => {
                        project.watcher = Some(watcher);
                        None
                    }
                    _ => Some(watcher),
                }
            };
            drop(spare);
        }
        Err(e) => log::warn!("tree changes: could not watch a crew checkout ({})", super::error_kind(&e)),
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::super::git::tests::{git, repo_with};
    use super::super::tests::{install_with_git, watched_root};
    use super::*;

    const URL: &str = "https://github.com/kinas-test/shop.git";

    /// A captain's repository and the crew's clone of the same GitHub repository (a bare remote behind `insteadOf`, so
    /// the config reads github.com and git pushes to the folder), with a worker's worktree outside the home on a
    /// pushed branch. Answers (dir, captain, home, clone, worktree).
    pub(crate) fn crew_fixture(files: &[(&str, &[u8])]) -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        let remote = base.join("remote.git");
        std::fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "-q", "--bare"]);
        let instead = format!("url.{}.insteadOf", remote.display());
        let captain = base.join("root/shop");
        std::fs::create_dir_all(&captain).unwrap();
        repo_with(&captain, files);
        git(&captain, &["remote", "add", "origin", URL]);
        git(&captain, &["config", &instead, URL]);
        git(&captain, &["push", "-q", "-u", "origin", "main"]);
        let home = base.join("data/firstmate");
        std::fs::create_dir_all(home.join("projects")).unwrap();
        git(&home.join("projects"), &["-c", &format!("{instead}={URL}"), "clone", "-q", URL, "shop"]);
        let clone = home.join("projects/shop");
        git(&clone, &["config", &instead, URL]);
        let worktree = base.join("treehouse/shop-1/1/shop");
        git(&clone, &["worktree", "add", "-q", &worktree.to_string_lossy(), "-b", "fm/task"]);
        git(&worktree, &["push", "-q", "-u", "origin", "fm/task"]);
        (dir, captain, home, clone, worktree)
    }

    /// The captain's folder watched, paired, and the crew project scanned and installed, as `attach` and the thread
    /// do — without a watch or a thread. Answers the state and the pairing's repo.
    pub(crate) fn crew_watched(captain: &Path, home: &Path, git_: &Git) -> (ChangesState, String, PathBuf) {
        let state = watched_root(captain);
        install_with_git(&state, captain, git_);
        let started = pair_root(&state, captain, home);
        assert_eq!(started.len(), 1, "the captain's repository pairs with the crew's clone");
        let (repo, clone) = started[0].clone();
        crew_rescan(&state, &repo, &clone, git_, 5_000);
        (state, repo, clone)
    }

    /// A whole scan of the project, installed at `now`, and the views of every paired root derived.
    pub(crate) fn crew_rescan(state: &ChangesState, repo: &str, clone: &Path, git_: &Git, now: Millis) -> Vec<TreeChanges> {
        let (common, sets) = scan(git_, clone).expect("the clone scans");
        install_scan(state, repo, Some(common), sets, true, now);
        refresh_views(state, repo)
    }

    fn crew_marked(state: &ChangesState, root: &Path) -> Vec<String> {
        state.lock().roots[root].crew.entries.iter().map(|e| format!("{} {} {}", serde_json::to_value(e.mark).unwrap().as_str().unwrap(), Path::new(&e.path).strip_prefix(root).unwrap().display(), e.tasks)).collect()
    }

    #[test]
    fn pairing_is_by_remote_not_name() {
        let (dir, captain, home, clone, _) = crew_fixture(&[("README.md", b"# Shop\n")]);
        assert_eq!(pair(&captain, &home), Some(("kinas-test/shop".into(), clone.clone())));
        // Another clone under `projects/` with another remote pairs with nothing of the captain's.
        let other = home.join("projects/other");
        std::fs::create_dir(&other).unwrap();
        repo_with(&other, &[("a.md", b"# A\n")]);
        git(&other, &["remote", "add", "origin", "https://github.com/kinas-test/other.git"]);
        assert_eq!(pair(&captain, &home), Some(("kinas-test/shop".into(), clone)));
        // The same folder name on another remote, and a repository with no GitHub remote, pair with nothing.
        let base = dir.path().canonicalize().unwrap();
        let namesake = base.join("elsewhere/shop");
        std::fs::create_dir_all(&namesake).unwrap();
        repo_with(&namesake, &[("a.md", b"# A\n")]);
        git(&namesake, &["remote", "add", "origin", "https://github.com/someone-else/shop.git"]);
        assert_eq!(pair(&namesake, &home), None);
        let local = base.join("local");
        std::fs::create_dir(&local).unwrap();
        repo_with(&local, &[("a.md", b"# A\n")]);
        assert_eq!(pair(&local, &home), None);
        assert_eq!(pair(&captain, &base.join("no-home")), None, "no Firstmate home, no crew");
    }

    #[test]
    fn a_crew_worktree_s_edit_marks_the_captain_s_row_until_it_is_pushed() {
        let (_dir, captain, home, _clone, worktree) = crew_fixture(&[("README.md", b"# Shop\n"), ("docs/plan.md", b"# Plan\n")]);
        let g = Git::find().expect("git is installed");
        let (state, repo, clone) = crew_watched(&captain, &home, &g);
        assert_eq!(crew_marked(&state, &captain), Vec::<String>::new(), "nothing unpushed yet");

        std::fs::write(worktree.join("README.md"), "# Shop, by the crew\n").unwrap();
        let summaries = crew_rescan(&state, &repo, &clone, &g, 6_000);
        assert_eq!(summaries.len(), 1, "the captain's root is told");
        assert_eq!(summaries[0].crew_total, 1);
        assert_eq!(crew_marked(&state, &captain), ["M README.md 1"]);
        assert!(summaries[0].crew[0].here);

        // Committed, still not pushed: still marked. Pushed: gone.
        git(&worktree, &["commit", "-qam", "the crew's edit"]);
        crew_rescan(&state, &repo, &clone, &g, 7_000);
        assert_eq!(crew_marked(&state, &captain), ["M README.md 1"]);
        git(&worktree, &["push", "-q"]);
        crew_rescan(&state, &repo, &clone, &g, 8_000);
        assert_eq!(crew_marked(&state, &captain), Vec::<String>::new());
        // The captain's own marks were never touched.
        assert!(state.lock().roots[&captain].marks.is_empty());
    }
}
