//! The crew's commands (build spec §11.2): the first mate is Firstmate, adopted (ADR 0016), and Kinas builds only the
//! bridge. Every command that touches a file, a process or the store runs off the main thread (`spawn_blocking`, the
//! `list_projects` shape); `set_crew_visible` touches memory only.

pub(crate) mod answer;
pub(crate) mod config;
pub(crate) mod firstmate;
pub(crate) mod home;
pub(crate) mod launch;
pub(crate) mod pin;
pub(crate) mod read;
pub(crate) mod repo;
pub(crate) mod tools;

use crate::readers::crew::{CrewLive, HERDR_FRESH_MS};
use crate::readers::runtime::ReaderControl;
use crate::store::{now_ms, Store};
use config::{Away, ProjectMode};
use home::PinState;
use read::CrewSnapshot;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use tools::{Health, ToolState};

/// A refusal the webview shows as it is (the `ReaderError` shape).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CrewError {
    code: &'static str,
    message: String,
}

impl CrewError {
    fn internal(message: impl Into<String>) -> Self {
        CrewError { code: "internal", message: message.into() }
    }
}

fn crew_home(app: &AppHandle) -> PathBuf {
    home::home_in(app.state::<ReaderControl>().data_dir())
}

/// "<tool> isn't installed — run kinas crew setup": what blocks the launch, from the health the app last probed.
fn blocked_line(h: &Health) -> Option<String> {
    tools::first_missing_required(h).map(|tool| format!("{tool} isn't installed — run kinas crew setup"))
}

/// The Crew page's reading: the tasks inside retention, the page's state and the collector's status. It never probes
/// the tools itself (it is read every 30 s); `blocked` comes from the health Settings or the page last asked for.
#[tauri::command]
pub async fn crew_snapshot(app: AppHandle) -> Result<CrewSnapshot, CrewError> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crew_home(&app);
        // The file check and the collector's memory, before the guard.
        let installed = home::installed(&home);
        let live = app.state::<CrewLive>();
        let generated = live.generated();
        let running = live.live().first_mate_there();
        let blocked = tools::cached(&home).as_ref().and_then(blocked_line);
        let store = app.state::<Store>();
        let conn = store.conn();
        let mut view = read::snapshot_view(&conn, store.org_id(), now_ms(), installed, running, generated).map_err(|e| CrewError::internal(format!("could not read the crew: {e}")))?;
        view.blocked = blocked;
        Ok(view)
    })
    .await
    .map_err(|e| CrewError::internal(format!("the crew reading did not finish: {e}")))?
}

/// The Crew page is on screen, or no longer is (§6.6): the collector's baseline and its Visible trigger.
#[tauri::command]
pub fn set_crew_visible(control: State<'_, ReaderControl>, visible: bool) {
    control.set_crew_visible(visible);
}

/// **Launch the first mate** and **First mate** on the Crew page, the palette's Go to the first mate, Home's Launch
/// task while the first mate runs (§11.3 Launching): the launcher, its one log line, then a fresh Herdr view so the
/// page reads as running.
#[tauri::command]
pub async fn crew_launch(app: AppHandle) -> Result<launch::Launched, CrewError> {
    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
        let home = crew_home(&app);
        // Probes at most once a minute; a tool the captain just installed is seen after Refresh readings.
        let (health, _) = tools::health(&home, now_ms());
        let launched = launch::launch(&home, &health, &launch::Ask::None)?;
        log::info!("crew: launched ({}) in {} ms", launched.word(), started.elapsed().as_millis());
        app.state::<ReaderControl>().crew_herdr();
        Ok(launched)
    })
    .await
    .map_err(|e| CrewError::internal(format!("the launcher did not finish: {e}")))?
}

/// The right panel's task (§4 Task detail): the mirror's row under one guard, then — with the guard released — the
/// files it links to and the checks `gh` last listed. None when the mirror never held the id.
#[tauri::command]
pub async fn crew_task(app: AppHandle, id: String) -> Result<Option<read::CrewTaskDetail>, CrewError> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crew_home(&app);
        let detail = {
            let store = app.state::<Store>();
            let conn = store.conn();
            read::task_view(&conn, store.org_id(), &id, now_ms()).map_err(|e| CrewError::internal(format!("could not read the task: {e}")))?
        };
        let Some(mut detail) = detail else { return Ok(None) };
        let task_id = detail.task.id.clone();
        detail.brief_path = safe_id(&task_id)
            .then(|| home.join("data").join(&task_id).join("brief.md"))
            .filter(|p| p.is_file())
            .map(|p| p.display().to_string());
        detail.report_path = detail.paths.report.as_deref().filter(|_| detail.report_present).and_then(|p| under_home(&home, p)).map(|p| p.display().to_string());
        detail.worktree_display = detail.paths.worktree.as_deref().map(|w| crate::projects::display_of(Path::new(w), &user_home()));
        if let Some(url) = detail.paths.pr_url.as_deref() {
            let checks = app.state::<CrewLive>().checks_of(url);
            detail.checks = checks.into_iter().map(|(name, conclusion)| read::CheckView { name, conclusion }).collect();
        }
        Ok(Some(detail))
    })
    .await
    .map_err(|e| CrewError::internal(format!("the task did not finish reading: {e}")))?
}

/// A Firstmate task id, safe to name a folder under `<home>/data/`: letters, digits, `.`, `_` and `-`, not starting
/// with a dot.
fn safe_id(id: &str) -> bool {
    !id.is_empty() && !id.starts_with('.') && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// A path Firstmate reported, relative to its home or absolute, only when it stays lexically inside the home.
fn under_home(home: &Path, reported: &str) -> Option<PathBuf> {
    let path = Path::new(reported);
    let path = if path.is_absolute() { path.to_path_buf() } else { home.join(path) };
    let clean = !path.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::CurDir));
    (clean && path.starts_with(home)).then_some(path)
}

/// **Open its pane** on a card or in the panel (§4, §6.8, rule 22's clicks): the task's worker row — fresh, in the
/// session Kinas attaches — and its workspace focused. Never a pane found by tab label or folder, never typed into.
#[tauri::command]
pub async fn crew_focus_pane(app: AppHandle, task: String) -> Result<(), CrewError> {
    tauri::async_runtime::spawn_blocking(move || {
        let worker = {
            let store = app.state::<Store>();
            let conn = store.conn();
            read::fresh_worker(&conn, store.org_id(), &task, now_ms()).map_err(|e| CrewError::internal(format!("could not read the worker: {e}")))?
        };
        let session = crate::readers::crew::attached_session();
        let workspace = worker
            .filter(|(s, _)| session.as_deref() == Some(s.as_str()))
            .and_then(|(_, workspace)| workspace)
            .ok_or_else(|| CrewError { code: "no_task", message: "That task has no pane in this session".into() })?;
        let herdr = crate::herdr::find_herdr().ok_or_else(|| CrewError { code: "herdr_not_installed", message: crate::herdr::NOT_INSTALLED.into() })?;
        crate::herdr::workspace_focus(&herdr, &workspace).map_err(|_| CrewError { code: "herdr_not_running", message: crate::herdr::NOT_RUNNING.into() })?;
        app.state::<ReaderControl>().crew_herdr();
        Ok(())
    })
    .await
    .map_err(|e| CrewError::internal(format!("the focus did not finish: {e}")))?
}

/// An Inbox answer (§11.3 Answering; ADR 0017): the line from the open decision row onto the clipboard, `copied_at`
/// stamped and `crew_changed` said — the item reads Copied and still counts — then the launcher, so the first mate's
/// pane is where the captain pastes it. A launcher refusal is this command's rejection; the line stays on the
/// clipboard. No Firstmate script runs, and the answer's words are never logged.
#[tauri::command]
pub async fn crew_answer(app: AppHandle, task: String, key: String, kind: answer::AnswerKind, text: String) -> Result<launch::Launched, CrewError> {
    tauri::async_runtime::spawn_blocking(move || {
        let main = app.clone();
        {
            let store = app.state::<Store>();
            answer::copy(&store, &task, &key, kind, &text, now_ms(), |line| on_main(&main, line))?;
        }
        let _ = app.emit(crate::readers::runtime::CREW_CHANGED, ());
        crate::tray::refresh(&app);
        log::info!("crew: answer copied");
        let started = std::time::Instant::now();
        let home = crew_home(&app);
        let (health, _) = tools::health(&home, now_ms());
        let launched = launch::launch(&home, &health, &launch::Ask::None)?;
        log::info!("crew: launched ({}) in {} ms", launched.word(), started.elapsed().as_millis());
        app.state::<ReaderControl>().crew_herdr();
        Ok(launched)
    })
    .await
    .map_err(|e| CrewError::internal(format!("the answer did not finish: {e}")))?
}

/// `write_clipboard` on the main thread, where AppKit's pasteboard belongs, waited for from this one.
fn on_main(app: &AppHandle, line: &str) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let text = line.to_string();
    app.run_on_main_thread(move || {
        let _ = tx.send(crate::commands::write_clipboard(&text));
    })
    .map_err(|e| format!("the main thread did not take the copy: {e}"))?;
    rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "the clipboard did not answer within 5 s".to_string())?
}

/// What the Work page's chrome says about the pane (§4 Work): the session, then the focused workspace's label — a
/// worker's tab label for a worker's pane — the task's word only for a worker's pane, and `claude` when Herdr reports
/// it in the foreground. From Herdr's last view, in memory; an older view asks the crew's thread for a fresh one and
/// drops the badge once it is 15 s old. Nothing is drawn from a guess.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PaneState {
    pub session: String,
    pub workspace: Option<String>,
    pub word: Option<&'static str>,
    pub profile: Option<String>,
    pub stale: bool,
}

const PANE_STALE_MS: i64 = 15_000;

#[tauri::command]
pub fn crew_pane_state(app: AppHandle) -> PaneState {
    let pane = crate::pty::pane_session();
    if pane.shell {
        return PaneState { session: pane.session, workspace: None, word: None, profile: Some("plain shell".into()), stale: false };
    }
    let live = app.state::<CrewLive>().live();
    let now = now_ms();
    if now - live.observed_at >= HERDR_FRESH_MS {
        app.state::<ReaderControl>().crew_herdr();
    }
    pane_state_of(pane.session, &live, now)
}

fn pane_state_of(session: String, live: &crate::readers::crew::LiveView, now: i64) -> PaneState {
    let stale = live.view.is_none() || now - live.observed_at > PANE_STALE_MS;
    let Some(view) = live.view.as_ref() else { return PaneState { session, workspace: None, word: None, profile: None, stale } };
    let focused = view.focused_pane.as_deref().and_then(|id| view.pane(id));
    let worker = focused.and_then(|p| live.worker_words.get(&p.id));
    let workspace = match (focused, worker) {
        (Some(p), Some(_)) => p.tab_label.clone(),
        (Some(p), None) => view.workspace(&p.workspace_id).map(|w| w.label.clone()),
        (None, _) => None,
    };
    let profile = match worker {
        Some((_, harness)) => harness.clone(),
        None => live.focused_foreground.iter().any(|a| a == "claude" || a.ends_with("/claude")).then(|| "claude".to_string()),
    };
    PaneState { session, workspace, word: worker.map(|(w, _)| *w).filter(|_| !stale), profile, stale }
}

/// Settings → Crew, and the Crew page's tool table (§4 Settings).
#[derive(Debug, Serialize)]
pub struct CrewSettings {
    pub pin: PinState,
    pub home_display: String,
    pub backend: Option<String>,
    pub tools: Vec<ToolState>,
    pub prereqs: Vec<ToolState>,
    pub gh_signed_in: Option<bool>,
    pub away: Option<Away>,
    pub projects: Vec<ProjectMode>,
    pub installed: bool,
    /// The same line the Crew page's Launch carries when a required tool is missing.
    pub blocked: Option<String>,
}

#[tauri::command]
pub async fn crew_settings(app: AppHandle) -> Result<CrewSettings, CrewError> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crew_home(&app);
        let now = now_ms();
        let installed = home::installed(&home);
        // The probes and Firstmate's scripts run with no guard held.
        let (health, fresh) = tools::health(&home, now);
        let settings = CrewSettings {
            pin: health.pin.clone(),
            home_display: crate::projects::display_of(&home, &user_home()),
            backend: home::backend(&home),
            tools: health.tools.clone(),
            prereqs: health.prereqs.clone(),
            gh_signed_in: health.gh_signed_in,
            away: if installed { config::away(&home) } else { None },
            projects: if installed { config::project_modes(&home, now) } else { Vec::new() },
            installed,
            blocked: blocked_line(&health),
        };
        if fresh {
            let store = app.state::<Store>();
            let conn = store.conn();
            let _ = crate::system::put_setting(&conn, store.org_id(), HEALTH_KEY, &health_json(&health, installed));
        }
        Ok(settings)
    })
    .await
    .map_err(|e| CrewError::internal(format!("the crew's settings did not finish: {e}")))?
}

/// What `kinas crew status` shows of the install with the app closed (§4 The CLI): the commit the app last saw and each
/// tool's version and state. Names and versions only.
const HEALTH_KEY: &str = "crew_health";

fn health_json(h: &Health, installed: bool) -> serde_json::Value {
    let at = match &h.pin {
        PinState::Pinned { short } | PinState::Moved { short, .. } => Some(short.clone()),
        PinState::Tangle { .. } | PinState::Missing => None,
    };
    serde_json::json!({
        "installed": installed,
        "at": at,
        "tools": h.tools.iter().map(|t| serde_json::json!({ "name": t.name, "version": t.installed, "ok": t.state == "installed" })).collect::<Vec<_>>(),
        "checked_at": h.checked_at,
    })
}

fn user_home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| Path::new("/").to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::herdr::{Pane, View, Workspace};
    use crate::readers::crew::LiveView;

    fn live(focused: &str, fg: &[&str], observed_at: i64) -> LiveView {
        let ws = |id: &str, label: &str| Workspace { id: id.into(), label: label.into(), number: 1, focused: false };
        let pane = |id: &str, w: &str, tab: &str| Pane { id: id.into(), workspace_id: w.into(), tab_label: Some(tab.into()), focused: id == focused, cwd: None };
        LiveView {
            view: Some(View {
                focused_pane: Some(focused.into()),
                workspaces: vec![ws("w1", "firstmate"), ws("w2", "└ shop-9c2e · p:x"), ws("w3", "kinas")],
                panes: vec![pane("w1:p1", "w1", "1"), pane("w2:p2", "w2", "fm-shop-9c2e"), pane("w3:p1", "w3", "1")],
            }),
            focused_foreground: fg.iter().map(|s| s.to_string()).collect(),
            observed_at,
            worker_words: [("w2:p2".to_string(), ("working", Some("claude".to_string())))].into(),
        }
    }

    #[test]
    fn the_chrome_says_only_what_is_known() {
        let now = 100_000;
        let first_mate = pane_state_of("default".into(), &live("w1:p1", &["caffeinate", "claude"], now), now);
        assert_eq!(first_mate, PaneState { session: "default".into(), workspace: Some("firstmate".into()), word: None, profile: Some("claude".into()), stale: false });
        let worker = pane_state_of("default".into(), &live("w2:p2", &["claude"], now), now);
        assert_eq!(worker, PaneState { session: "default".into(), workspace: Some("fm-shop-9c2e".into()), word: Some("working"), profile: Some("claude".into()), stale: false });
        let shell = pane_state_of("default".into(), &live("w3:p1", &["zsh"], now), now);
        assert_eq!((shell.workspace.as_deref(), shell.word, shell.profile), (Some("kinas"), None, None));
        let old = pane_state_of("default".into(), &live("w2:p2", &["claude"], now - 16_000), now);
        assert_eq!((old.word, old.stale), (None, true), "a stale view drops the badge");
        let none = pane_state_of("default".into(), &LiveView::default(), now);
        assert_eq!((none.workspace, none.stale), (None, true));
    }

    #[test]
    fn the_panels_paths_stay_in_the_home() {
        assert!(safe_id("shop-health-9c2e") && safe_id("a.b_c"));
        for bad in ["", ".hidden", "a/b", "../x", "a b", "a\u{0}"] {
            assert!(!safe_id(bad), "{bad:?}");
        }
        let home = Path::new("/h/firstmate");
        assert_eq!(under_home(home, "data/t/report.md"), Some(PathBuf::from("/h/firstmate/data/t/report.md")));
        assert_eq!(under_home(home, "/h/firstmate/data/t/report.md"), Some(PathBuf::from("/h/firstmate/data/t/report.md")));
        assert_eq!(under_home(home, "/etc/passwd"), None);
        assert_eq!(under_home(home, "data/../../x"), None);
        assert_eq!(under_home(home, "/h/firstmate-old/x"), None, "a sibling that shares the prefix is outside");
    }

    #[test]
    fn the_stored_health_is_names_versions_and_the_short_commit() {
        let h = Health {
            tools: vec![ToolState { name: "tasks-axi", pinned: "0.2.5", installed: Some("0.2.5".into()), state: "installed", required: true }],
            prereqs: vec![],
            gh_signed_in: Some(true),
            pin: PinState::Pinned { short: "f9f74a1".into() },
            checked_at: 7,
        };
        assert_eq!(
            health_json(&h, true),
            serde_json::json!({ "installed": true, "at": "f9f74a1", "tools": [{ "name": "tasks-axi", "version": "0.2.5", "ok": true }], "checked_at": 7 })
        );
        assert_eq!(blocked_line(&h), None);
        let missing = Health { tools: vec![ToolState { state: "missing", installed: None, ..h.tools[0].clone() }], ..h };
        assert_eq!(blocked_line(&missing).as_deref(), Some("tasks-axi isn't installed — run kinas crew setup"));
    }
}
