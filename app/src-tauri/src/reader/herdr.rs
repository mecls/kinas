//! The one door to Herdr: its CLI, run as a child with a fixed argv. Open in editor (`editor.rs`) and Open in the
//! terminal (`workspace.rs`) both go through here, and nothing here or there types into the Kinas terminal — when
//! Claude Code or Pi has that pane, the text would arrive as a prompt. Herdr 0.9.0.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const HERDR_TIMEOUT: Duration = Duration::from_secs(3);

pub(super) const NO_FOCUSED_PANE: &str = "Herdr has no focused pane; attach it first";
pub(super) const NOT_INSTALLED: &str = "Herdr isn't installed";

pub(super) fn herdr_args(session: Option<&str>, rest: &[&str]) -> Vec<String> {
    let mut args = Vec::with_capacity(rest.len() + 2);
    if let Some(name) = session {
        args.push("--session".to_string());
        args.push(name.to_string());
    }
    args.extend(rest.iter().map(|s| s.to_string()));
    args
}

pub(super) fn find_herdr() -> Option<PathBuf> {
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
pub(super) fn session() -> Option<String> {
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
pub(super) fn run(herdr: &Path, args: &[String]) -> Result<String, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_session_flag_comes_first_when_there_is_one() {
        assert_eq!(herdr_args(Some("kinas-e2e-editor"), &["pane", "list"]), ["--session", "kinas-e2e-editor", "pane", "list"]);
        assert_eq!(herdr_args(None, &["pane", "list"]), ["pane", "list"]);
    }
}
