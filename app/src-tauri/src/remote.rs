//! The one door to the VPS (ADR 0024; build spec §6.1, §11.2): the only code in the app that runs `ssh`. Always
//! `/usr/bin/ssh` with a fixed argv — batch mode, connect and keepalive limits, a control socket under Kinas's data
//! directory — then `--`, the validated target, and the constant remote command `.local/bin/kinas companion rpc`. The
//! request travels as one JSON document on the child's stdin (`proc::run_fed`); nothing a source, a setting or the
//! captain wrote is ever part of a shell string. What comes back is one JSON reply, at most 8 MiB.
//!
//! A failure is reported as one of a few fixed reasons, never ssh's own words: they name hosts, users and paths
//! (ADR 0007). Callers never hold the store guard across `call` (ADR 0005); it can take up to `RPC_LIMIT`.
//!
//! The control socket: macOS caps a socket path at 104 bytes, and `<data dir>/ssh/<40-hex %C>` plus ssh's temporary
//! suffix is longer, so ssh runs with that folder as its working directory and `ControlPath=%C`, a relative name.

use crate::place::valid_target;
use crate::proc::{self, Exit, Ran, Run};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub(crate) const RPC_LIMIT: Duration = Duration::from_secs(20);
pub(crate) const RPC_CAP: usize = 8 * 1024 * 1024;
/// Run in the login directory, so the path needs no `~`: `kinas` as setup installs it.
pub(crate) const REMOTE_COMMAND: [&str; 3] = [".local/bin/kinas", "companion", "rpc"];
const SSH: &str = "/usr/bin/ssh";

/// Why the VPS could not be read, in words fit for the screen. Never a host, a user or a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Unreachable {
    HostKeyChanged,
    LoginRefused,
    TimedOut,
    NotReachable,
    CompanionMissing,
    CompanionRefused,
    CompanionFailed,
    ReplyTooLarge,
    BadReply,
}

impl Unreachable {
    pub fn words(self, label: &str) -> String {
        let why = match self {
            Unreachable::HostKeyChanged => "host key changed",
            Unreachable::LoginRefused => "login refused",
            Unreachable::TimedOut => "timed out",
            Unreachable::NotReachable => "not reachable",
            Unreachable::CompanionMissing => "Kinas is not installed there",
            Unreachable::CompanionRefused => "Kinas there refused the request",
            Unreachable::CompanionFailed => "Kinas there could not answer",
            Unreachable::ReplyTooLarge => "the answer was too large",
            Unreachable::BadReply => "the answer could not be read",
        };
        format!("can't reach {label}: {why}")
    }

    /// The reason a stored code names, for the status bar's tooltip.
    pub fn from_code(code: &str) -> Option<Unreachable> {
        [
            Unreachable::HostKeyChanged,
            Unreachable::LoginRefused,
            Unreachable::TimedOut,
            Unreachable::NotReachable,
            Unreachable::CompanionMissing,
            Unreachable::CompanionRefused,
            Unreachable::CompanionFailed,
            Unreachable::ReplyTooLarge,
            Unreachable::BadReply,
        ]
        .into_iter()
        .find(|u| u.code() == code)
    }

    /// The short word the log carries.
    pub fn code(self) -> &'static str {
        match self {
            Unreachable::HostKeyChanged => "host-key",
            Unreachable::LoginRefused => "login",
            Unreachable::TimedOut => "timeout",
            Unreachable::NotReachable => "unreachable",
            Unreachable::CompanionMissing => "missing",
            Unreachable::CompanionRefused => "refused",
            Unreachable::CompanionFailed => "failed",
            Unreachable::ReplyTooLarge => "too-large",
            Unreachable::BadReply => "bad-reply",
        }
    }
}

/// The companion's cursor over what the Mac has already taken: the ledger's bytes and the factory's events. Opaque to
/// the Mac, which keeps it and hands it back.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Cursor {
    pub epoch: String,
    pub offset: u64,
    pub events: u64,
}

/// One request; the verbs of build spec §11.2, added as their slices land (`refresh` and the rest from slice 2).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "verb", rename_all = "kebab-case")]
pub(crate) enum Request {
    Hello,
    Bundle { cursor: Option<Cursor> },
    /// A reading on the VPS now (Refresh readings), before the bundle that carries it.
    Refresh,
}

impl Request {
    pub fn name(&self) -> &'static str {
        match self {
            Request::Hello => "hello",
            Request::Bundle { .. } => "bundle",
            Request::Refresh => "refresh",
        }
    }
}

/// `/usr/bin/ssh`, or in a debug build `KINAS_E2E_SSH` when it is an absolute path: a stub that takes the same argv
/// and stdin and runs the companion locally (README, Environment variables).
pub(crate) fn ssh_program() -> PathBuf {
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var("KINAS_E2E_SSH").ok().filter(|p| p.starts_with('/')) {
        return PathBuf::from(p);
    }
    PathBuf::from(SSH)
}

/// The whole argv after the program. Pure: the test holds it to this exact shape.
pub(crate) fn argv(target: &str) -> Vec<String> {
    let mut a: Vec<String> = [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=10",
        "-o",
        "ServerAliveCountMax=2",
        "-o",
        "ControlMaster=auto",
        "-o",
        "ControlPath=%C",
        "-o",
        "ControlPersist=60",
        "--",
        target,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    a.extend(REMOTE_COMMAND.iter().map(|s| s.to_string()));
    a
}

/// The folder the control socket lives in, made private if it is new; `None` when it cannot be made, and then ssh runs
/// from `/` with no shared connection worth having (`%C` there cannot be created, and ssh carries on without it).
pub(crate) fn control_dir(data_dir: &Path) -> Option<PathBuf> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    let dir = data_dir.join("ssh");
    if !dir.exists() {
        std::fs::DirBuilder::new().mode(0o700).create(&dir).ok()?;
    }
    let meta = std::fs::symlink_metadata(&dir).ok()?;
    // SAFETY: getuid has no preconditions.
    let me = unsafe { libc::getuid() };
    if !meta.is_dir() || meta.uid() != me || meta.permissions().mode() & 0o077 != 0 {
        return None;
    }
    Some(dir)
}

/// The reason for a failed run, from ssh's exit and its first and last stderr lines (which are never logged).
pub(crate) fn reason(exit: Exit, first_err: Option<&str>, last_err: Option<&str>) -> Unreachable {
    let said = |needle: &str| [first_err, last_err].iter().flatten().any(|l| l.contains(needle));
    if exit == Exit::TimedOut {
        return Unreachable::TimedOut;
    }
    if said("REMOTE HOST IDENTIFICATION HAS CHANGED") || said("Host key verification failed") {
        return Unreachable::HostKeyChanged;
    }
    if said("Permission denied") {
        return Unreachable::LoginRefused;
    }
    if said("timed out") {
        return Unreachable::TimedOut;
    }
    match exit {
        Exit::Code(127) => Unreachable::CompanionMissing,
        Exit::Code(126) => Unreachable::CompanionMissing,
        Exit::Code(2) => Unreachable::CompanionRefused,
        Exit::Code(255) | Exit::Signal => Unreachable::NotReachable,
        _ if said("No such file or directory") || said("command not found") => Unreachable::CompanionMissing,
        _ => Unreachable::CompanionFailed,
    }
}

/// One request, one reply. The runner is passed in so a test can stand in for ssh.
pub(crate) fn call_with(
    target: &str,
    request: &Request,
    cwd: Option<&Path>,
    runner: impl FnOnce(&Run, &[u8]) -> Result<(Ran, bool), String>,
) -> Result<serde_json::Value, Unreachable> {
    valid_target(target).map_err(|_| Unreachable::NotReachable)?;
    let program = ssh_program();
    let args = argv(target);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut input = serde_json::to_vec(request).map_err(|_| Unreachable::BadReply)?;
    input.push(b'\n');
    let run = Run { program: &program, args: &args, cwd: Some(cwd.unwrap_or(Path::new("/"))), set: &[], limit: RPC_LIMIT };
    let (ran, cut) = runner(&run, &input).map_err(|_| Unreachable::NotReachable)?;
    if cut {
        return Err(Unreachable::ReplyTooLarge);
    }
    if !ran.ok() {
        return Err(reason(ran.exit, ran.first_err.as_deref(), ran.last_err.as_deref()));
    }
    serde_json::from_str(ran.stdout.trim()).map_err(|_| Unreachable::BadReply)
}

/// `call_with` through `proc::run_fed`, logging the verb, the outcome and the time only.
pub(crate) fn call(target: &str, data_dir: &Path, request: &Request) -> Result<serde_json::Value, Unreachable> {
    let started = Instant::now();
    let dir = control_dir(data_dir);
    let out = call_with(target, request, dir.as_deref(), |run, input| proc::run_fed(run, input, RPC_CAP));
    let ms = started.elapsed().as_millis();
    match &out {
        Ok(_) => log::info!("remote: {} ok in {ms} ms", request.name()),
        Err(why) => log::info!("remote: {} failed ({}) in {ms} ms", request.name(), why.code()),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn ran(exit: Exit, stdout: &str, first: Option<&str>, last: Option<&str>) -> Ran {
        Ran { exit, stdout: stdout.into(), first_err: first.map(str::to_string), last_err: last.map(str::to_string) }
    }

    #[test]
    fn argv_is_fixed() {
        assert_eq!(
            argv("captain@203.0.113.24"),
            [
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ServerAliveInterval=10",
                "-o",
                "ServerAliveCountMax=2",
                "-o",
                "ControlMaster=auto",
                "-o",
                "ControlPath=%C",
                "-o",
                "ControlPersist=60",
                "--",
                "captain@203.0.113.24",
                ".local/bin/kinas",
                "companion",
                "rpc"
            ]
        );
    }

    #[test]
    fn request_is_stdin_json_never_argv() {
        let seen = RefCell::new((Vec::<String>::new(), Vec::<u8>::new(), None::<PathBuf>));
        let reply = call_with("vps-1", &Request::Bundle { cursor: Some(Cursor { epoch: "e1".into(), offset: 42, events: 7 }) }, Some(Path::new("/tmp")), |run, input| {
            *seen.borrow_mut() = (run.args.iter().map(|s| s.to_string()).collect(), input.to_vec(), run.cwd.map(Path::to_path_buf));
            Ok((ran(Exit::Code(0), "{\"v\":1}\n", None, None), false))
        })
        .unwrap();
        assert_eq!(reply, serde_json::json!({"v": 1}));
        let (args, input, cwd) = seen.into_inner();
        assert_eq!(&args[args.len() - 4..], ["vps-1", ".local/bin/kinas", "companion", "rpc"]);
        assert!(!args.iter().any(|a| a.contains("bundle") || a.contains("e1")), "{args:?}");
        assert_eq!(String::from_utf8(input).unwrap(), "{\"verb\":\"bundle\",\"cursor\":{\"epoch\":\"e1\",\"offset\":42,\"events\":7}}\n");
        assert_eq!(cwd.as_deref(), Some(Path::new("/tmp")));
    }

    #[test]
    fn a_bad_target_never_reaches_ssh() {
        let called = RefCell::new(false);
        let out = call_with("-oProxyCommand=x", &Request::Hello, None, |_, _| {
            *called.borrow_mut() = true;
            Ok((ran(Exit::Code(0), "{}", None, None), false))
        });
        assert_eq!(out, Err(Unreachable::NotReachable));
        assert!(!*called.borrow());
    }

    #[test]
    fn reason_cases() {
        let host_key_first = "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@";
        assert_eq!(reason(Exit::Code(255), Some(host_key_first), Some("Host key verification failed.")), Unreachable::HostKeyChanged);
        assert_eq!(reason(Exit::Code(255), Some("captain@203.0.113.24: Permission denied (publickey)."), None), Unreachable::LoginRefused);
        assert_eq!(reason(Exit::Code(255), Some("ssh: connect to host 203.0.113.24 port 22: Operation timed out"), None), Unreachable::TimedOut);
        assert_eq!(reason(Exit::TimedOut, None, None), Unreachable::TimedOut);
        assert_eq!(reason(Exit::Code(255), Some("ssh: Could not resolve hostname vps-1: nodename nor servname provided"), None), Unreachable::NotReachable);
        assert_eq!(reason(Exit::Code(255), Some("kex_exchange_identification: Connection closed by remote host"), None), Unreachable::NotReachable);
        assert_eq!(reason(Exit::Code(127), Some("bash: line 1: .local/bin/kinas: No such file or directory"), None), Unreachable::CompanionMissing);
        assert_eq!(reason(Exit::Code(2), None, None), Unreachable::CompanionRefused);
        assert_eq!(reason(Exit::Code(1), None, None), Unreachable::CompanionFailed);
    }

    #[test]
    fn a_reply_over_the_cap_or_not_json_is_refused() {
        let cut = call_with("vps-1", &Request::Hello, None, |_, _| Ok((ran(Exit::Code(0), "{\"v\":", None, None), true)));
        assert_eq!(cut, Err(Unreachable::ReplyTooLarge));
        let garbage = call_with("vps-1", &Request::Hello, None, |_, _| Ok((ran(Exit::Code(0), "Welcome to Ubuntu\n{", None, None), false)));
        assert_eq!(garbage, Err(Unreachable::BadReply));
    }

    #[test]
    fn the_words_never_carry_what_ssh_said() {
        for why in [
            Unreachable::HostKeyChanged,
            Unreachable::LoginRefused,
            Unreachable::TimedOut,
            Unreachable::NotReachable,
            Unreachable::CompanionMissing,
            Unreachable::CompanionRefused,
            Unreachable::CompanionFailed,
            Unreachable::ReplyTooLarge,
            Unreachable::BadReply,
        ] {
            let w = why.words("vps-1");
            assert!(w.starts_with("can't reach vps-1: "), "{w}");
            assert!(!w.contains('/') && !w.contains('@'), "{w}");
        }
    }

    #[test]
    fn the_control_dir_is_private_and_refused_otherwise() {
        use std::os::unix::fs::PermissionsExt;
        let data = tempfile::tempdir().unwrap();
        let dir = control_dir(data.path()).unwrap();
        assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(control_dir(data.path()), None, "a folder others can read is not used");
    }
}
