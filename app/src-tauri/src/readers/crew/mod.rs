//! The crew's collector (build spec §6.6, §11.3): the thread `kinas-crew` runs Firstmate's fleet snapshot when the
//! schedule allows, parses it, and writes the mirror in one transaction under one guard — never holding the store
//! across the script (§6.15). Kinas reads the fleet this way only: no file under the home is opened except to learn
//! that one of the two trigger files changed.

pub mod bundle;
pub mod capacity;
pub mod gh;
mod guard;
pub mod ledger;
mod machine;
pub mod mirror;
pub mod schedule;
pub mod snapshot;
pub mod touches;
pub mod word;

use super::runtime::{watch_with, ReaderControl, CREW_CHANGED};
use crate::crew::pin::WORKSPACE_LABEL;
use crate::crew::config::{lane_config, LaneConfig};
use crate::crew::{firstmate, home, repo};
use crate::herdr::{self, View};
use crate::crew::tools::which;
use crate::login_path::login_path;
use crate::proc::{self, Exit, Ran, Run};
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
/// `git log` over one branch's own commits, for the review flag.
const GIT_LIMIT: Duration = Duration::from_secs(10);
/// The lane reading runs at most this often, Firstmate's own publish interval (build spec §11.5 decision 4).
const CAPACITY_GAP_MS: i64 = 30_000;
/// Herdr's session the crew runs in on the VPS (ADR 0024): the workers' endpoints are read against it.
pub(crate) const REMOTE_SESSION: &str = "default";

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
    /// With the agents on a VPS: whether Firstmate's home is there, as the last bundle said; None before one arrived.
    remote_installed: Mutex<Option<bool>>,
    /// Whether the VPS's last bundle carried a lane reading: its lane gate is open there.
    remote_lanes_on: Mutex<bool>,
    /// When the door first failed since its last success, this run: the status bar's `unreachable since`.
    remote_failing_since: Mutex<Option<i64>>,
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

    /// Whether Firstmate is installed on the VPS, as the last bundle said: the Crew page's state while the place is a
    /// VPS, in place of this Mac's home. False until a bundle has said so.
    pub(crate) fn remote_installed(&self) -> bool {
        self.remote_installed.lock().unwrap_or_else(|p| p.into_inner()).unwrap_or(false)
    }

    fn set_remote_installed(&self, installed: bool) {
        *self.remote_installed.lock().unwrap_or_else(|p| p.into_inner()) = Some(installed);
    }

    pub(crate) fn remote_failing_since(&self) -> Option<i64> {
        *self.remote_failing_since.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn set_remote_failing(&self, failing: bool, now: i64) {
        let mut since = self.remote_failing_since.lock().unwrap_or_else(|p| p.into_inner());
        *since = if failing { Some(since.unwrap_or(now)) } else { None };
    }

    pub(crate) fn remote_lanes_on(&self) -> bool {
        *self.remote_lanes_on.lock().unwrap_or_else(|p| p.into_inner())
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

/// Herdr's view for a command that lists the session (the palette's Workspaces, interface polish rule 13): the view the
/// crew's thread holds while it is younger than `max_age_ms`, else asked of Herdr now and kept for the thread too. None
/// for a plain-shell pane — Kinas asks Herdr nothing then — or when Herdr does not answer.
pub(crate) fn live_view(app: &AppHandle, max_age_ms: i64) -> Option<View> {
    if !vps_set(app) {
        attached_session()?;
    }
    let live = app.state::<CrewLive>().live();
    if held_is_fresh(&live, now_ms(), max_age_ms) {
        return live.view;
    }
    refresh_live(app)
}

/// A view is held and younger than `max_age_ms`: a gap, so one stamped in what is now the future is not fresh.
fn held_is_fresh(live: &LiveView, now: i64, max_age_ms: i64) -> bool {
    live.view.is_some() && (0..max_age_ms).contains(&(now - live.observed_at))
}

/// Asks Herdr for the session's view and the focused pane's foreground, and keeps it. None when Herdr did not answer.
/// With the agents on a VPS, its Herdr through the companion (`view`, slice 3): the chrome and the palette read it as
/// fresh as this Mac's.
fn refresh_live(app: &AppHandle) -> Option<View> {
    let now = now_ms();
    let crew = app.state::<CrewLive>();
    let previous = crew.live();
    let answer = if vps_set(app) {
        // While the door is failing, the bundle's own reading tries it again every cycle; a view asked meanwhile would
        // hold this thread for ssh's connect timeout on every chrome poll. The last view is kept, its age unchanged, so
        // the chrome's badge goes stale as it would, and the next good bundle clears the flag.
        if crew.remote_failing_since().is_some() {
            return previous.view;
        }
        crate::crew::on_vps::view(app)
    } else {
        attached_session().and_then(|_| herdr::find_herdr()).and_then(|bin| {
            let view = herdr::api_snapshot(&bin).ok()?;
            let fg = view.focused_pane.as_deref().map(|p| herdr::foreground(&bin, p).unwrap_or_default()).unwrap_or_default();
            Some((view, fg))
        })
    };
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
    /// When each task's branch was last read for the review flag, by task id — here, or on the VPS by the bundle's stamp.
    branch_checked: HashMap<String, i64>,
    worktree_checked: HashMap<String, i64>,
    /// When `fm-capacity.sh` last ran — here, or on the VPS by the bundle's stamp.
    capacity_at: Option<i64>,
    /// Refresh readings was asked with the agents on a VPS: the next cycle asks the companion for a reading first.
    remote_refresh: bool,
    /// The Linux machine's plan, host and token counts applied last, by the companion's stamps (slice 5.2).
    machine: machine::Seen,
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
        // Watched once the home exists: `kinas crew setup` may create it while Kinas runs. Never with the agents on a
        // VPS: this Mac's home is not the crew's then, and a change in it must not wake a reading of the VPS.
        let on_vps = vps_set(&app);
        if on_vps {
            watcher = None;
        } else if watcher.is_none() {
            watcher = watch_home(&home, tx.clone());
        }
        schedule.set_visible(app.state::<ReaderControl>().crew_visible());
        let now = now_ms();
        let cycle_at = due.map_or_else(|| schedule.run_at(&CrewWake::Tick, now), |d| d.min(schedule.run_at(&CrewWake::Tick, now)));
        let herdr_at = if herdr_pending { herdr_due(last_herdr, now) } else { i64::MAX };
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
                        memo.capacity_at = None;
                        memo.remote_refresh = true;
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
        } else if herdr_pending && now >= herdr_due(last_herdr, now) {
            // Herdr only, for the chrome or after a launch: this Mac's Herdr, or the VPS's through its companion.
            last_herdr = now;
            herdr_pending = false;
            let view = refresh_live(&app);
            first_answer(&app, started_at, &mut first_answer_seen, view.as_ref());
        }
    }
}

/// When a Herdr-only ask may run: 2 s after the last one — a gap, not a moment to reach again, so an ask stamped in
/// what is now the future (the wall clock stepped back) has had its gap, or a launch's fresh view would wait the length
/// of the step.
fn herdr_due(last_herdr: i64, now: i64) -> i64 {
    if (0..HERDR_MIN_GAP_MS).contains(&(now - last_herdr)) {
        last_herdr + HERDR_MIN_GAP_MS
    } else {
        now
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
        let focused = if vps_set(app) {
            crate::crew::on_vps::focus(app, &id).is_ok()
        } else {
            herdr::find_herdr().is_some_and(|bin| herdr::workspace_focus(&bin, &id).is_ok())
        };
        if focused {
            log::info!("crew: focused the first mate at start");
            // The chrome reads the pane that is focused now.
            app.state::<ReaderControl>().crew_herdr();
        }
    }
}

/// One cycle: the snapshot, the parse, Herdr's view, the write, the log line, `crew_changed`. Returns whether the
/// snapshot succeeded.
fn cycle(app: &AppHandle, home: &Path, started_at: i64, first_answer_seen: &mut bool, memo: &mut Memo) -> bool {
    // With the agents on a VPS (ADR 0024), the crew is read there, through the one door, and nothing here runs.
    let place = {
        let store = app.state::<Store>();
        let conn = store.conn();
        crate::place::place(&conn, store.org_id())
    };
    if let crate::place::Place::Vps { target, label } = place {
        return cycle_remote(app, &target, &label, memo, started_at, first_answer_seen);
    }
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
                lanes: lanes_due(home, memo, now_ms()),
                ledger: ledger_read(app, home),
                branches: branches_of(fleet, home, memo, visible),
                // The worktree scan is the VPS's (ADR 0028): on the Mac, Kinas doesn't sandbox workers.
                worktrees: HashMap::new(),
                // So is the local-only check (ADR 0029): on the Mac, no launch is recorded.
                local_moved: None,
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

/// One cycle with the agents on a VPS (build spec §11.3 A): one `bundle` through the door, with no guard held — after a
/// `refresh` when the captain asked for fresh readings — then the same parsers and the same `mirror::record` as a local
/// cycle, on what the VPS's scripts, Herdr and `gh` printed there. A failed call writes no crew table (ADR 0004): the crew
/// reader's row says why, and `vps_reachability` keeps the rest.
fn cycle_remote(app: &AppHandle, target: &str, label: &str, memo: &mut Memo, started_at: i64, first_answer_seen: &mut bool) -> bool {
    let started = Instant::now();
    let data_dir = app.state::<ReaderControl>().data_dir().to_path_buf();
    if std::mem::take(&mut memo.remote_refresh) {
        // A refresh that fails is not a reading that fails: the bundle still brings the last one, and says how old.
        let _ = crate::remote::call(target, &data_dir, &crate::remote::Request::Refresh);
    }
    let cursor = {
        let store = app.state::<Store>();
        let conn = store.conn();
        crate::system::get_setting(&conn, store.org_id(), mirror::LEDGER_CURSOR_SETTING).and_then(|v| serde_json::from_value::<ledger::Cursor>(v).ok())
    };
    let reply = crate::remote::call(target, &data_dir, &crate::remote::Request::Bundle { cursor: cursor.map(bundle::cursor_for) });
    let now = now_ms();
    let decoded = reply.map(bundle::decode);
    let store = app.state::<Store>();
    let ok = match decoded {
        Err(why) => {
            app.state::<CrewLive>().set_remote_failing(true, now);
            let conn = store.conn();
            let _ = bundle::remember(&conn, store.org_id(), label, now, Err(why));
            let _ = write_reader_status(&conn, store.org_id(), Reader::Crew, Outcome::Error(&why.words(label)), now);
            false
        }
        Ok(Err(message)) => {
            app.state::<CrewLive>().set_remote_failing(true, now);
            let conn = store.conn();
            let _ = bundle::remember(&conn, store.org_id(), label, now, Err(crate::remote::Unreachable::BadReply));
            let _ = write_reader_status(&conn, store.org_id(), Reader::Crew, Outcome::Error(&message), now);
            false
        }
        Ok(Ok(b)) => {
            app.state::<CrewLive>().set_remote_failing(false, now);
            {
                let conn = store.conn();
                let _ = bundle::remember(&conn, store.org_id(), label, now, Ok(&bundle::heartbeat_here(&b.companion, b.served_at, now)));
            }
            {
                // Usage's readings from the Linux machine, whether or not Firstmate is there (slice 5.2).
                let mut conn = store.conn();
                machine::apply(&mut conn, store.org_id(), label, &crate::readers::host::machine_name(), &b, now, &mut memo.machine);
            }
            let live = app.state::<CrewLive>();
            live.set_remote_installed(b.installed);
            *live.remote_lanes_on.lock().unwrap_or_else(|p| p.into_inner()) = b.installed && b.capacity.is_some();
            let view = remote_live(app, &b, now);
            first_answer(app, started_at, first_answer_seen, view.as_ref());
            if !b.installed {
                let conn = store.conn();
                let _ = write_reader_status(&conn, store.org_id(), Reader::Crew, Outcome::NotConfigured("Firstmate isn't installed on the Linux machine"), now);
                drop(conn);
                changed(app);
                return true;
            }
            let outcome = match &b.snapshot {
                Some(out) => read(&out.ran()),
                None => Err("the Linux machine sent no fleet snapshot".into()),
            };
            let found = match &outcome {
                Ok(fleet) => found_remote(&b, fleet, view.as_ref(), memo),
                Err(_) => Found::default(),
            };
            if !found.prs.is_empty() {
                let mut checks = live.checks.lock().unwrap_or_else(|p| p.into_inner());
                for pr in &found.prs {
                    checks.insert(pr.url.clone(), pr.checks.clone());
                }
            }
            let mut conn = store.conn();
            let written = mirror::record(&mut conn, store.org_id(), &outcome, &found, now);
            // Read by the first mate, its reply, and a delivery the door lost (slice 6.2): the Mac's own answers only.
            if let Err(e) = crate::crew::answer::apply_states(&conn, store.org_id(), b.answers.as_ref(), b.served_at, now) {
                log::warn!("crew: answers' states not applied: {e}");
            }
            let words = crate::crew::read::worker_words(&conn, store.org_id()).unwrap_or_default();
            drop(conn);
            live.set_worker_words(words);
            match (&outcome, &written) {
                (Ok(fleet), Ok(_)) => {
                    *live.generated.lock().unwrap_or_else(|p| p.into_inner()) = Some(fleet.generated.clone());
                    *live.orphans.lock().unwrap_or_else(|p| p.into_inner()) = fleet.orphans.clone();
                    true
                }
                _ => false,
            }
        }
    };
    log::info!("crew: remote {} in {} ms", if ok { "reading" } else { "reading failed" }, started.elapsed().as_millis());
    changed(app);
    ok
}

/// Herdr's view of the VPS's session as the chrome and the Crew page read it: the bundle's `api snapshot` and the
/// focused pane's foreground programs, through the parsers a local view goes through.
fn remote_live(app: &AppHandle, b: &bundle::Bundle, now: i64) -> Option<View> {
    let view = b.herdr_view.as_deref().and_then(|json| herdr::parse_view(json).ok());
    let focused_foreground = b.herdr_foreground.as_deref().map(herdr::parse_foreground).unwrap_or_default();
    let crew = app.state::<CrewLive>();
    let previous = crew.live();
    let was_there = previous.first_mate_there();
    let live = LiveView { view: view.clone(), focused_foreground, observed_at: now, worker_words: previous.worker_words };
    let now_there = live.first_mate_there();
    crew.set_live(live);
    if was_there != now_there {
        let _ = app.emit(CREW_CHANGED, ());
    }
    view
}

/// What a local cycle finds beside the snapshot, from the bundle instead: the workers in Herdr's `default` session on
/// the VPS (ADR 0024), each task clone's repository from the origins the companion read, the PRs `gh` answered there
/// since the last bundle, the lane reading when it ran there since the last one, and the ledger's new lines.
fn found_remote(b: &bundle::Bundle, fleet: &Fleet, view: Option<&View>, memo: &mut Memo) -> Found {
    let home = b.home.as_deref().map(Path::new);
    let repos = home
        .map(|home| fleet.tasks.iter().filter_map(|t| Some((t.id.clone(), bundle::clone_repo_there(home, &mirror::clone_path(t, home)?, &b.origins)))).collect())
        .unwrap_or_default();
    let mut prs = Vec::new();
    for p in &b.prs {
        // Each answer once: a PR the VPS has not asked again since the last bundle is not applied again.
        if memo.pr_checked.insert(p.url.clone(), p.checked_at) == Some(p.checked_at) {
            continue;
        }
        if matches!(p.out.ran().exit, Exit::Code(0)) {
            prs.extend(gh::parse(&p.url, &p.out.stdout).ok());
        }
    }
    let lanes = match (&b.capacity, b.capacity_at) {
        (Some(out), Some(at)) if memo.capacity_at != Some(at) => {
            memo.capacity_at = Some(at);
            Some(read_capacity(&out.ran(), at))
        }
        _ => None,
    };
    // Each branch the VPS read since the last bundle, once (the review flag): its `git log` answer, verbatim.
    let mut branches = HashMap::new();
    for out in &b.branches {
        if memo.branch_checked.insert(out.task.clone(), out.checked_at) == Some(out.checked_at) {
            continue;
        }
        let ran = out.out.ran();
        branches.insert(out.task.clone(), touches::of_branch(matches!(ran.exit, Exit::Code(0)), &out.out.stdout));
    }
    // Each worktree the VPS scanned since the last bundle, once (ADR 0028): its red paths, or that it couldn't be read.
    let mut worktrees = HashMap::new();
    for out in &b.worktrees {
        if memo.worktree_checked.insert(out.task.clone(), out.checked_at) == Some(out.checked_at) {
            continue;
        }
        worktrees.insert(out.task.clone(), touches::of_paths(out.red.iter().map(String::as_str), !out.unknown));
    }
    // ADR 0029: the whole set of local-only tasks whose local default branch moved, each reading; none from an older companion.
    let local_moved = b.local_moved.as_ref().map(|all| {
        all.iter().filter_map(|m| mirror::LocalMoved::checked(&m.branch, &m.was, m.now.as_deref()).map(|v| (m.task.clone(), v))).collect()
    });
    Found { workers: mirror::workers_of(fleet, view, Some(REMOTE_SESSION)), repos, prs, lanes, ledger: b.ledger.as_ref().map(bundle::ledger_of), branches, worktrees, local_moved }
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

/// Each task's branch for the review flag (the captain's (b)): every task not done with a branch and a clone under
/// `<home>/projects/`, not read within the PRs' gap — `git log` from the clone's own git folder, 10 s, with no guard
/// held. A branch not made yet is not read; one that is there but cannot be read asks for review.
fn branches_of(fleet: &Fleet, home: &Path, memo: &mut Memo, visible: bool) -> HashMap<String, touches::Touches> {
    let gap = if visible { PR_FRESH_VISIBLE_MS } else { PR_FRESH_HIDDEN_MS };
    let now = now_ms();
    let path = login_path();
    let Some(git) = which("git", path) else { return HashMap::new() };
    let mut out = HashMap::new();
    for t in fleet.tasks.iter().filter(|t| !mirror::done_now(t)) {
        let Some(branch) = t.branch.as_deref() else { continue };
        if memo.branch_checked.get(&t.id).is_some_and(|at| (0..gap).contains(&(now - at))) {
            continue;
        }
        let Some(git_dir) = mirror::clone_path(t, home).and_then(|c| touches::clone_git_dir(home, &c)) else { continue };
        let (Some(log), Some(exists)) = (touches::branch_args(&git_dir, branch), touches::branch_exists_args(&git_dir, branch)) else { continue };
        memo.branch_checked.insert(t.id.clone(), now);
        let run = |args: &[String]| {
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            proc::run(&Run { program: &git, args: &args, cwd: None, set: &[("PATH", path), ("GIT_OPTIONAL_LOCKS", "0"), ("GIT_TERMINAL_PROMPT", "0")], limit: GIT_LIMIT }).ok()
        };
        let Some(ran) = run(&log) else { continue };
        let ok = matches!(ran.exit, Exit::Code(0));
        if !ok && run(&exists).is_some_and(|r| !matches!(r.exit, Exit::Code(0))) {
            continue;
        }
        out.insert(t.id.clone(), touches::of_branch(ok, &ran.stdout));
    }
    out
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

/// The lane reading, when the gate is open — `config/lane-capacity` a cap or `auto`, never a `quota-provider` (ADR
/// 0020) — and at most once every 30 s (a gap: a stamp in what is now the future has had its gap). None otherwise.
fn lanes_due(home: &Path, memo: &mut Memo, now: i64) -> Option<Result<capacity::Lanes, String>> {
    if !matches!(lane_config(home), LaneConfig::Cap(_) | LaneConfig::Auto) {
        return None;
    }
    if memo.capacity_at.is_some_and(|at| (0..CAPACITY_GAP_MS).contains(&(now - at))) {
        return None;
    }
    memo.capacity_at = Some(now);
    let started = Instant::now();
    let lanes = firstmate::capacity(home).and_then(|ran| read_capacity(&ran, now));
    let ms = started.elapsed().as_millis();
    match &lanes {
        Ok(_) => log::info!("crew: capacity in {ms} ms"),
        Err(_) => log::info!("crew: capacity failed in {ms} ms"),
    }
    Some(lanes)
}

/// The fleet ledger since the stored cursor (Firstmate, current): None while the file is absent. A file that cannot be
/// read says so under the board, and the cursor stays.
fn ledger_read(app: &AppHandle, home: &Path) -> Option<ledger::LedgerRead> {
    let cursor = {
        let store = app.state::<Store>();
        let conn = store.conn();
        crate::system::get_setting(&conn, store.org_id(), mirror::LEDGER_CURSOR_SETTING).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
    };
    let started = Instant::now();
    let read = match ledger::read_ledger(&home.join(ledger::LEDGER_FILE), cursor) {
        Ok(read) => read?,
        Err(_) => return Some(ledger::LedgerRead { events: Vec::new(), cursor, error: Some("could not be read".into()) }),
    };
    log::info!("crew: ledger {} events in {} ms", read.events.len(), started.elapsed().as_millis());
    Some(read)
}

/// The capacity script's answer: exit 0, or 1 for an invalid `config/lane-capacity` — still a document, whose cap reads
/// invalid. Its stderr is never read.
fn read_capacity(ran: &Ran, now: i64) -> Result<capacity::Lanes, String> {
    match ran.exit {
        Exit::Code(0 | 1) => capacity::parse_capacity(&ran.stdout, now),
        Exit::Code(code) => Err(format!("the script exited {code}")),
        Exit::Signal => Err("the script was stopped by a signal".into()),
        Exit::TimedOut => Err("the script did not answer within 10 s".into()),
    }
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

/// Whether the agents run on a VPS now (the place setting, read under a short guard).
fn vps_set(app: &AppHandle) -> bool {
    let store = app.state::<Store>();
    let conn = store.conn();
    matches!(crate::place::place(&conn, store.org_id()), crate::place::Place::Vps { .. })
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

    fn fixture_text(name: &str) -> String {
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)).unwrap()
    }

    /// Every row the mirror writes, in a fixed order, for comparing two stores — less `org_id`, each store's own.
    fn crew_rows(store: &Store) -> Vec<String> {
        let conn = store.conn();
        let mut out = Vec::new();
        for table in ["crew_tasks", "crew_decisions", "crew_events", "crew_ledger"] {
            let mut stmt = conn.prepare(&format!("SELECT * FROM {table}")).unwrap();
            let n = stmt.column_count();
            let keep: Vec<usize> = (0..n).filter(|&i| stmt.column_name(i).unwrap() != "org_id").collect();
            let mut rows: Vec<String> = stmt
                .query_map([], |r| {
                    let cells: Vec<String> = keep.iter().map(|&i| format!("{:?}", r.get_ref(i).map(|v| v.as_str().map(str::to_string).unwrap_or_else(|_| format!("{v:?}"))))).collect();
                    Ok(format!("{table}: {}", cells.join(" | ")))
                })
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            rows.sort();
            out.extend(rows);
        }
        out
    }

    /// A Firstmate home on disk with the snapshot fixture's two clones and a ledger, as both paths see it.
    fn home_with_clones() -> (tempfile::TempDir, PathBuf, String) {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("firstmate");
        for (name, url) in [("shop-9c2e", "git@github.com:acme-9c2e/shop-9c2e.git"), ("harbor-api-9c2e", "https://github.com/acme-9c2e/harbor-api-9c2e")] {
            std::fs::create_dir_all(home.join("projects").join(name).join(".git")).unwrap();
            std::fs::write(home.join("projects").join(name).join(".git/config"), format!("[remote \"origin\"]\n\turl = {url}\n")).unwrap();
        }
        std::fs::create_dir_all(home.join("state")).unwrap();
        std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/crew-ledger.synthetic.jsonl"), home.join(ledger::LEDGER_FILE)).unwrap();
        let snapshot = fixture_text("firstmate-fleet-snapshot.current.synthetic.json").replace("__FM_HOME__", &home.display().to_string());
        (dir, home, snapshot)
    }

    /// Build spec §12 slice 2.5: the same snapshot, Herdr view, clones, PR answers, lane reading and ledger, read on this
    /// Mac or arriving in a bundle, write the same rows — the remote path adds no parser of its own.
    #[test]
    fn cycle_remote_records_like_local() {
        use std::os::unix::fs::MetadataExt;
        let (_dir, home, snapshot) = home_with_clones();
        let fleet = parse_fleet(&snapshot).unwrap();
        let view_json = fixture_text("herdr-api-snapshot.captured.json");
        let view = herdr::parse_view(&view_json).unwrap();
        let gh_json = fixture_text("crew-gh-1.json");
        let pr = "https://github.com/acme-9c2e/shop-9c2e/pull/91";
        let capacity_json = fixture_text("crew-capacity.cap4.synthetic.json");
        let now = 1_794_834_000_000;

        // This Mac: the local cycle's own readers.
        let mut memo = Memo::default();
        let local = Found {
            workers: mirror::workers_of(&fleet, Some(&view), Some(REMOTE_SESSION)),
            repos: repos_of(&fleet, &home, &mut memo),
            prs: vec![gh::parse(pr, &gh_json).unwrap()],
            lanes: Some(read_capacity(&Ran { exit: Exit::Code(0), stdout: capacity_json.clone(), first_err: None, last_err: None }, now)),
            ledger: ledger::read_ledger(&home.join(ledger::LEDGER_FILE), ledger::Cursor::default()).unwrap(),
            branches: HashMap::from([("stock-webhook-9c2e".to_string(), touches::of_branch(true, BRANCH_LOG))]),
            worktrees: HashMap::new(),
            local_moved: None,
        };

        // The VPS: the same facts as the companion sends them.
        let meta = std::fs::metadata(home.join(ledger::LEDGER_FILE)).unwrap();
        let text = std::fs::read_to_string(home.join(ledger::LEDGER_FILE)).unwrap();
        let out = |stdout: &str| serde_json::json!({ "exit": 0, "timed_out": false, "stdout": stdout, "stderr_first": null });
        let projects = home.join("projects");
        let b = bundle::decode(serde_json::json!({
            "v": 1, "at": now, "companion": { "version": "0.1.0", "since": now, "heartbeat_at": now },
            "installed": true, "home": home, "snapshot": out(&snapshot),
            "capacity": out(&capacity_json), "capacity_at": now,
            "origins": {
                projects.join("shop-9c2e").display().to_string(): "git@github.com:acme-9c2e/shop-9c2e.git",
                projects.join("harbor-api-9c2e").display().to_string(): "https://github.com/acme-9c2e/harbor-api-9c2e"
            },
            "herdr_view": view_json, "herdr_foreground": null,
            "prs": [{ "url": pr, "checked_at": now, "out": out(&gh_json) }],
            "branches": [{ "task": "stock-webhook-9c2e", "checked_at": now, "out": out(BRANCH_LOG) }],
            "ledger": { "epoch": "x", "dev": meta.dev(), "ino": meta.ino(), "from": 0, "to": text.len(), "text": text }
        }))
        .unwrap();
        let mut remote_memo = Memo::default();
        let remote = found_remote(&b, &fleet, Some(&view), &mut remote_memo);

        assert_eq!(remote.workers.len(), local.workers.len());
        assert_eq!(remote.repos, local.repos);
        assert_eq!(remote.repos.get("stock-webhook-9c2e"), Some(&Some("acme-9c2e/shop-9c2e".to_string())));
        assert_eq!(remote.prs, local.prs);
        assert_eq!(remote.lanes, local.lanes);
        assert_eq!(remote.ledger, local.ledger);
        assert_eq!(remote.branches, local.branches);
        assert_eq!(remote.branches["stock-webhook-9c2e"].paths, [".claude/settings.json"]);

        let write = |found: &Found| {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(dir.path()).unwrap();
            mirror::record(&mut store.conn(), store.org_id(), &Ok(fleet.clone()), found, now).unwrap();
            (dir, crew_rows(&store))
        };
        let (_a, here) = write(&local);
        let (_b, there) = write(&remote);
        assert!(!here.is_empty());
        assert_eq!(there, here);

        // The same bundle again applies no PR or lane answer twice; the ledger chunk is the companion's to advance.
        let again = found_remote(&b, &fleet, Some(&view), &mut remote_memo);
        assert!(again.prs.is_empty() && again.lanes.is_none() && again.branches.is_empty());
    }

    /// ADR 0028: the VPS's worktree scan arrives in the bundle, is applied once, and reaches the board's row as its own
    /// field, beside the review flag; a later clear scan clears it; a walk that couldn't finish asks for review.
    #[test]
    fn the_worktree_scan_reaches_the_card_once_and_a_clear_scan_clears_it() {
        let (_dir, home, snapshot) = home_with_clones();
        let fleet = parse_fleet(&snapshot).unwrap();
        let now = 1_794_834_000_000;
        let bundle_with = |worktrees: serde_json::Value| {
            bundle::decode(serde_json::json!({
                "v": 1, "at": now, "companion": { "version": "0.1.0", "since": now, "heartbeat_at": now },
                "installed": true, "home": home, "snapshot": null, "capacity": null, "capacity_at": null,
                "origins": {}, "herdr_view": null, "herdr_foreground": null, "prs": [], "worktrees": worktrees
            }))
            .unwrap()
        };
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let mut memo = Memo::default();
        let row = |store: &Store| {
            let snap = crate::crew::read::snapshot_view(&store.conn(), store.org_id(), now, true, true, None).unwrap();
            snap.tasks.into_iter().find(|t| t.id == "stock-webhook-9c2e").unwrap().worktree
        };

        let planted = bundle_with(serde_json::json!([{ "task": "stock-webhook-9c2e", "checked_at": now, "red": ["sub/.claude/x", "sub/.mcp.json"], "count": 2, "unknown": false }]));
        let found = found_remote(&planted, &fleet, None, &mut memo);
        assert_eq!(found.worktrees["stock-webhook-9c2e"], touches::Touches { paths: vec!["sub/.claude/x".into(), "sub/.mcp.json".into()], unknown: false });
        mirror::record(&mut store.conn(), store.org_id(), &Ok(fleet.clone()), &found, now).unwrap();
        assert_eq!(row(&store), Some(touches::Touches { paths: vec!["sub/.claude/x".into(), "sub/.mcp.json".into()], unknown: false }));
        // The review flag is its own: the scan doesn't put the task's committed paths in doubt, nor the other way round.
        let snap = crate::crew::read::snapshot_view(&store.conn(), store.org_id(), now, true, true, None).unwrap();
        assert_eq!(snap.tasks.iter().find(|t| t.id == "stock-webhook-9c2e").unwrap().review, None);

        // The same bundle again applies nothing; a later scan that found nothing clears the card.
        assert!(found_remote(&planted, &fleet, None, &mut memo).worktrees.is_empty());
        let clear = bundle_with(serde_json::json!([{ "task": "stock-webhook-9c2e", "checked_at": now + 60_000, "red": [], "count": 0, "unknown": false }]));
        mirror::record(&mut store.conn(), store.org_id(), &Ok(fleet.clone()), &found_remote(&clear, &fleet, None, &mut memo), now + 60_000).unwrap();
        assert_eq!(row(&store), None);

        let unread = bundle_with(serde_json::json!([{ "task": "stock-webhook-9c2e", "checked_at": now + 120_000, "red": [], "count": 0, "unknown": true }]));
        mirror::record(&mut store.conn(), store.org_id(), &Ok(fleet.clone()), &found_remote(&unread, &fleet, None, &mut memo), now + 120_000).unwrap();
        assert_eq!(row(&store), Some(touches::Touches { paths: vec![], unknown: true }));
    }

    /// ADR 0029: the Linux machine's local-only check reaches the card whole each reading, a clear reading clears it,
    /// anything that isn't a branch and two commits is dropped, and a companion that doesn't say leaves the card as it was.
    #[test]
    fn a_local_only_task_s_moved_main_reaches_the_card_and_clears_with_the_reading() {
        let (_dir, home, snapshot) = home_with_clones();
        let fleet = parse_fleet(&snapshot).unwrap();
        let now = 1_794_834_000_000;
        let bundle_with = |moved: Option<serde_json::Value>| {
            let mut doc = serde_json::json!({
                "v": 1, "at": now, "companion": { "version": "0.1.0", "since": now, "heartbeat_at": now },
                "installed": true, "home": home, "snapshot": null, "capacity": null, "capacity_at": null,
                "origins": {}, "herdr_view": null, "herdr_foreground": null, "prs": []
            });
            if let Some(m) = moved {
                doc["local_moved"] = m;
            }
            bundle::decode(doc).unwrap()
        };
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let mut memo = Memo::default();
        let row = |store: &Store| {
            let snap = crate::crew::read::snapshot_view(&store.conn(), store.org_id(), now, true, true, None).unwrap();
            snap.tasks.into_iter().find(|t| t.id == "stock-webhook-9c2e").unwrap().local_moved
        };
        let (was, moved_to) = ("b".repeat(40), "d".repeat(40));
        let record = |b: &bundle::Bundle, memo: &mut Memo| mirror::record(&mut store.conn(), store.org_id(), &Ok(fleet.clone()), &found_remote(b, &fleet, None, memo), now).unwrap();

        let moved = bundle_with(Some(serde_json::json!([
            { "task": "stock-webhook-9c2e", "branch": "main", "was": was, "now": moved_to },
            { "task": "other-9c2e", "branch": "--all", "was": was, "now": null }
        ])));
        let found = found_remote(&moved, &fleet, None, &mut memo);
        assert_eq!(found.local_moved.as_ref().map(|m| m.len()), Some(1));
        record(&moved, &mut memo);
        assert_eq!(row(&store), Some(mirror::LocalMoved { branch: "main".into(), was: was.clone(), now: Some(moved_to.clone()) }));
        // A companion that doesn't say: kept.
        record(&bundle_with(None), &mut memo);
        assert!(row(&store).is_some());
        // A reading that lists nothing: cleared.
        record(&bundle_with(Some(serde_json::json!([]))), &mut memo);
        assert_eq!(row(&store), None);
        // A commit that isn't one is dropped, never stored.
        record(&bundle_with(Some(serde_json::json!([{ "task": "stock-webhook-9c2e", "branch": "main", "was": "HEAD", "now": null }]))), &mut memo);
        assert_eq!(row(&store), None);
    }

    /// What `git log --name-only --format= -z` prints for two commits.
    const BRANCH_LOG: &str = "\0src/stock.ts\0.claude/settings.json\0\0README.md\0";

    fn git(dir: &Path, args: &[&str]) {
        let ok = std::process::Command::new("git")
            .args(["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .unwrap();
        assert!(ok.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&ok.stderr));
    }

    /// The review flag on this Mac (the captain's (b)): a real clone, a branch with a commit that adds a hook, read from
    /// the clone's git folder; a branch not made yet is not read, and one read is not read again within the gap.
    #[test]
    fn a_branch_that_adds_a_claude_file_is_flagged_and_one_not_made_yet_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("firstmate");
        let clone = home.join("projects").join("shop");
        std::fs::create_dir_all(&clone).unwrap();
        git(&clone, &["init", "-q", "-b", "main"]);
        std::fs::write(clone.join("README.md"), "shop\n").unwrap();
        git(&clone, &["add", "-A"]);
        git(&clone, &["commit", "-q", "-m", "base"]);
        git(&clone, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
        git(&clone, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
        git(&clone, &["checkout", "-q", "-b", "fm/hook"]);
        std::fs::create_dir_all(clone.join(".claude")).unwrap();
        std::fs::write(clone.join(".claude/settings.json"), "{}\n").unwrap();
        std::fs::write(clone.join("src.ts"), "x\n").unwrap();
        git(&clone, &["add", "-A"]);
        git(&clone, &["commit", "-q", "-m", "work"]);
        git(&clone, &["checkout", "-q", "main"]);

        let task = |id: &str, branch: &str| snapshot::TaskFacts {
            id: id.into(),
            branch: Some(branch.into()),
            project: Some(clone.display().to_string()),
            state: Some("working".into()),
            ..Default::default()
        };
        let fleet = Fleet { tasks: vec![task("hook-9c2e", "fm/hook"), task("later-9c2e", "fm/not-yet"), task("bad-9c2e", "--all")], ..Default::default() };
        let mut memo = Memo::default();
        let read = branches_of(&fleet, &home, &mut memo, true);
        assert_eq!(read.get("hook-9c2e"), Some(&touches::Touches { paths: vec![".claude/settings.json".into()], unknown: false }));
        assert!(!read.contains_key("later-9c2e"), "a branch not made yet has nothing to review");
        assert!(!read.contains_key("bad-9c2e"), "a name that is not a branch is never passed to git");
        assert!(branches_of(&fleet, &home, &mut memo, true).is_empty(), "not again within the gap");

        // A clone whose origin/HEAD is not set cannot be read whole: it asks for review.
        git(&clone, &["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"]);
        let read = branches_of(&fleet, &home, &mut Memo::default(), true);
        assert_eq!(read.get("hook-9c2e"), Some(&touches::Touches { paths: vec![], unknown: true }));
    }

    /// Build spec §12 slice 2.5, ADR 0004: a bundle that does not come, or is not one, writes no crew row and moves no
    /// cursor; only the reader's status and `vps_reachability` say why.
    #[test]
    fn cycle_remote_failure_keeps_rows() {
        let (_dir, _home, snapshot) = home_with_clones();
        let fleet = parse_fleet(&snapshot).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        mirror::record(&mut store.conn(), store.org_id(), &Ok(fleet), &Found::default(), 100).unwrap();
        let before = crew_rows(&store);
        for reply in [serde_json::json!({ "v": 1, "error": "no-reading" }), serde_json::json!({ "v": 2 })] {
            assert!(bundle::decode(reply).is_err());
        }
        let conn = store.conn();
        bundle::remember(&conn, store.org_id(), "vps-1", 200, Err(crate::remote::Unreachable::TimedOut)).unwrap();
        write_reader_status(&conn, store.org_id(), Reader::Crew, Outcome::Error("can't reach vps-1: no answer"), 200).unwrap();
        drop(conn);
        assert_eq!(crew_rows(&store), before);
        assert_eq!(crate::system::get_setting(&store.conn(), store.org_id(), mirror::LEDGER_CURSOR_SETTING), None);
    }

    /// The chunk's cursor: past every line it took, or only as far as a newer record version let it read.
    #[test]
    fn a_ledger_chunk_moves_the_cursor_as_the_local_reader_does() {
        let chunk = |text: &str, from: u64, to: u64| bundle::LedgerChunk { dev: 1, ino: 2, from, to, text: text.into() };
        assert_eq!(bundle::ledger_of(&chunk("", 40, 40)).cursor, ledger::Cursor { dev: 1, ino: 2, offset: 40 });
        let skipped = bundle::ledger_of(&chunk("", 0, 5_000_000));
        assert_eq!(skipped.cursor.offset, 5_000_000, "a line longer than the cap is skipped past, as here");
        let v2 = "{\"v\":1,\"task\":\"t\",\"event\":\"x\",\"at\":1}\n{\"v\":2}\n";
        let read = bundle::ledger_of(&chunk(v2, 100, 100 + v2.len() as u64));
        assert!(read.error.is_some());
        assert_eq!(read.cursor.offset, 100 + v2.find("{\"v\":2}").unwrap() as u64, "stops before the record it cannot read");
        assert_eq!(bundle::cursor_for(ledger::Cursor { dev: 7, ino: 9, offset: 3 }), crate::remote::Cursor { epoch: "7:9".into(), offset: 3, events: 0 });
    }

    /// A clone path is checked on the VPS's home as `repo::clone_repo` checks one here.
    #[test]
    fn a_clone_outside_the_vps_home_has_no_repository() {
        let origins: std::collections::BTreeMap<String, Option<String>> =
            [("/h/projects/a".to_string(), Some("git@github.com:o/a.git".to_string())), ("/h/other".to_string(), Some("git@github.com:o/b.git".to_string()))].into();
        let home = Path::new("/h");
        assert_eq!(bundle::clone_repo_there(home, "/h/projects/a", &origins).as_deref(), Some("o/a"));
        assert_eq!(bundle::clone_repo_there(home, "/h/projects/a/", &origins).as_deref(), Some("o/a"));
        assert_eq!(bundle::clone_repo_there(home, "/h/other", &origins), None);
        assert_eq!(bundle::clone_repo_there(home, "/h/projects/../other", &origins), None);
        assert_eq!(bundle::clone_repo_there(home, "projects/a", &origins), None);
        assert_eq!(bundle::clone_repo_there(home, "/h/projects/missing", &origins), None);
    }

    #[test]
    fn a_held_view_answers_while_it_is_younger_than_the_limit() {
        let held = LiveView { view: Some(View::default()), observed_at: 10_000, ..LiveView::default() };
        assert!(held_is_fresh(&held, 10_000 + HERDR_FRESH_MS - 1, HERDR_FRESH_MS));
        assert!(!held_is_fresh(&held, 10_000 + HERDR_FRESH_MS, HERDR_FRESH_MS), "old");
        assert!(!held_is_fresh(&held, 9_000, HERDR_FRESH_MS), "stamped in what is now the future");
        assert!(!held_is_fresh(&LiveView { observed_at: 10_000, ..LiveView::default() }, 10_001, HERDR_FRESH_MS), "Herdr did not answer");
    }

    fn ran(exit: Exit, stdout: &str, last_err: Option<&str>) -> Ran {
        Ran { exit, stdout: stdout.into(), first_err: None, last_err: last_err.map(str::to_string) }
    }

    /// Firstmate, current (build spec §6.3, §11.4): with a `quota-provider` in `config/lane-capacity` the capacity script
    /// never runs — it would run `quota-axi` — and the cycle has no lane reading; with a cap it runs, at most once in 30 s.
    #[test]
    fn cycle_never_runs_capacity_with_a_quota_provider() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        for sub in ["bin", "config", "state"] {
            std::fs::create_dir_all(home.join(sub)).unwrap();
        }
        let stub = home.join("bin/fm-capacity.sh");
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/crew-capacity.cap4.synthetic.json");
        std::fs::write(&stub, format!("#!/bin/sh\nprintf 'fm-capacity.sh %s\\n' \"$*\" >> \"$FM_HOME/state/calls.log\"\ncat '{}'\n", fixture.display())).unwrap();
        std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
        let calls = || std::fs::read_to_string(home.join("state/calls.log")).unwrap_or_default();
        let mut memo = Memo::default();
        let now = 1_790_000_000_000;

        assert!(lanes_due(home, &mut memo, now).is_none(), "no file, no reading");
        std::fs::write(home.join("config/lane-capacity"), "4\nquota-provider claude\n").unwrap();
        assert!(lanes_due(home, &mut memo, now).is_none(), "a quota provider closes the gate");
        assert_eq!(calls(), "", "the script never ran");

        std::fs::write(home.join("config/lane-capacity"), "4\n").unwrap();
        let lanes = lanes_due(home, &mut memo, now).expect("a cap opens the gate").expect("the stub's document");
        assert_eq!((lanes.cap, lanes.free, lanes.at), (Some(4), Some(2), now));
        assert_eq!(calls(), "fm-capacity.sh --json\n");
        assert!(lanes_due(home, &mut memo, now + 29_999).is_none(), "not again within 30 s");
        assert!(lanes_due(home, &mut memo, now + 30_000).is_some(), "again after 30 s");
        assert_eq!(calls().lines().count(), 2);
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

    /// A Herdr-only ask waits for the 2 s gap after the last one — a gap, not a moment to reach again. After the wall
    /// clock stepped back to between the last cycle and a later Herdr ask, the gap read negative and a launch's fresh
    /// view waited the length of the step: the chrome read the old session meanwhile.
    #[test]
    fn a_clock_that_went_back_does_not_hold_a_herdr_ask() {
        let now = 1_790_000_000_000;
        assert_eq!(herdr_due(now - 500, now), now - 500 + HERDR_MIN_GAP_MS, "the gap still holds forward");
        assert!(herdr_due(now - HERDR_MIN_GAP_MS, now) <= now);
        assert!(herdr_due(0, now) <= now, "never asked");
        assert!(herdr_due(now + 60_000, now) <= now, "an ask stamped in what is now the future: the gap has passed");
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
