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
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// A trigger file must be quiet this long before the snapshot runs: Firstmate rewrites the backlog in bursts.
const FILE_DEBOUNCE: Duration = Duration::from_millis(500);
/// A trigger rewritten without pause — the summary during a fleet burst — cannot hold the cycle longer than this.
const FILE_CEILING: Duration = Duration::from_secs(5);

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
    /// The last good snapshot's `main_inventory.orphan_in_flight`, for the Reconcile group; not stored.
    orphans: Mutex<Vec<String>>,
}

impl CrewLive {
    /// The last good snapshot's orphans: in flight in the backlog with no task record.
    pub(crate) fn orphans(&self) -> Vec<String> {
        self.orphans.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

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
    /// Each clone's repository, read once per run. A clone with none — not cloned yet, or no GitHub origin — is not
    /// remembered: it is asked again next cycle, so a clone that appears is read without a restart.
    repos: HashMap<String, String>,
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
                    herdr_pending |= gather_wakes(&rx, &mut wakes, FILE_DEBOUNCE, FILE_CEILING);
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
/// After a `File` wake: quiet for `quiet` first, and whatever else arrives meanwhile joins this run — for at most
/// `ceiling`, so a trigger rewritten without pause cannot starve the cycle (the wakes still coming are the next run's).
/// Answers whether a Herdr wake arrived among them.
fn gather_wakes(rx: &Receiver<CrewWake>, wakes: &mut Vec<CrewWake>, quiet: Duration, ceiling: Duration) -> bool {
    let mut herdr = false;
    let opened = std::time::Instant::now();
    while let Some(left) = ceiling.checked_sub(opened.elapsed()) {
        match rx.recv_timeout(quiet.min(left)) {
            Ok(CrewWake::Herdr) => herdr = true,
            Ok(other) => wakes.push(other),
            Err(_) => break,
        }
    }
    herdr
}

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
            // The open PRs of done tasks, under a short guard; `gh` runs with none held.
            let open = {
                let store = app.state::<Store>();
                let conn = store.conn();
                mirror::open_pr_urls(&conn, store.org_id()).unwrap_or_default()
            };
            Found {
                workers: mirror::workers_of(fleet, view.as_ref(), attached_session().as_deref()),
                repos: repos_of(fleet, home, memo),
                prs: prs_of(app, fleet, memo, visible, &open),
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
            *app.state::<CrewLive>().orphans.lock().unwrap_or_else(|p| p.into_inner()) = fleet.orphans.clone();
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

/// A clone's repository, from the memo when it has one; read and remembered otherwise, unless there is none yet.
fn clone_repo_memo(memo: &mut Memo, home: &Path, path: &str) -> Option<String> {
    if let Some(repo) = memo.repos.get(path) {
        return Some(repo.clone());
    }
    let repo = repo::clone_repo(home, path)?;
    memo.repos.insert(path.to_string(), repo.clone());
    Some(repo)
}

/// The repositories of Firstmate's clones, one per folder under `<home>/projects/`, each read once per run.
fn project_repos(home: &Path, memo: &mut Memo) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(home.join("projects")) else { return Vec::new() };
    let mut repos: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| clone_repo_memo(memo, home, &e.path().display().to_string()))
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
            Some((t.id.clone(), clone_repo_memo(memo, home, &path)))
        })
        .collect()
}

/// The PRs of tasks not yet done whose last check is older than the page's gap, each through `gh pr view` (10 s). A PR
/// `gh` could not read keeps its last values; it is asked again after the same gap, never in a tight loop.
fn prs_of(app: &AppHandle, fleet: &Fleet, memo: &mut Memo, visible: bool, open: &HashSet<String>) -> Vec<gh::PrFacts> {
    let gap = if visible { PR_FRESH_VISIBLE_MS } else { PR_FRESH_HIDDEN_MS };
    let now = now_ms();
    let urls = due_prs(fleet, open, &memo.pr_checked, now, gap);
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

/// The PRs due a reading: the PR of every task not done, and of a done task whose last reading was open (done work
/// clears, rule 2) — valid, and not read within `gap` (a gap: a reading stamped in what is now the future, after a
/// clock step back, is not a fresh one). Sorted, deduplicated.
fn due_prs<'a>(fleet: &'a Fleet, open: &HashSet<String>, checked: &HashMap<String, i64>, now: i64, gap: i64) -> Vec<&'a str> {
    let mut urls: Vec<&str> = fleet
        .tasks
        .iter()
        .filter_map(|t| t.pr_url.as_deref().filter(|url| !mirror::done_now(t) || open.contains(*url)))
        .filter(|url| pr_url_ok(url) && checked.get(*url).is_none_or(|at| !(0..gap).contains(&(now - at))))
        .collect();
    urls.sort_unstable();
    urls.dedup();
    urls
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

    /// A clone that is not there yet — a task queued before the first mate clones its project — has no repository, and
    /// that answer is not remembered for the run: the cycle after the clone appears reads it, so the task's lane and the
    /// crew marks' pairing do not wait for a restart.
    #[test]
    fn a_clone_that_appears_later_is_read_not_remembered_as_missing() {
        let home = tempfile::tempdir().unwrap();
        let clone = home.path().join("projects").join("shop-9c2e");
        let fleet = Fleet { tasks: vec![snapshot::TaskFacts { id: "t1".into(), project: Some(clone.display().to_string()), ..snapshot::TaskFacts::default() }], ..Fleet::default() };
        let mut memo = Memo::default();
        assert_eq!(repos_of(&fleet, home.path(), &mut memo).get("t1"), Some(&None));
        assert!(project_repos(home.path(), &mut memo).is_empty());
        std::fs::create_dir_all(clone.join(".git")).unwrap();
        std::fs::write(clone.join(".git/config"), "[remote \"origin\"]\n\turl = git@github.com:owner-9c2e/shop.git\n").unwrap();
        assert_eq!(repos_of(&fleet, home.path(), &mut memo).get("t1"), Some(&Some("owner-9c2e/shop".into())));
        assert_eq!(project_repos(home.path(), &mut memo), ["owner-9c2e/shop"]);
    }

    /// First mate rule 13: a cycle runs after 500 ms of quiet on `data/backlog.md` or the summary. A file rewritten
    /// more often than that — the summary during a fleet burst — is never quiet, so the gathering stops at its ceiling
    /// and the cycle runs; the wakes that keep coming are the next run's.
    #[test]
    fn a_trigger_rewritten_without_pause_cannot_starve_the_cycle() {
        let (tx, rx) = std::sync::mpsc::channel::<CrewWake>();
        let flood = std::thread::spawn(move || {
            for _ in 0..40 {
                if tx.send(CrewWake::File).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        });
        let started = std::time::Instant::now();
        let mut wakes = vec![CrewWake::File];
        let herdr = gather_wakes(&rx, &mut wakes, Duration::from_millis(200), Duration::from_millis(600));
        let took = started.elapsed();
        assert!(took < Duration::from_millis(1_200), "gathered for {took:?}: the ceiling did not stop it");
        assert!(took >= Duration::from_millis(600), "the ceiling, not the quiet, ended it after {took:?}");
        assert!(!herdr && wakes.len() > 1);
        drop(rx);
        flood.join().unwrap();
    }

    #[test]
    fn a_script_that_fails_says_how() {
        assert_eq!(read(&ran(Exit::Code(2), "", Some("jq: command not found"))).unwrap_err(), "the fleet snapshot exited 2: jq: command not found");
        assert_eq!(read(&ran(Exit::Code(1), "", None)).unwrap_err(), "the fleet snapshot exited 1");
        assert_eq!(read(&ran(Exit::TimedOut, "", Some("x"))).unwrap_err(), "the fleet snapshot did not answer within 20 s");
        assert_eq!(read(&ran(Exit::Signal, "", None)).unwrap_err(), "the fleet snapshot was stopped by a signal");
        assert!(read(&ran(Exit::Code(0), r#"{"schema":"fm-fleet-snapshot.v1","generated":"g"}"#, None)).is_ok());
    }

    /// The PR gap is a gap too: a reading stamped in what is now the future (the clock stepped back) is not one made
    /// within the last minute, so the PR is asked again rather than left as it was for the length of the step.
    #[test]
    fn a_clock_that_went_back_does_not_hold_a_pr_s_last_reading() {
        const URL: &str = "https://github.com/o/shop-9c2e/pull/1";
        let fleet = Fleet {
            generated: "g".into(),
            tasks: vec![super::snapshot::TaskFacts { id: "t-9c2e".into(), backlog_state: Some("in_flight".into()), pr_url: Some(URL.into()), ..Default::default() }],
            orphans: Vec::new(),
        };
        let now = 1_790_000_000_000;
        let checked_later = HashMap::from([(URL.to_string(), now + 2 * 60 * 60_000)]);
        assert_eq!(due_prs(&fleet, &HashSet::new(), &checked_later, now, 60_000), vec![URL], "a reading from the future is not a fresh one");
        let checked_just_now = HashMap::from([(URL.to_string(), now - 1_000)]);
        assert!(due_prs(&fleet, &HashSet::new(), &checked_just_now, now, 60_000).is_empty(), "the gap still holds forward");
    }

    #[test]
    fn a_done_task_s_pr_is_due_while_open() {
        const IN_FLIGHT: &str = "https://github.com/o/shop-9c2e/pull/1";
        const DONE: &str = "https://github.com/o/shop-9c2e/pull/2";
        let task = |id: &str, backlog: &str, url: &str| super::snapshot::TaskFacts {
            id: id.into(),
            backlog_state: Some(backlog.into()),
            pr_url: Some(url.into()),
            ..Default::default()
        };
        let fleet = Fleet {
            generated: "g".into(),
            tasks: vec![task("working-9c2e", "in_flight", IN_FLIGHT), task("done-9c2e", "done", DONE), task("bad-9c2e", "in_flight", "https://example.com/pull/3")],
            orphans: Vec::new(),
        };
        let never = HashMap::new();
        assert_eq!(due_prs(&fleet, &HashSet::new(), &never, 1_000, 60_000), vec![IN_FLIGHT], "a done task's PR not known open is not read");
        let open = HashSet::from([DONE.to_string()]);
        assert_eq!(due_prs(&fleet, &open, &never, 1_000, 60_000), vec![IN_FLIGHT, DONE], "its last reading open: read again");
        let just_read = HashMap::from([(DONE.to_string(), 990)]);
        assert_eq!(due_prs(&fleet, &open, &just_read, 1_000, 60_000), vec![IN_FLIGHT], "the gap still holds");
    }
}
