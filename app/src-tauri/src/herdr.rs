//! The one door to Herdr: its CLI, run as a child with a fixed argv. Open in editor (`reader/editor.rs`) and Open in the
//! terminal (`reader/workspace.rs`) both go through here, and nothing here or there types into the Kinas terminal — when
//! Claude Code or Pi has that pane, the text would arrive as a prompt. Herdr 0.9.0.

use crate::proc::{self, Exit, Run};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// One workspace open at a time — Open in the terminal and the crew's launcher alike: two clicks racing between the
/// snapshot and the create would make two workspaces.
pub(crate) static OPENING: Mutex<()> = Mutex::new(());

pub(crate) const HERDR_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) const NO_FOCUSED_PANE: &str = "Herdr has no focused pane; attach it first";

/// Herdr's server did not answer. Its "focused pane" is the server's own state and is reported with no client
/// attached at all (measured), so unlike Open in editor there is no pane to ask for: the server answering is the
/// whole of what can be known.
pub(crate) const NOT_RUNNING: &str = "Herdr isn't running; attach it first";
pub(crate) const NOT_INSTALLED: &str = "Herdr isn't installed";

pub(crate) fn herdr_args(session: Option<&str>, rest: &[&str]) -> Vec<String> {
    let mut args = Vec::with_capacity(rest.len() + 2);
    if let Some(name) = session {
        args.push("--session".to_string());
        args.push(name.to_string());
    }
    args.extend(rest.iter().map(|s| s.to_string()));
    args
}

pub(crate) fn find_herdr() -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let executable = |p: &Path| std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0);
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let local = home.join(".local/bin/herdr");
    if executable(&local) {
        return Some(local);
    }
    // Then the login shell's PATH, not the app's: launchd hands Kinas a bare one.
    crate::crew::tools::which("herdr", crate::login_path::login_path())
}

/// The throwaway session e2e attaches (debug builds only, as `pty::first_command`); otherwise Herdr's own default.
pub(crate) fn session() -> Option<String> {
    #[cfg(debug_assertions)]
    if let Ok(name) = std::env::var("KINAS_HERDR_SESSION") {
        if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Some(name);
        }
    }
    None
}

/// One `herdr` call through `proc::run` — every HERDR* variable removed (a Kinas started from a Herdr pane would
/// otherwise be refused as nested), null stdin, its process group killed at 3 s. Returns stdout.
pub(crate) fn run(herdr: &Path, args: &[String]) -> Result<String, String> {
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    let ran = proc::run(&Run { program: herdr, args: &argv, cwd: None, set: &[], limit: HERDR_TIMEOUT }).map_err(|e| format!("could not run herdr: {e}"))?;
    match ran.exit {
        Exit::Code(0) => Ok(ran.stdout),
        Exit::TimedOut => Err("Herdr did not answer within 3 s".into()),
        Exit::Code(code) => {
            let line = ran.first_err.or_else(|| ran.stdout.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string));
            Err(line.map_or_else(|| format!("herdr exited with {code}"), |l| format!("herdr: {l}")))
        }
        Exit::Signal => Err("herdr was stopped by a signal".into()),
    }
}

/// Herdr's view of the session, from `api snapshot` (slice 0's capture, `fixtures/herdr-api-snapshot.captured.json`):
/// `result.snapshot.{focused_pane_id, workspaces[], panes[], tabs[]}`, a pane's tab label joined from `tabs[]`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct View {
    pub focused_pane: Option<String>,
    pub workspaces: Vec<Workspace>,
    pub panes: Vec<Pane>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Workspace {
    pub id: String,
    pub label: String,
    pub number: u32,
    pub focused: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Pane {
    pub id: String,
    pub workspace_id: String,
    pub tab_label: Option<String>,
    pub focused: bool,
    pub cwd: Option<String>,
}

impl View {
    pub fn pane(&self, id: &str) -> Option<&Pane> {
        self.panes.iter().find(|p| p.id == id)
    }

    pub fn workspace(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == id)
    }
}

pub(crate) fn parse_view(json: &str) -> Result<View, String> {
    use serde_json::Value;
    let root: Value = serde_json::from_str(json).map_err(|e| format!("Herdr's snapshot is not JSON: {e}"))?;
    let snap = root.pointer("/result/snapshot").ok_or("Herdr's snapshot has no result.snapshot")?;
    let text = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    let list = |k: &str| snap.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    let tabs: Vec<(String, String)> = list("tabs").iter().filter_map(|t| Some((text(t, "tab_id")?, text(t, "label")?))).collect();
    let workspaces = list("workspaces")
        .iter()
        .filter_map(|w| {
            Some(Workspace {
                id: text(w, "workspace_id")?,
                label: text(w, "label").unwrap_or_default(),
                number: w.get("number").and_then(Value::as_u64).unwrap_or(u64::from(u32::MAX)) as u32,
                focused: w.get("focused").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect();
    let panes = list("panes")
        .iter()
        .filter_map(|p| {
            let tab = text(p, "tab_id");
            Some(Pane {
                id: text(p, "pane_id")?,
                workspace_id: text(p, "workspace_id")?,
                tab_label: tab.and_then(|t| tabs.iter().find(|(id, _)| *id == t).map(|(_, l)| l.clone())),
                focused: p.get("focused").and_then(Value::as_bool).unwrap_or(false),
                cwd: text(p, "cwd"),
            })
        })
        .collect();
    Ok(View { focused_pane: text(snap, "focused_pane_id"), workspaces, panes })
}

/// `herdr api snapshot` for the attached session.
pub(crate) fn api_snapshot(herdr: &Path) -> Result<View, String> {
    parse_view(&run(herdr, &herdr_args(session().as_deref(), &["api", "snapshot"]))?)
}

/// The workspace carrying `label`: of several, the focused one, else the lowest number.
pub(crate) fn workspace_with_label<'a>(v: &'a View, label: &str) -> Option<&'a Workspace> {
    v.workspaces.iter().filter(|w| w.label == label).min_by_key(|w| (!w.focused, w.number))
}

/// The foreground programs of a pane: `pane process-info` → `result.process_info.foreground_processes[].argv0` — never
/// `name`, which for Claude Code is its version (slice 0).
pub(crate) fn foreground(herdr: &Path, pane: &str) -> Result<Vec<String>, String> {
    Ok(parse_foreground(&run(herdr, &herdr_args(session().as_deref(), &["pane", "process-info", "--pane", pane]))?))
}

pub(crate) fn parse_foreground(json: &str) -> Vec<String> {
    let Ok(root) = serde_json::from_str::<serde_json::Value>(json) else { return Vec::new() };
    root.pointer("/result/process_info/foreground_processes")
        .and_then(|v| v.as_array())
        .map(|ps| ps.iter().filter_map(|p| p.get("argv0").and_then(|a| a.as_str()).map(str::to_string)).collect())
        .unwrap_or_default()
}

pub(crate) fn workspace_focus(herdr: &Path, id: &str) -> Result<(), String> {
    run(herdr, &herdr_args(session().as_deref(), &["workspace", "focus", id])).map(|_| ())
}

/// `workspace create --cwd <cwd> --label <label> --focus` → the new workspace's pane, `result.root_pane.pane_id`.
pub(crate) fn workspace_create(herdr: &Path, cwd: &Path, label: &str) -> Result<String, String> {
    let cwd = cwd.to_string_lossy();
    let out = run(herdr, &herdr_args(session().as_deref(), &["workspace", "create", "--cwd", &cwd, "--label", label, "--focus"]))?;
    root_pane(&out).ok_or_else(|| "Herdr did not say which pane it opened".into())
}

pub(crate) fn root_pane(json: &str) -> Option<String> {
    let root: serde_json::Value = serde_json::from_str(json).ok()?;
    root.pointer("/result/root_pane/pane_id")?.as_str().map(str::to_string)
}

/// `pane run <pane> <command>`: Herdr types the command at the pane's shell prompt (slice 0). Only the crew's launcher
/// and Open in editor use it, and never on Kinas's own pane.
pub(crate) fn pane_run(herdr: &Path, pane: &str, command: &str) -> Result<(), String> {
    run(herdr, &herdr_args(session().as_deref(), &["pane", "run", pane, command])).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)).unwrap()
    }

    #[test]
    fn api_snapshot_parses_the_capture() {
        let view = parse_view(&fixture("herdr-api-snapshot.captured.json")).unwrap();
        assert_eq!(view.focused_pane.as_deref(), Some("w1:p1"));
        let labels: Vec<(&str, &str, bool)> = view.workspaces.iter().map(|w| (w.id.as_str(), w.label.as_str(), w.focused)).collect();
        assert_eq!(labels[0], ("w1", "firstmate", true));
        let first = view.pane("w1:p1").unwrap();
        assert_eq!((first.workspace_id.as_str(), first.focused), ("w1", true));
        let worker = view.pane("w2:p2").unwrap();
        assert_eq!(worker.tab_label.as_deref(), Some("fm-scratch-count-files-c4"));
        assert!(parse_view("not json").is_err());
        assert!(parse_view("{}").is_err());
    }

    #[test]
    fn workspace_with_label_prefers_focused_then_lowest() {
        let view = parse_view(&fixture("herdr-api-snapshot.captured.json")).unwrap();
        assert_eq!(workspace_with_label(&view, "firstmate").map(|w| w.id.as_str()), Some("w1"));
        assert_eq!(workspace_with_label(&view, "nothing"), None);
        let ws = |id: &str, number: u32, focused: bool| Workspace { id: id.into(), label: "docs".into(), number, focused };
        let many = View { workspaces: vec![ws("w5", 5, false), ws("w2", 2, false), ws("w9", 9, true)], ..View::default() };
        assert_eq!(workspace_with_label(&many, "docs").map(|w| w.id.as_str()), Some("w9"));
        let none_focused = View { workspaces: vec![ws("w5", 5, false), ws("w2", 2, false)], ..View::default() };
        assert_eq!(workspace_with_label(&none_focused, "docs").map(|w| w.id.as_str()), Some("w2"));
    }

    #[test]
    fn the_foreground_is_argv0_never_the_name() {
        assert_eq!(parse_foreground(&fixture("herdr-process-info.claude.captured.json")), ["caffeinate", "claude"]);
        assert_eq!(parse_foreground(&fixture("herdr-process-info.shell.captured.json")), ["zsh"]);
        assert!(parse_foreground("{}").is_empty());
    }

    #[test]
    fn a_new_workspace_answers_with_its_root_pane() {
        assert_eq!(root_pane(&fixture("herdr-workspace-create.captured.json")).as_deref(), Some("w1:p1"));
        assert_eq!(root_pane("{}"), None);
    }

    #[test]
    fn the_session_flag_comes_first_when_there_is_one() {
        assert_eq!(herdr_args(Some("kinas-e2e-editor"), &["pane", "list"]), ["--session", "kinas-e2e-editor", "pane", "list"]);
        assert_eq!(herdr_args(None, &["pane", "list"]), ["pane", "list"]);
    }
}
