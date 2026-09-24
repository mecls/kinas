//! The crew's collector (build spec §6.6, §11.3): the thread `kinas-crew` runs Firstmate's fleet snapshot when the
//! schedule allows, parses it, and writes the mirror in one transaction under one guard — never holding the store
//! across the script (§6.15). Kinas reads the fleet this way only: no file under the home is opened except to learn
//! that one of the two trigger files changed.

pub mod mirror;
pub mod schedule;
pub mod snapshot;
pub mod word;

use super::runtime::{watch_with, ReaderControl, CREW_CHANGED};
use crate::crew::{firstmate, home};
use crate::proc::{Exit, Ran};
use crate::redact::{write_reader_status, Outcome, Reader};
use crate::store::{now_ms, Store};
use schedule::{CrewWake, Schedule};
use snapshot::{parse_fleet, Fleet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// A trigger file must be quiet this long before the snapshot runs: Firstmate rewrites the backlog in bursts.
const FILE_DEBOUNCE: Duration = Duration::from_millis(500);

/// The two files whose change means the fleet changed. Their contents are never read (§6.5).
const TRIGGERS: [&str; 2] = ["backlog.md", "home-summary.json"];

/// What the collector knows that the store does not hold, shared with the commands.
#[derive(Default)]
pub(crate) struct CrewLive {
    generated: Mutex<Option<String>>,
}

impl CrewLive {
    /// The last good snapshot's `generated`, for the Crew page's `as of` caption.
    pub(crate) fn generated(&self) -> Option<String> {
        self.generated.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

pub(crate) fn crew_loop(app: AppHandle, home: PathBuf, tx: Sender<CrewWake>, rx: Receiver<CrewWake>) {
    let mut schedule = Schedule::new();
    let mut watcher: Option<notify::RecommendedWatcher> = None;
    // The first cycle runs at once.
    let mut due: Option<i64> = Some(now_ms());
    loop {
        // Watched once the home exists: `kinas crew setup` may create it while Kinas runs.
        if watcher.is_none() {
            watcher = watch_home(&home, tx.clone());
        }
        schedule.set_visible(app.state::<ReaderControl>().crew_visible());
        let now = now_ms();
        let tick = schedule.run_at(&CrewWake::Tick, now);
        let next = due.map_or(tick, |d| d.min(tick));
        match rx.recv_timeout(Duration::from_millis(next.saturating_sub(now).max(0) as u64)) {
            Ok(wake) => {
                let mut wakes = vec![wake];
                if wake == CrewWake::File {
                    // Quiet for 500 ms first; whatever else arrives meanwhile joins this run.
                    while let Ok(more) = rx.recv_timeout(FILE_DEBOUNCE) {
                        wakes.push(more);
                    }
                }
                let now = now_ms();
                for wake in wakes {
                    if wake == CrewWake::Manual {
                        schedule.reset();
                    }
                    let at = schedule.run_at(&wake, now);
                    due = Some(due.map_or(at, |d| d.min(at)));
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                let ok = cycle(&app, &home);
                schedule.finished(now_ms(), ok);
                due = None;
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// One cycle: the snapshot, the parse, the write, the log line, `crew_changed`. Returns whether it succeeded.
fn cycle(app: &AppHandle, home: &Path) -> bool {
    let started = Instant::now();
    if !home::installed(home) {
        let store = app.state::<Store>();
        let conn = store.conn();
        let _ = write_reader_status(&conn, store.org_id(), Reader::Crew, Outcome::NotConfigured("Firstmate isn't installed"), now_ms());
        drop(conn);
        changed(app);
        return true;
    }
    // The script runs with no guard held.
    let outcome = firstmate::fleet_snapshot(home).and_then(|ran| read(&ran));
    let written = {
        let store = app.state::<Store>();
        let mut conn = store.conn();
        mirror::record(&mut conn, store.org_id(), &outcome, now_ms())
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
