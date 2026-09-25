//! The crew's collector (build spec §6.6, §11.3): the thread `kinas-crew` runs Firstmate's fleet snapshot when the
//! schedule allows, parses it, and writes the mirror in one transaction under one guard — never holding the store
//! across the script (§6.15). Kinas reads the fleet this way only: no file under the home is opened except to learn
//! that one of the two trigger files changed.

pub mod gh;
mod guard;
pub mod mirror;
pub mod schedule;
pub mod snapshot;
pub mod word;

use super::runtime::{watch_with, ReaderControl, CREW_CHANGED};
use crate::crew::pin::WORKSPACE_LABEL;
use crate::crew::{firstmate, home, repo};
use crate::herdr::{self, View};
use crate::proc::{Exit, Ran};
use crate::redact::{write_reader_status, Outcome, Reader};
use crate::store::{now_ms, Store};
use schedule::{CrewWake, Schedule};
use mirror::Found;
use snapshot::{parse_fleet, pr_url_ok, Fleet};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// A trigger file must be quiet this long before the snapshot runs: Firstmate rewrites the backlog in bursts.
const FILE_DEBOUNCE: Duration = Duration::from_millis(500);

/// The two files whose change means the fleet changed. Their contents are never read (§6.5).
const TRIGGERS: [&str; 2] = ["backlog.md", "home-summary.json"];

/// The chrome asks for a fresher Herdr view once the one it has is this old (§4 Work: polled every 5 s).
pub(crate) const HERDR_FRESH_MS: i64 = 5_000;
/// Herdr is asked at most this often for the chrome's sake.
const HERDR_MIN_GAP_MS: i64 = 2_000;
/// The start focus happens only if Herdr answered within this long of the thread starting (§6.18, rule 22).
const START_FOCUS_MS: i64 = 10_000;
/// A PR is asked of `gh` again once its last check is this old: 60 s while the Crew page shows, 300 s otherwise.
const PR_FRESH_VISIBLE_MS: i64 = 60_000;
const PR_FRESH_HIDDEN_MS: i64 = 300_000;

/// Herdr's last answer (build spec §11.2): the session's view and the focused pane's foreground programs, shared
/// with the commands (the Crew page's running state, the chrome) behind a lock no one holds across a process.
#[derive(Debug, Clone, Default)]
pub(crate) struct LiveView {
    pub view: Option<View>,
    /// The focused pane's foreground `argv0`s.
    pub focused_foreground: Vec<String>,
    pub observed_at: i64,
    /// A worker's pane → its task's word and harness, from the last cycle, for the chrome's badge.
    pub worker_words: HashMap<String, (&'static str, Option<String>)>,
}

impl LiveView {
    /// The first mate's workspace is in the session: the Crew page reads as running.
    pub(crate) fn first_mate_there(&self) -> bool {
        self.view.as_ref().is_some_and(|v| herdr::workspace_with_label(v, WORKSPACE_LABEL).is_some())
    }
}

/// What the collector knows that the store does not hold, shared with the commands.
#[derive(Default)]
pub(crate) struct CrewLive {
    generated: Mutex<Option<String>>,
    live: RwLock<LiveView>,
    /// Each PR's checks by URL as `gh` last listed them, for the task detail's ChecksList: names are not stored.
    checks: Mutex<HashMap<String, Vec<(String, String)>>>,
    /// The GitHub repositories of Firstmate's clones under `<home>/projects/`: already in the crew, for Add to crew.
    project_repos: Mutex<Vec<String>>,
}

impl CrewLive {
    /// The repositories Firstmate already has a clone of, as of the last cycle.
    pub(crate) fn project_repos(&self) -> Vec<String> {
        self.project_repos.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    /// A PR's checks as `gh` last listed them this run; empty before it answered.
    pub(crate) fn checks_of(&self, url: &str) -> Vec<(String, String)> {
        self.checks.lock().unwrap_or_else(|p| p.into_inner()).get(url).cloned().unwrap_or_default()
    }

    /// The last good snapshot's `generated`, for the Crew page's `as of` caption.
    pub(crate) fn generated(&self) -> Option<String> {
        self.generated.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub(crate) fn live(&self) -> LiveView {
        self.live.read().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn set_live(&self, live: LiveView) {
        *self.live.write().unwrap_or_else(|p| p.into_inner()) = live;
    }

    fn set_worker_words(&self, words: HashMap<String, (&'static str, Option<String>)>) {
        self.live.write().unwrap_or_else(|p| p.into_inner()).worker_words = words;
    }
}

/// The session the Work pane attaches — Herdr's own for the crew — or None when the pane is a plain shell (a debug
/// switch), and then Kinas asks Herdr nothing: no spec's shell may reach `default`.
pub(crate) fn attached_session() -> Option<String> {
    let pane = crate::pty::pane_session();
    (!pane.shell).then_some(pane.session)
}

/// Asks Herdr for the session's view and the focused pane's foreground, and keeps it. None when Herdr did not answer.
fn refresh_live(app: &AppHandle) -> Option<View> {
    let now = now_ms();
    let crew = app.state::<CrewLive>();
    let previous = crew.live();
    let answer = attached_session().and_then(|_| herdr::find_herdr()).and_then(|bin| {
        let view = herdr::api_snapshot(&bin).ok()?;
        let fg = view.focused_pane.as_deref().map(|p| herdr::foreground(&bin, p).unwrap_or_default()).unwrap_or_default();
        Some((view, fg))
    });
    let (view, focused_foreground) = match answer {
        Some((v, fg)) => (Some(v), fg),
        None => (None, Vec::new()),
    };
    let was_there = previous.first_mate_there();
    let live = LiveView { view: view.clone(), focused_foreground, observed_at: now, worker_words: previous.worker_words };
    let now_there = live.first_mate_there();
    crew.set_live(live);
    if was_there != now_there {
        let _ = app.emit(CREW_CHANGED, ());
    }
    view
}

/// Once per run, when Herdr's first answer came within 10 s of the thread starting: focus an existing `firstmate`
/// workspace, so the pane opens on the first mate (§6.18). Never again without a click.
fn start_focus(started_at: i64, answered_at: i64, view: &View) -> Option<String> {
    (answered_at - started_at <= START_FOCUS_MS).then(|| herdr::workspace_with_label(view, WORKSPACE_LABEL).map(|w| w.id.clone())).flatten()
}

/// What the collector remembers between cycles, in memory only: each clone's repository (read once per `project` this
/// run) and when each PR was last asked of `gh`.
#[derive(Default)]
struct Memo {
    repos: HashMap<String, Option<String>>,
    pr_checked: HashMap<String, i64>,
}

pub(crate) fn crew_loop(app: AppHandle, home: PathBuf, tx: Sender<CrewWake>, rx: Receiver<CrewWake>) {
    let started_at = now_ms();
    let mut schedule = Schedule::new();
    let mut memo = Memo::default();
    let mut watcher: Option<notify::RecommendedWatcher> = None;
    // The first cycle runs at once.
    let mut due: Option<i64> = Some(now_ms());
    // The start focus is decided on Herdr's first answer, whenever it comes, and only then.
    let mut first_answer_seen = false;
    let mut last_herdr: i64 = 0;
    // A Herdr-only refresh asked for sooner than 2 s after the last one waits for the gap, never dropped: the launcher
    // asks right after it changed the session, and a dropped ask left the page reading the old session for minutes.
    let mut herdr_pending = false;
    loop {
        // Watched once the home exists: `kinas crew setup` may create it while Kinas runs.
        if watcher.is_none() {
            watcher = watch_home(&home, tx.clone());
        }
        schedule.set_visible(app.state::<ReaderControl>().crew_visible());
        let now = now_ms();
        let cycle_at = due.map_or_else(|| schedule.run_at(&CrewWake::Tick, now), |d| d.min(schedule.run_at(&CrewWake::Tick, now)));
        let herdr_at = if herdr_pending { last_herdr + HERDR_MIN_GAP_MS } else { i64::MAX };
        let next = cycle_at.min(herdr_at);
        match rx.recv_timeout(Duration::from_millis(next.saturating_sub(now).max(0) as u64)) {
            Ok(CrewWake::Herdr) => herdr_pending = true,
            Ok(wake) => {
                let mut wakes = vec![wake];
                if wake == CrewWake::File {
                    // Quiet for 500 ms first; whatever else arrives meanwhile joins this run.
                    while let Ok(more) = rx.recv_timeout(FILE_DEBOUNCE) {
                        match more {
                            CrewWake::Herdr => herdr_pending = true,
                            other => wakes.push(other),
                        }
                    }
                }
                let now = now_ms();
                for wake in wakes {
                    if wake == CrewWake::Manual {
                        // Refresh readings means fresh everything: the backoff, and every PR asked of `gh` again.
                        schedule.reset();
                        memo.pr_checked.clear();
                    }
                    let at = schedule.run_at(&wake, now);
                    due = Some(due.map_or(at, |d| d.min(at)));
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let now = now_ms();
        let cycle_at = due.map_or_else(|| schedule.run_at(&CrewWake::Tick, now), |d| d.min(schedule.run_at(&CrewWake::Tick, now)));
        if now >= cycle_at {
            // A cycle asks Herdr too, so it answers a pending Herdr ask as well.
            let ok = cycle(&app, &home, started_at, &mut first_answer_seen, &mut memo);
            last_herdr = now_ms();
            herdr_pending = false;
            schedule.finished(now_ms(), ok);
            due = None;
        } else if herdr_pending && now - last_herdr >= HERDR_MIN_GAP_MS {
            // Herdr only, for the chrome or after a launch.
            last_herdr = now;
            herdr_pending = false;
            let view = refresh_live(&app);
            first_answer(&app, started_at, &mut first_answer_seen, view.as_ref());
        }
    }
}

/// The start focus, decided on Herdr's first answer only.
fn first_answer(app: &AppHandle, started_at: i64, seen: &mut bool, view: Option<&View>) {
    let Some(view) = view else { return };
    if std::mem::replace(seen, true) {
        return;
    }
    if let Some(id) = start_focus(started_at, now_ms(), view) {
        if herdr::find_herdr().is_some_and(|bin| herdr::workspace_focus(&bin, &id).is_ok()) {
            log::info!("crew: focused the first mate at start");
            // The chrome reads the pane that is focused now.
            app.state::<ReaderControl>().crew_herdr();
        }
    }
}

/// One cycle: the snapshot, the parse, Herdr's view, the write, the log line, `crew_changed`. Returns whether the
/// snapshot succeeded.
fn cycle(app: &AppHandle, home: &Path, started_at: i64, first_answer_seen: &mut bool, memo: &mut Memo) -> bool {
    let started = Instant::now();
    // Herdr is asked whether or not Firstmate is installed: the chrome and the start focus need its view.
    let view = refresh_live(app);
    first_answer(app, started_at, first_answer_seen, view.as_ref());
    if !home::installed(home) {
        let store = app.state::<Store>();
        let conn = store.conn();
        let _ = write_reader_status(&conn, store.org_id(), Reader::Crew, Outcome::NotConfigured("Firstmate isn't installed"), now_ms());
        drop(conn);
        changed(app);
        return true;
    }
    // The script, the clones' configs and `gh` all run with no guard held.
    let outcome = firstmate::fleet_snapshot(home).and_then(|ran| read(&ran));
    let projects = project_repos(home, memo);
    *app.state::<CrewLive>().project_repos.lock().unwrap_or_else(|p| p.into_inner()) = projects;
    let found = match &outcome {
        Ok(fleet) => {
            let visible = app.state::<ReaderControl>().crew_visible();
            Found {
                workers: mirror::workers_of(fleet, view.as_ref(), attached_session().as_deref()),
                repos: repos_of(fleet, home, memo),
                prs: prs_of(app, fleet, memo, visible),
            }
        }
        Err(_) => Found::default(),
    };
    let written = {
        let store = app.state::<Store>();
        let mut conn = store.conn();
        let written = mirror::record(&mut conn, store.org_id(), &outcome, &found, now_ms());
        let words = crate::crew::read::worker_words(&conn, store.org_id()).unwrap_or_default();
        drop(conn);
        app.state::<CrewLive>().set_worker_words(words);
        written
    };
    let ms = started.elapsed().as_millis();
    let ok = match (&outcome, &written) {
        (Ok(fleet), Ok(_)) => {
            *app.state::<CrewLive>().generated.lock().unwrap_or_else(|p| p.into_inner()) = Some(fleet.generated.clone());
            log::info!("crew: snapshot {} tasks, {} decisions in {ms} ms", fleet.tasks.len(), fleet.decision_count());
            true
        }
        _ => {
            log::info!("crew: snapshot failed in {ms} ms");
            false
        }
    };
    changed(app);
    ok
}

/// The repositories of Firstmate's clones, one per folder under `<home>/projects/`, each read once per run.
fn project_repos(home: &Path, memo: &mut Memo) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(home.join("projects")) else { return Vec::new() };
    let mut repos: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let path = e.path().display().to_string();
            memo.repos.entry(path.clone()).or_insert_with(|| repo::clone_repo(home, &path)).clone()
        })
        .collect();
    repos.sort_unstable();
    repos.dedup();
    repos
}

/// Each task's repository by id, from its clone, read once per clone path this run (§7): only under
/// `<home>/projects/`.
fn repos_of(fleet: &Fleet, home: &Path, memo: &mut Memo) -> HashMap<String, Option<String>> {
    fleet
        .tasks
        .iter()
        .filter_map(|t| {
            let path = mirror::clone_path(t, home)?;
            let repo = memo.repos.entry(path.clone()).or_insert_with(|| repo::clone_repo(home, &path)).clone();
            Some((t.id.clone(), repo))
        })
        .collect()
}

/// The PRs of tasks not yet done whose last check is older than the page's gap, each through `gh pr view` (10 s). A PR
/// `gh` could not read keeps its last values; it is asked again after the same gap, never in a tight loop.
fn prs_of(app: &AppHandle, fleet: &Fleet, memo: &mut Memo, visible: bool) -> Vec<gh::PrFacts> {
    let gap = if visible { PR_FRESH_VISIBLE_MS } else { PR_FRESH_HIDDEN_MS };
    let now = now_ms();
    let mut urls: Vec<&str> = fleet
        .tasks
        .iter()
        .filter(|t| !mirror::done_now(t))
        .filter_map(|t| t.pr_url.as_deref())
        .filter(|url| pr_url_ok(url) && memo.pr_checked.get(*url).is_none_or(|at| now - at >= gap))
        .collect();
    urls.sort_unstable();
    urls.dedup();
    if urls.is_empty() {
        return Vec::new();
    }
    let started = Instant::now();
    let prs: Vec<gh::PrFacts> = urls
        .iter()
        .filter_map(|url| {
            memo.pr_checked.insert((*url).to_string(), now);
            gh::pr_view(url).ok()
        })
        .collect();
    log::info!("crew: gh {} PRs in {} ms", urls.len(), started.elapsed().as_millis());
    let live = app.state::<CrewLive>();
    let mut checks = live.checks.lock().unwrap_or_else(|p| p.into_inner());
    for pr in &prs {
        checks.insert(pr.url.clone(), pr.checks.clone());
    }
    prs
}

/// The script's answer as a fleet, or the reason it is not one — for `reader_status` and the Crew page's error line,
/// never for the log (the last stderr line can name a task).
fn read(ran: &Ran) -> Result<Fleet, String> {
    let exited = |how: String| match &ran.last_err {
        Some(line) => format!("the fleet snapshot {how}: {line}"),
        None => format!("the fleet snapshot {how}"),
    };
    match ran.exit {
        Exit::Code(0) => parse_fleet(&ran.stdout),
        Exit::Code(code) => Err(exited(format!("exited {code}"))),
        Exit::Signal => Err(exited("was stopped by a signal".into())),
        Exit::TimedOut => Err("the fleet snapshot did not answer within 20 s".into()),
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit(CREW_CHANGED, ());
    crate::tray::refresh(app);
}

/// `<home>/data` and `<home>/state`, filtered to the two trigger files; `None` until both folders exist.
fn watch_home(home: &Path, tx: Sender<CrewWake>) -> Option<notify::RecommendedWatcher> {
    let data = home.join("data");
    let state = home.join("state");
    if !data.is_dir() || !state.is_dir() {
        return None;
    }
    watch_with(&[&data, &state], notify::RecursiveMode::NonRecursive, move |event: notify::Event| {
        let hit = event.paths.iter().any(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| TRIGGERS.contains(&n)));
        if hit {
            let _ = tx.send(CrewWake::File);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ran(exit: Exit, stdout: &str, last_err: Option<&str>) -> Ran {
        Ran { exit, stdout: stdout.into(), first_err: None, last_err: last_err.map(str::to_string), elapsed: Duration::ZERO }
    }

    #[test]
    fn a_script_that_fails_says_how() {
        assert_eq!(read(&ran(Exit::Code(2), "", Some("jq: command not found"))).unwrap_err(), "the fleet snapshot exited 2: jq: command not found");
        assert_eq!(read(&ran(Exit::Code(1), "", None)).unwrap_err(), "the fleet snapshot exited 1");
        assert_eq!(read(&ran(Exit::TimedOut, "", Some("x"))).unwrap_err(), "the fleet snapshot did not answer within 20 s");
        assert_eq!(read(&ran(Exit::Signal, "", None)).unwrap_err(), "the fleet snapshot was stopped by a signal");
        assert!(read(&ran(Exit::Code(0), r#"{"schema":"fm-fleet-snapshot.v1","generated":"g"}"#, None)).is_ok());
    }
}
