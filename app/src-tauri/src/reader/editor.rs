//! Open in editor (reader PRD R36, R37): the file goes to a new Herdr pane split off the focused one, running the
//! editor from Settings. It is never typed into the Kinas terminal: when Claude Code or Pi has that pane, the text
//! would arrive as a prompt. Herdr 0.9.0's output shapes were measured in task 1.4 (PRD §7 Q1).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const DEFAULT_EDITOR: &str = "vim";
const MAX_EDITOR_CHARS: usize = 200;
const HERDR_TIMEOUT: Duration = Duration::from_secs(3);

pub const NO_FOCUSED_PANE: &str = "Herdr has no focused pane; attach it first";
pub const NOT_INSTALLED: &str = "Herdr isn't installed";

/// The `reader_editor` setting as stored (R36): trimmed, not empty, at most 200 characters, one line.
pub fn check_editor(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("the editor command is empty".into());
    }
    if value.chars().count() > MAX_EDITOR_CHARS {
        return Err(format!("the editor command is longer than {MAX_EDITOR_CHARS} characters"));
    }
    if value.contains(['\n', '\r']) {
        return Err("the editor command has a line break".into());
    }
    Ok(value.to_string())
}

/// `<editor> '<path>'`: the editor as Miguel typed it, the path always quoted, so a file named
/// `it's $(rm -rf ~).md` arrives as a name and never as a command.
pub fn editor_command(editor: &str, path: &Path) -> String {
    format!("{} {}", editor.trim(), crate::pty::sh_quote(&path.to_string_lossy()))
}

pub fn herdr_args(session: Option<&str>, rest: &[&str]) -> Vec<String> {
    let mut args = Vec::with_capacity(rest.len() + 2);
    if let Some(name) = session {
        args.push("--session".to_string());
        args.push(name.to_string());
    }
    args.extend(rest.iter().map(|s| s.to_string()));
    args
}

/// `herdr pane list` → the one pane with `"focused": true` (measured: one per client, even across workspaces).
pub fn focused_pane(list_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(list_json).ok()?;
    value.pointer("/result/panes")?.as_array()?.iter().find(|p| p.get("focused").and_then(|f| f.as_bool()) == Some(true))?.get("pane_id")?.as_str().map(str::to_string)
}

/// `herdr pane split` → `result.pane.pane_id`.
pub fn new_pane_id(split_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(split_json).ok()?;
    value.pointer("/result/pane/pane_id")?.as_str().map(str::to_string)
}

fn find_herdr() -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let executable = |p: &Path| std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0);
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let local = home.join(".local/bin/herdr");
    if executable(&local) {
        return Some(local);
    }
    std::env::var_os("PATH").and_then(|paths| std::env::split_paths(&paths).map(|dir| dir.join("herdr")).find(|p| executable(p)))
}

/// The throwaway session e2e attaches (debug builds only, as `pty::first_command`); otherwise Herdr's own default.
fn session() -> Option<String> {
    #[cfg(debug_assertions)]
    if let Ok(name) = std::env::var("KINAS_HERDR_SESSION") {
        if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Some(name);
        }
    }
    None
}

/// One `herdr` call with every HERDR* variable removed (a Kinas started from a Herdr pane would otherwise be refused
/// as nested) and a 3 s limit. Returns stdout.
fn run(herdr: &Path, args: &[String]) -> Result<String, String> {
    let mut command = Command::new(herdr);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for key in crate::pty::herdr_vars(std::env::vars_os()) {
        command.env_remove(key);
    }
    let mut child = command.spawn().map_err(|e| format!("could not run herdr: {e}"))?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_string(&mut text);
        }
        text
    });
    let err = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_string(&mut text);
        }
        text
    });
    let deadline = Instant::now() + HERDR_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Herdr did not answer within 3 s".into());
            }
            Err(e) => return Err(format!("could not run herdr: {e}")),
        }
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    if !status.success() {
        let line = stderr.lines().chain(stdout.lines()).find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
        return Err(if line.is_empty() { format!("herdr exited with {status}") } else { format!("herdr: {line}") });
    }
    Ok(stdout)
}

/// R37 steps 2–6. `file` has already been checked by the caller (R9).
pub fn open_in_editor(editor: &str, file: &Path) -> Result<(), String> {
    let herdr = find_herdr().ok_or_else(|| NOT_INSTALLED.to_string())?;
    let session = session();
    let session = session.as_deref();
    let list = run(&herdr, &herdr_args(session, &["pane", "list"])).map_err(|_| NO_FOCUSED_PANE.to_string())?;
    let pane = focused_pane(&list).ok_or_else(|| NO_FOCUSED_PANE.to_string())?;
    let dir = file.parent().unwrap_or(Path::new("/")).to_string_lossy().into_owned();
    let split = run(&herdr, &herdr_args(session, &["pane", "split", &pane, "--direction", "right", "--cwd", &dir, "--focus"]))?;
    let new_pane = new_pane_id(&split).ok_or_else(|| "Herdr did not say which pane it opened".to_string())?;
    run(&herdr, &herdr_args(session, &["pane", "run", &new_pane, &editor_command(editor, file)]))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The shapes Herdr 0.9.0 printed in task 1.4 (throwaway session), trimmed to the fields that matter.
    const LIST: &str = r#"{"id":"cli:pane:list","result":{"panes":[{"focused":false,"pane_id":"w1:p1","workspace_id":"w1"},{"focused":true,"pane_id":"w1:p2","workspace_id":"w1"},{"focused":false,"pane_id":"w2:p1","workspace_id":"w2"}],"type":"pane_list"}}"#;
    const SPLIT: &str = r#"{"id":"cli:pane:split","result":{"pane":{"focused":true,"pane_id":"w1:p2","tab_id":"w1:t1","workspace_id":"w1"},"type":"pane_info"}}"#;

    #[test]
    fn a_file_name_is_quoted_so_it_can_never_run() {
        assert_eq!(editor_command("vim", Path::new("it's $(x).md")), r"vim 'it'\''s $(x).md'");
        assert_eq!(editor_command(" nvim -R ", Path::new("/a b/plan.md")), "nvim -R '/a b/plan.md'");
    }

    #[test]
    fn herdr_output_gives_the_focused_pane_and_the_new_one() {
        assert_eq!(focused_pane(LIST), Some("w1:p2".into()));
        assert_eq!(focused_pane(r#"{"result":{"panes":[{"focused":false,"pane_id":"w1:p1"}]}}"#), None);
        assert_eq!(focused_pane("not json"), None);
        assert_eq!(new_pane_id(SPLIT), Some("w1:p2".into()));
        assert_eq!(new_pane_id(r#"{"result":{}}"#), None);
    }

    #[test]
    fn the_session_flag_comes_first_when_there_is_one() {
        assert_eq!(herdr_args(Some("kinas-e2e-editor"), &["pane", "list"]), ["--session", "kinas-e2e-editor", "pane", "list"]);
        assert_eq!(herdr_args(None, &["pane", "list"]), ["pane", "list"]);
    }

    #[test]
    fn the_editor_setting_is_one_trimmed_line_of_at_most_200_characters() {
        assert_eq!(check_editor("  less  "), Ok("less".into()));
        assert_eq!(check_editor("   "), Err("the editor command is empty".into()));
        assert_eq!(check_editor(&"a".repeat(201)), Err("the editor command is longer than 200 characters".into()));
        assert_eq!(check_editor("vim\nrm -rf ~"), Err("the editor command has a line break".into()));
    }
}
