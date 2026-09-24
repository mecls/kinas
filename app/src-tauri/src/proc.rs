//! The one child-process runner for the crew (build spec §6.9): a fixed argv, never a shell string; null stdin; every
//! inherited HERDR* variable removed (a Kinas started from a Herdr pane would otherwise be refused as nested, and a
//! Firstmate script would find the wrong session); the caller's variables applied on top; its own process group,
//! killed whole at the limit, so a script's grandchildren go with it; both pipes drained on threads so a chatty child
//! never blocks. Precedents: `reader/herdr.rs::run` (the drain) and `pty::terminate` (the group kill).

use std::ffi::OsString;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

/// How long the pipes may stay open after the child has gone or been killed: a grandchild that left the group can
/// hold them, and the caller must not wait on it.
const PIPE_GRACE: Duration = Duration::from_secs(1);

pub(crate) struct Run<'a> {
    pub program: &'a Path,
    /// One element per argument; never a shell string.
    pub args: &'a [&'a str],
    pub cwd: Option<&'a Path>,
    /// Applied after the HERDR* strip, e.g. `("PATH", login_path())`, `("FM_HOME", home)`.
    pub set: &'a [(&'a str, &'a str)],
    pub limit: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Exit {
    Code(i32),
    Signal,
    TimedOut,
}

#[derive(Debug)]
// `first_err`, `elapsed` and `ok` are read by the tool probes and the launcher (slices 2 and 3).
#[allow(dead_code)]
pub(crate) struct Ran {
    pub exit: Exit,
    pub stdout: String,
    /// The first and last non-blank stderr lines, trimmed. Callers log neither (§6.13): a script's stderr can name a
    /// task, a path or a repository.
    pub first_err: Option<String>,
    pub last_err: Option<String>,
    pub elapsed: Duration,
}

impl Ran {
    #[allow(dead_code)]
    pub fn ok(&self) -> bool {
        self.exit == Exit::Code(0)
    }
}

/// Runs `r` to completion or its limit. `Err` only when the program could not be started.
pub(crate) fn run(r: &Run) -> Result<Ran, String> {
    run_with(r, std::env::vars_os())
}

/// `run` with the inherited environment passed in, so a test can hand it HERDR* variables without touching the
/// process's own environment.
fn run_with(r: &Run, inherited: impl IntoIterator<Item = (OsString, OsString)>) -> Result<Ran, String> {
    let mut command = Command::new(r.program);
    command.args(r.args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0);
    command.env_clear();
    command.envs(inherited.into_iter().filter(|(k, _)| !k.to_string_lossy().to_ascii_uppercase().contains("HERDR")));
    for (key, value) in r.set {
        command.env(key, value);
    }
    if let Some(cwd) = r.cwd {
        command.current_dir(cwd);
    }
    let started = Instant::now();
    let mut child = command.spawn().map_err(|e| format!("could not run {}: {e}", r.program.display()))?;
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let deadline = started + r.limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            Ok(None) => break None,
            Err(e) => {
                kill_group(child.id());
                let _ = child.wait();
                return Err(format!("could not wait for {}: {e}", r.program.display()));
            }
        }
    };
    let exit = match status {
        Some(status) => status.code().map(Exit::Code).unwrap_or(Exit::Signal),
        None => {
            kill_group(child.id());
            let _ = child.wait();
            Exit::TimedOut
        }
    };
    // The child is gone. Its pipes close when the last holder does; wait for them until the limit, then kill whatever
    // is left of the group and give the readers a moment more.
    let pipes_until = deadline.max(Instant::now()) + if exit == Exit::TimedOut { PIPE_GRACE } else { Duration::ZERO };
    let mut out = collect(&stdout, pipes_until);
    let mut err = collect(&stderr, pipes_until);
    if out.is_none() || err.is_none() {
        kill_group(child.id());
        let grace = Instant::now() + PIPE_GRACE;
        out = out.or_else(|| collect(&stdout, grace));
        err = err.or_else(|| collect(&stderr, grace));
    }
    let err = err.unwrap_or_default();
    let mut lines = err.lines().map(str::trim).filter(|l| !l.is_empty());
    let first_err = lines.next().map(str::to_string);
    let last_err = lines.next_back().map(str::to_string).or_else(|| first_err.clone());
    Ok(Ran { exit, stdout: out.unwrap_or_default(), first_err, last_err, elapsed: started.elapsed() })
}

fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> Receiver<String> {
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut p) = pipe {
            let _ = p.read_to_end(&mut bytes);
        }
        let _ = tx.send(String::from_utf8_lossy(&bytes).into_owned());
    });
    rx
}

fn collect(rx: &Receiver<String>, until: Instant) -> Option<String> {
    rx.recv_timeout(until.saturating_duration_since(Instant::now())).ok()
}

/// SIGKILL to the whole group the child leads (`process_group(0)` made its pid the group id).
fn kill_group(pid: u32) {
    let Ok(pid) = i32::try_from(pid) else { return };
    // SAFETY: plain signal delivery; a negative pid addresses the process group the child leads.
    unsafe { libc::kill(-pid, libc::SIGKILL) };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(script: &str, limit: Duration) -> Ran {
        run(&Run { program: Path::new("/bin/sh"), args: &["-c", script], cwd: None, set: &[], limit }).unwrap()
    }

    fn alive(pid: i32) -> bool {
        // SAFETY: signal 0 only checks whether the process exists.
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    fn run_kills_the_group_at_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let pids = dir.path().join("pids");
        let script = format!("sleep 30 & echo $$ $! > '{}'; sleep 30", pids.display());
        let ran = sh(&script, Duration::from_secs(1));
        assert_eq!(ran.exit, Exit::TimedOut);
        assert!(ran.elapsed < Duration::from_secs(4), "took {:?}", ran.elapsed);
        let text = std::fs::read_to_string(&pids).unwrap();
        let ids: Vec<i32> = text.split_whitespace().map(|p| p.parse().unwrap()).collect();
        assert_eq!(ids.len(), 2, "{text}");
        std::thread::sleep(Duration::from_secs(1));
        for pid in ids {
            assert!(!alive(pid), "{pid} outlived the limit");
        }
    }

    #[test]
    fn run_keeps_first_and_last_stderr_lines() {
        let ran = sh("printf '\\n  one  \\n\\ntwo\\nthree\\n\\n' >&2; echo out; exit 3", Duration::from_secs(5));
        assert_eq!(ran.exit, Exit::Code(3));
        assert_eq!(ran.stdout, "out\n");
        assert_eq!(ran.first_err.as_deref(), Some("one"));
        assert_eq!(ran.last_err.as_deref(), Some("three"));

        let quiet = sh("true", Duration::from_secs(5));
        assert!(quiet.ok());
        assert_eq!((quiet.first_err, quiet.last_err), (None, None));
    }

    #[test]
    fn run_strips_herdr_and_sets_env() {
        let inherited = [
            ("HERDR_SESSION", "default"),
            ("HERDR_SOCKET_PATH", "/tmp/x.sock"),
            ("my_herdr_thing", "1"),
            ("KEEP_ME", "kept"),
            ("PATH", "/usr/bin:/bin"),
            ("FM_HOME", "/inherited"),
        ]
        .map(|(k, v)| (OsString::from(k), OsString::from(v)));
        let script = "env; if read line; then echo STDIN-READ; else echo STDIN-EOF; fi";
        let ran = run_with(
            &Run {
                program: Path::new("/bin/sh"),
                args: &["-c", script],
                cwd: Some(Path::new("/")),
                set: &[("PATH", "/bin:/usr/bin:/opt/test"), ("FM_HOME", "/tmp/fm-home")],
                limit: Duration::from_secs(5),
            },
            inherited,
        )
        .unwrap();
        assert!(ran.ok(), "{ran:?}");
        let lines: Vec<&str> = ran.stdout.lines().collect();
        assert!(!lines.iter().any(|l| l.to_ascii_uppercase().contains("HERDR")), "{lines:?}");
        assert!(lines.contains(&"KEEP_ME=kept"), "{lines:?}");
        assert!(lines.contains(&"PATH=/bin:/usr/bin:/opt/test"), "{lines:?}");
        assert!(lines.contains(&"FM_HOME=/tmp/fm-home"), "{lines:?}");
        assert!(lines.contains(&"PWD=/"), "{lines:?}");
        assert_eq!(lines.last(), Some(&"STDIN-EOF"));
    }

    #[test]
    fn a_program_that_cannot_start_is_an_error() {
        let err = run(&Run { program: Path::new("/nonexistent/kinas-proc"), args: &[], cwd: None, set: &[], limit: Duration::from_secs(1) })
            .unwrap_err();
        assert!(err.starts_with("could not run /nonexistent/kinas-proc"), "{err}");
    }
}
