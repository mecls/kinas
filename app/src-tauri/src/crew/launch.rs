//! The launcher (build spec §6.1, §6.11, §6.16, §11.3 Launching): one first mate per session. It finds the workspace
//! labelled `firstmate` in the session the Work pane attaches — Firstmate's own label — focuses it, and runs `claude`
//! in its pane only when `claude` is not already that pane's foreground; with no such workspace it creates one in
//! Firstmate's home and runs `claude` there. The pane command is exactly `claude`, or `claude '<sentence>'` with ADR
//! 0017's one sentence; nothing else is ever run or typed, and Kinas's own pane is never touched. Serialised by
//! `herdr::OPENING` with Open in the terminal, so two clicks never make two workspaces.

use super::home::{self, PinState};
use super::pin::WORKSPACE_LABEL;
use super::tools::{self, Health};
use super::CrewError;
use crate::herdr::{self, View, NOT_INSTALLED, NOT_RUNNING, OPENING};
use serde::Serialize;
use std::path::Path;

/// What the pane is asked, besides starting: nothing, or ADR 0017's Add to crew sentence (built by `repo::sentence`).
pub(crate) enum Ask {
    None,
    #[allow(dead_code)] // Add to crew, slice 8.
    Add(String),
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Launched {
    /// The first mate was running: its workspace is focused.
    Focused,
    /// Its workspace was there without `claude`: focused, and `claude` run in its pane.
    Run,
    /// There was none: made in Firstmate's home, and `claude` run in its pane.
    Created,
}

impl Launched {
    pub fn word(self) -> &'static str {
        match self {
            Launched::Focused => "focused",
            Launched::Run => "run",
            Launched::Created => "created",
        }
    }
}

/// The program that is the first mate: `claude`, or in a debug build `KINAS_E2E_CREW_COMMAND`, a stand-in that records
/// its arguments. The stand-in is named `claude` too, so the running check below holds for it.
pub(crate) fn program() -> String {
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var("KINAS_E2E_CREW_COMMAND").ok().filter(|p| p.starts_with('/')) {
        return p;
    }
    "claude".into()
}

/// `claude` or `claude '<sentence>'` — the pane's whole command. A program path other than `claude` (the e2e stand-in)
/// is quoted; the sentence always is, and holds no quote of its own (its URL is checked, `repo::github_url`).
pub(crate) fn pane_command(program: &str, ask: &Ask) -> String {
    let bare = program.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-'));
    let program = if bare { program.to_string() } else { crate::pty::sh_quote(program) };
    match ask {
        Ask::None => program,
        Ask::Add(sentence) => format!("{program} {}", crate::pty::sh_quote(sentence)),
    }
}

/// The pane of the `firstmate` workspace the launcher runs in and checks: its focused pane, else its first.
pub(crate) fn first_mate_pane<'a>(v: &'a View, workspace: &str) -> Option<&'a herdr::Pane> {
    let panes: Vec<&herdr::Pane> = v.panes.iter().filter(|p| p.workspace_id == workspace).collect();
    panes.iter().find(|p| p.focused).or(panes.first()).copied()
}

/// The first mate's pane when `claude` is among its foreground programs (by `argv0`, slice 0).
pub(crate) fn first_mate_running(v: &View, fg: impl Fn(&str) -> Vec<String>) -> Option<String> {
    let ws = herdr::workspace_with_label(v, WORKSPACE_LABEL)?;
    let pane = first_mate_pane(v, &ws.id)?;
    fg(&pane.id).iter().any(|a| a == "claude" || a.ends_with("/claude")).then(|| pane.id.clone())
}

fn refuse(code: &'static str, message: impl Into<String>) -> CrewError {
    CrewError { code, message: message.into() }
}

/// What must be true before Herdr is asked anything: installed, at a pin state the first mate can start from, every
/// required tool there. The one line the Crew page and the sidebar show.
pub(crate) fn preflight(home: &Path, health: &Health) -> Result<(), CrewError> {
    if !home::installed(home) {
        return Err(refuse("not_installed", "Firstmate isn't installed — run kinas crew setup in the Work pane"));
    }
    if let PinState::Tangle { branch } = &health.pin {
        return Err(refuse("tangle", format!("Firstmate's home is on branch {branch} — a tangle; ask the first mate")));
    }
    if let Some(tool) = tools::first_missing_required(health) {
        return Err(refuse("missing_tool", format!("{tool} isn't installed — run kinas crew setup")));
    }
    Ok(())
}

pub(crate) fn launch(home: &Path, health: &Health, ask: &Ask) -> Result<Launched, CrewError> {
    let _one_at_a_time = OPENING.lock().unwrap_or_else(|p| p.into_inner());
    preflight(home, health)?;
    if crate::pty::pane_session().shell {
        return Err(refuse("herdr_not_running", NOT_RUNNING));
    }
    let herdr = herdr::find_herdr().ok_or_else(|| refuse("herdr_not_installed", NOT_INSTALLED))?;
    let view = herdr::api_snapshot(&herdr).map_err(|_| refuse("herdr_not_running", NOT_RUNNING))?;
    let command = pane_command(&program(), ask);
    let internal = |e: String| refuse("internal", e);
    if let Some(ws) = herdr::workspace_with_label(&view, WORKSPACE_LABEL) {
        let ws_id = ws.id.clone();
        let pane = first_mate_pane(&view, &ws_id).map(|p| p.id.clone());
        let running = first_mate_running(&view, |p| herdr::foreground(&herdr, p).unwrap_or_default()).is_some();
        herdr::workspace_focus(&herdr, &ws_id).map_err(internal)?;
        if running {
            return Ok(Launched::Focused);
        }
        let pane = pane.ok_or_else(|| internal("the first mate's workspace has no pane".into()))?;
        herdr::pane_run(&herdr, &pane, &command).map_err(internal)?;
        return Ok(Launched::Run);
    }
    let pane = herdr::workspace_create(&herdr, home, WORKSPACE_LABEL).map_err(internal)?;
    herdr::pane_run(&herdr, &pane, &command).map_err(internal)?;
    Ok(Launched::Created)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::herdr::{Pane, Workspace};

    #[test]
    fn pane_command_is_exact() {
        assert_eq!(pane_command("claude", &Ask::None), "claude");
        assert_eq!(
            pane_command("claude", &Ask::Add("Add the project https://github.com/o/r to the crew: clone it from GitHub, not from my desk, and ask me which mode it ships in.".into())),
            "claude 'Add the project https://github.com/o/r to the crew: clone it from GitHub, not from my desk, and ask me which mode it ships in.'"
        );
        assert_eq!(pane_command("/tmp/kinas-e2e-x/stand in/claude", &Ask::None), "'/tmp/kinas-e2e-x/stand in/claude'");
        assert_eq!(pane_command("/tmp/kinas-e2e-x/bin/claude", &Ask::None), "/tmp/kinas-e2e-x/bin/claude");
    }

    fn view() -> View {
        let ws = |id: &str, label: &str, number: u32, focused: bool| Workspace { id: id.into(), label: label.into(), number, focused };
        let pane = |id: &str, ws: &str, focused: bool| Pane { id: id.into(), workspace_id: ws.into(), tab_label: None, focused, cwd: None };
        View {
            focused_pane: Some("w1:p1".into()),
            workspaces: vec![ws("w1", "kinas", 1, true), ws("w2", "firstmate", 2, false)],
            panes: vec![pane("w1:p1", "w1", true), pane("w2:p1", "w2", false), pane("w2:p2", "w2", true)],
        }
    }

    #[test]
    fn the_first_mate_runs_when_claude_is_the_foreground_of_its_focused_pane() {
        let v = view();
        assert_eq!(first_mate_running(&v, |p| if p == "w2:p2" { vec!["caffeinate".into(), "claude".into()] } else { vec![] }), Some("w2:p2".into()));
        assert_eq!(first_mate_running(&v, |_| vec!["zsh".into()]), None, "a shell is not the first mate");
        assert_eq!(first_mate_running(&v, |_| vec!["2.1.281".into()]), None, "Claude Code's name is its version, never read");
        let none = View { workspaces: vec![], ..v };
        assert_eq!(first_mate_running(&none, |_| vec!["claude".into()]), None);
    }

    #[test]
    fn preflight_refuses_with_one_line() {
        let dir = tempfile::tempdir().unwrap();
        let health = |tools: Vec<tools::ToolState>, pin: PinState| Health { tools, prereqs: vec![], gh_signed_in: Some(true), pin, checked_at: 0 };
        let tasks = |state: &'static str| tools::ToolState { name: "tasks-axi", pinned: "0.2.5", installed: None, state, required: true };
        let err = preflight(dir.path(), &health(vec![], PinState::Missing)).unwrap_err();
        assert_eq!((err.code, err.message.as_str()), ("not_installed", "Firstmate isn't installed — run kinas crew setup in the Work pane"));
        std::fs::create_dir_all(dir.path().join("bin")).unwrap();
        std::fs::write(dir.path().join("bin/fm-fleet-snapshot.sh"), "").unwrap();
        let err = preflight(dir.path(), &health(vec![tasks("missing")], PinState::Moved { short: "9296f9b".into(), from: "f9f74a1".into() })).unwrap_err();
        assert_eq!((err.code, err.message.as_str()), ("missing_tool", "tasks-axi isn't installed — run kinas crew setup"));
        let err = preflight(dir.path(), &health(vec![], PinState::Tangle { branch: "fix".into() })).unwrap_err();
        assert_eq!(err.code, "tangle");
        assert!(preflight(dir.path(), &health(vec![tasks("installed")], PinState::Pinned { short: "f9f74a1".into() })).is_ok());
    }

    #[test]
    fn what_the_webview_is_told_is_one_word() {
        assert_eq!(serde_json::to_string(&Launched::Created).unwrap(), "\"created\"");
        assert_eq!(Launched::Run.word(), "run");
    }
}
