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
/// Setup's `install` (slice 4): a download, a clone or an npm install on the VPS takes minutes, not seconds.
pub(crate) const INSTALL_LIMIT: Duration = Duration::from_secs(300);
/// An answer (slice 6.2): the companion waits up to 20 s for another answer's lock, then takes a fresh snapshot (20 s),
/// a hold's check (5 s) and the note (10 s).
pub(crate) const ANSWER_LIMIT: Duration = Duration::from_secs(60);
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
    /// Herdr's view of `default` and its focused pane's foreground, read now (slice 3): the chrome and an order's pane.
    View,
    /// The launcher, on the VPS (slice 3): focus the first mate, or start it with exactly its program.
    LaunchFirstMate,
    /// Focus a workspace Herdr has on the VPS: a worker's pane, the palette's choice.
    Focus { workspace: String },
    /// Open in the terminal: a Mac folder's twin under the VPS's projects folder, by its relative path and label.
    OpenWorkspace { folder: String, label: String },
    /// The captain's answer (slice 6, ADR 0033): the line the first mate reads, delivered as a note in Firstmate's inbox
    /// while its question is still open there. `request_id` makes a resend after a lost reply the same note.
    Answer { task: String, key: String, words: String, request_id: String, from: Origin },
    /// Setup (slice 4, §17 2026-11-25 #4): one item, each the captain's click. `folder` and `repo` only for `clone`,
    /// `adopt` only for Herdr's service; an absent one is left out of the JSON, as the companion's validator wants.
    Install {
        item: InstallItem,
        #[serde(skip_serializing_if = "Option::is_none")]
        folder: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        repo: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        adopt: Option<bool>,
        /// The workers' sandbox only (ADR 0027): restart Herdr's server, the captain's second click.
        #[serde(skip_serializing_if = "Option::is_none")]
        restart: Option<bool>,
    },
}

/// Where an answer was given: this Mac through the door; the phone's come through the cloud store (slice 10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Mac,
    Phone,
}

/// What setup installs on the VPS, as the companion names it (`cli/src/companion/setup.ts` INSTALL_ITEMS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallItem {
    Herdr,
    HerdrService,
    Firstmate,
    RelayRule,
    RelayInstruction,
    WorkerSandbox,
    PermissionMode,
    CrewTools,
    CompanionService,
    Clone,
}

impl Request {
    pub fn name(&self) -> &'static str {
        match self {
            Request::Hello => "hello",
            Request::Bundle { .. } => "bundle",
            Request::Refresh => "refresh",
            Request::View => "view",
            Request::LaunchFirstMate => "launch-first-mate",
            Request::Focus { .. } => "focus",
            Request::OpenWorkspace { .. } => "open-workspace",
            Request::Answer { .. } => "answer",
            Request::Install { .. } => "install",
        }
    }

    /// How long the door waits for this one: `install` may download, clone or run npm; `answer` checks, then writes.
    pub fn limit(&self) -> Duration {
        match self {
            Request::Install { .. } => INSTALL_LIMIT,
            Request::Answer { .. } => ANSWER_LIMIT,
            _ => RPC_LIMIT,
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
    let run = Run { program: &program, args: &args, cwd: Some(cwd.unwrap_or(Path::new("/"))), set: &[], limit: request.limit() };
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

    /// Slice 3: each action is the shape the companion's validator accepts (cli/src/companion/validate.ts), word for word.
    #[test]
    fn the_actions_are_the_companion_s_shapes() {
        let json = |r: &Request| serde_json::to_string(r).unwrap();
        assert_eq!(json(&Request::View), r#"{"verb":"view"}"#);
        assert_eq!(json(&Request::LaunchFirstMate), r#"{"verb":"launch-first-mate"}"#);
        assert_eq!(json(&Request::Focus { workspace: "w3".into() }), r#"{"verb":"focus","workspace":"w3"}"#);
        assert_eq!(json(&Request::OpenWorkspace { folder: "kinas/docs".into(), label: "kinas/docs".into() }), r#"{"verb":"open-workspace","folder":"kinas/docs","label":"kinas/docs"}"#);
        assert_eq!(Request::OpenWorkspace { folder: String::new(), label: String::new() }.name(), "open-workspace");
    }

    #[test]
    fn install_is_the_companion_s_shape_and_waits_longer() {
        let json = |r: &Request| serde_json::to_string(r).unwrap();
        let plain = Request::Install { item: InstallItem::Herdr, folder: None, repo: None, adopt: None, restart: None };
        assert_eq!(json(&plain), r#"{"verb":"install","item":"herdr"}"#);
        let adopt = Request::Install { item: InstallItem::HerdrService, folder: None, repo: None, adopt: Some(true), restart: None };
        assert_eq!(json(&adopt), r#"{"verb":"install","item":"herdr-service","adopt":true}"#);
        let clone = Request::Install { item: InstallItem::Clone, folder: Some("shop".into()), repo: Some("acme/shop".into()), adopt: None, restart: None };
        assert_eq!(json(&clone), r#"{"verb":"install","item":"clone","folder":"shop","repo":"acme/shop"}"#);
        assert_eq!(json(&Request::Install { item: InstallItem::RelayRule, folder: None, repo: None, adopt: None, restart: None }), r#"{"verb":"install","item":"relay-rule"}"#);
        let restart = Request::Install { item: InstallItem::WorkerSandbox, folder: None, repo: None, adopt: None, restart: Some(true) };
        assert_eq!(json(&restart), r#"{"verb":"install","item":"worker-sandbox","restart":true}"#);
        assert_eq!(plain.name(), "install");
        assert_eq!(plain.limit(), INSTALL_LIMIT);
        assert_eq!(Request::Hello.limit(), RPC_LIMIT);
        let seen = RefCell::new(Duration::ZERO);
        let _ = call_with("captain@vps", &plain, None, |run, _| {
            *seen.borrow_mut() = run.limit;
            Ok((ran(Exit::Code(0), "{}", None, None), false))
        });
        assert_eq!(*seen.borrow(), INSTALL_LIMIT);
    }

    /// Slice 6.2: the answer as the companion's validator takes it (cli/src/companion/validate.ts), and the door waits
    /// 60 s for it: another answer's lock (20 s), the snapshot (20 s), the hold check (5 s) and the note (10 s).
    #[test]
    fn answer_is_the_companion_s_shape_and_waits_a_minute() {
        let a = Request::Answer { task: "t1".into(), key: "api-shape".into(), words: "On t1 (api-shape): Approved — go ahead.".into(), request_id: "r-1".into(), from: Origin::Mac };
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            r#"{"verb":"answer","task":"t1","key":"api-shape","words":"On t1 (api-shape): Approved — go ahead.","request_id":"r-1","from":"mac"}"#
        );
        assert_eq!(a.name(), "answer");
        assert_eq!(a.limit(), ANSWER_LIMIT);
        assert_eq!(ANSWER_LIMIT, Duration::from_secs(60));
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
