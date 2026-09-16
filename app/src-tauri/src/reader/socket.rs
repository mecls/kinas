//! `<data dir>/kinas.sock` (reader PRD R15–R18): the CLI's door into the running app. One JSON request line, one
//! response line, then close. Only this macOS user may connect, a socket another Kinas is listening on is never taken
//! over, and nothing here reads a file's contents: paths are only canonicalized and stat'ed.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::access::{self, Denied, Kind};
use super::{Inner, ReaderState};

pub const SOCKET_FILE: &str = "kinas.sock";
/// Emitted to the webview for an accepted request: open the reader on the Work page (R18).
pub const READER_SHOW: &str = "reader_show";
const MAX_REQUEST_BYTES: u64 = 64 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(2);
/// macOS `sun_path` holds 104 bytes, including the terminating NUL.
const MAX_SOCKET_PATH: usize = 103;

pub fn socket_path(dir: &Path) -> PathBuf {
    dir.join(SOCKET_FILE)
}

#[derive(Debug, Deserialize)]
struct Request {
    v: u32,
    op: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    anywhere: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Response {
    fn accepted(result: &'static str, path: &Path) -> Self {
        Response { ok: true, result: Some(result), path: Some(path.display().to_string()), code: None, error: None }
    }

    fn refused(code: &'static str, error: String) -> Self {
        Response { ok: false, result: None, path: None, code: Some(code), error: Some(error) }
    }

    fn bad_request() -> Self {
        Self::refused("bad_request", "kinas open: Kinas did not understand the request".into())
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ShowEvent {
    pub path: String,
    pub kind: Kind,
    pub confirm: bool,
    pub received_at_ms: i64,
    /// The projects root's real path, which the confirmation card names (R7).
    pub root: String,
}

fn show(path: &Path, kind: Kind, confirm: bool, received_at_ms: i64, root: &Path) -> Option<ShowEvent> {
    Some(ShowEvent { path: path.display().to_string(), kind, confirm, received_at_ms, root: root.display().to_string() })
}

/// One request against the root and this session's state. Pure apart from canonicalize and stat, so every branch
/// is tested without a socket.
pub fn handle(line: &str, root: &Path, inner: &mut Inner, received_at_ms: i64) -> (Response, Option<ShowEvent>) {
    let Ok(request) = serde_json::from_str::<Request>(line) else {
        return (Response::bad_request(), None);
    };
    if request.v != 1 {
        return (Response::bad_request(), None);
    }
    let real_root = access::real_root(root);
    let refuse = |denied: Denied, path: &Path| (Response::refused(denied.code(), denied.cli_message(path, &real_root)), None);

    match request.op.as_str() {
        "open" => {
            let Some(path) = request.path.map(PathBuf::from).filter(|p| p.is_absolute()) else {
                return (Response::bad_request(), None);
            };
            match access::resolve(&path) {
                Err(denied) => refuse(denied, &path),
                Ok((real, kind)) if access::permitted(&real, root, &inner.allowed) => {
                    (Response::accepted("opened", &real), show(&real, kind, false, received_at_ms, &real_root))
                }
                // Outside the root: only a click in the app can open it (R7). Nothing is allowed here.
                Ok((real, kind)) if request.anywhere => {
                    inner.pending_confirm = Some(real.clone());
                    (Response::accepted("confirm", &real), show(&real, kind, true, received_at_ms, &real_root))
                }
                Ok((real, _)) => refuse(Denied::Outside, &real),
            }
        }
        "reopen" => {
            let Some(last) = inner.recent.front().cloned() else {
                return (Response::refused("empty_history", "kinas open: nothing opened since Kinas started".into()), None);
            };
            match access::resolve(&last) {
                Err(denied) => refuse(denied, &last),
                Ok((real, kind)) if access::permitted(&real, root, &inner.allowed) => {
                    (Response::accepted("opened", &real), show(&real, kind, false, received_at_ms, &real_root))
                }
                Ok((real, _)) => refuse(Denied::Outside, &real),
            }
        }
        _ => (Response::bad_request(), None),
    }
}

/// Binds the socket by R16: a path another Kinas answers on is left alone, a stale one is replaced.
pub fn bind(path: &Path) -> Result<UnixListener, String> {
    if path.as_os_str().len() > MAX_SOCKET_PATH {
        return Err(format!("{} is longer than {MAX_SOCKET_PATH} bytes, so `kinas open` cannot reach this Kinas", path.display()));
    }
    if std::fs::symlink_metadata(path).is_ok() {
        if UnixStream::connect(path).is_ok() {
            return Err(format!("another Kinas is listening on {}; `kinas open` goes to that one", path.display()));
        }
        std::fs::remove_file(path).map_err(|e| format!("could not remove the stale {}: {e}", path.display()))?;
    }
    let listener = UnixListener::bind(path).map_err(|e| format!("could not listen on {}: {e}", path.display()))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|e| format!("could not restrict {}: {e}", path.display()))?;
    Ok(listener)
}

/// Starts the listener thread. Failing to listen is logged and leaves the rest of Kinas, and the reader's clicks,
/// working.
pub fn start(app: AppHandle, dir: &Path) {
    let path = socket_path(dir);
    let listener = match bind(&path) {
        Ok(listener) => listener,
        Err(e) => {
            log::error!("reader socket: {e}");
            return;
        }
    };
    app.state::<ReaderState>().lock().socket = Some(path);
    let spawned = std::thread::Builder::new().name("reader-socket".into()).spawn(move || {
        for stream in listener.incoming() {
            match stream {
                // One thread per request: a request stuck on the disk (a macOS privacy prompt for ~/Documents, found
                // on the first prod install) must not hold up every `kinas open` after it.
                Ok(stream) => {
                    let app = app.clone();
                    if let Err(e) = std::thread::Builder::new().name("reader-request".into()).spawn(move || serve(&app, stream)) {
                        log::warn!("reader socket: could not start a request thread: {e}");
                    }
                }
                Err(e) => log::warn!("reader socket: {e}"),
            }
        }
    });
    if let Err(e) = spawned {
        log::error!("reader socket: could not start its thread: {e}");
    }
}

fn serve(app: &AppHandle, mut stream: UnixStream) {
    if !same_user(&stream) {
        return;
    }
    let received_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    let (response, event) = match read_request(&stream) {
        // A connection that sends nothing (another Kinas probing the path) gets nothing back.
        None => return,
        Some(Err(())) => (Response::bad_request(), None),
        Some(Ok(line)) => {
            let state = app.state::<ReaderState>();
            let mut inner = state.lock();
            handle(&line, &crate::paths::projects_root(), &mut inner, received_at_ms)
        }
    };
    if let Ok(json) = serde_json::to_string(&response) {
        let _ = writeln!(stream, "{json}");
    }
    if let Some(event) = event {
        // Dispatched, never waited on: window calls from this thread block until the main thread runs them, and on the
        // first prod install the main thread was stuck in a file read, so the socket stopped answering altogether.
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || crate::system::bring_forward(&handle));
        let _ = app.emit(READER_SHOW, event);
    }
}

/// One line of at most 64 KiB, ending in a newline, within the 2 s timeout. `None` for a connection that sent nothing.
fn read_request(stream: &UnixStream) -> Option<Result<String, ()>> {
    let mut reader = BufReader::new(Read::take(stream, MAX_REQUEST_BYTES + 1));
    let mut line = Vec::new();
    match reader.read_until(b'\n', &mut line) {
        Ok(0) => None,
        Ok(_) if line.last() == Some(&b'\n') && line.len() as u64 <= MAX_REQUEST_BYTES => {
            Some(String::from_utf8(line).map(|s| s.trim_end().to_string()).map_err(|_| ()))
        }
        _ => Some(Err(())),
    }
}

fn same_user(stream: &UnixStream) -> bool {
    let (mut uid, mut gid) = (0, 0);
    // SAFETY: the fd is a connected socket owned by `stream` for the duration of the call.
    let rc = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    // SAFETY: getuid has no preconditions.
    rc == 0 && uid == unsafe { libc::getuid() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Tree {
        _dir: tempfile::TempDir,
        base: PathBuf,
        root: PathBuf,
    }

    fn tree() -> Tree {
        let dir = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(dir.path()).unwrap();
        let root = base.join("root");
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::create_dir_all(base.join("outside")).unwrap();
        fs::write(root.join("a.md"), "# a\n").unwrap();
        fs::write(root.join("notes.txt"), "x\n").unwrap();
        fs::write(base.join("outside/b.md"), "# b\n").unwrap();
        Tree { _dir: dir, base, root }
    }

    fn open(path: &Path, anywhere: bool) -> String {
        serde_json::json!({ "v": 1, "op": "open", "path": path, "anywhere": anywhere }).to_string()
    }

    #[test]
    fn a_file_inside_the_root_is_opened_and_shown() {
        let t = tree();
        let mut inner = Inner::default();
        let (response, event) = handle(&open(&t.root.join("a.md"), false), &t.root, &mut inner, 7);
        assert_eq!(serde_json::to_string(&response).unwrap(), format!(r#"{{"ok":true,"result":"opened","path":"{}"}}"#, t.root.join("a.md").display()));
        assert_eq!(
            event,
            Some(ShowEvent { path: t.root.join("a.md").display().to_string(), kind: Kind::File, confirm: false, received_at_ms: 7, root: t.root.display().to_string() })
        );
        let (_, folder) = handle(&open(&t.root.join("docs"), false), &t.root, &mut inner, 7);
        assert_eq!(folder.map(|e| e.kind), Some(Kind::Dir));
    }

    #[test]
    fn outside_the_root_is_refused_without_anywhere_and_only_asks_with_it() {
        let t = tree();
        let outside = t.base.join("outside/b.md");
        let mut inner = Inner::default();

        let (response, event) = handle(&open(&outside, false), &t.root, &mut inner, 0);
        assert_eq!(response, Response::refused("outside", format!("kinas open: {} is outside {}; add --anywhere to ask Kinas to open it", outside.display(), t.root.display())));
        assert_eq!(event, None);
        assert_eq!(inner.pending_confirm, None);

        let (response, event) = handle(&open(&outside, true), &t.root, &mut inner, 0);
        assert_eq!(response, Response::accepted("confirm", &outside));
        assert!(event.is_some_and(|e| e.confirm));
        assert_eq!(inner.pending_confirm, Some(outside));
        assert!(inner.allowed.is_empty(), "a socket request never widens access by itself");
    }

    #[test]
    fn missing_non_markdown_and_malformed_requests_are_refused() {
        let t = tree();
        let mut inner = Inner::default();
        assert_eq!(handle(&open(&t.root.join("new.md"), false), &t.root, &mut inner, 0).0.code, Some("missing"));
        assert!(!t.root.join("new.md").exists());
        assert_eq!(handle(&open(&t.root.join("notes.txt"), false), &t.root, &mut inner, 0).0.code, Some("not_markdown"));
        for line in [r#"{"v":1,"op":"open","path":"relative.md"}"#, r#"{"v":2,"op":"reopen"}"#, r#"{"v":1,"op":"delete"}"#, "not json"] {
            assert_eq!(handle(line, &t.root, &mut inner, 0), (Response::bad_request(), None), "{line}");
        }
    }

    #[test]
    fn reopen_uses_the_most_recent_file_and_rechecks_it() {
        let t = tree();
        let mut inner = Inner::default();
        let reopen = r#"{"v":1,"op":"reopen"}"#;
        assert_eq!(handle(reopen, &t.root, &mut inner, 0).0.code, Some("empty_history"));
        inner.remember(t.root.join("a.md"));
        assert_eq!(handle(reopen, &t.root, &mut inner, 0).0, Response::accepted("opened", &t.root.join("a.md")));
        fs::remove_file(t.root.join("a.md")).unwrap();
        assert_eq!(handle(reopen, &t.root, &mut inner, 0).0.code, Some("missing"));
    }

    #[test]
    fn a_stale_socket_is_replaced_and_a_live_one_is_left_alone() {
        let t = tree();
        let path = socket_path(&t.base);
        let first = bind(&path).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(bind(&path).unwrap_err().contains("another Kinas is listening"));
        drop(first);
        // Dropping a listener leaves its file behind, as a crash would.
        assert!(path.exists());
        assert!(bind(&path).is_ok());
        let long = t.base.join("x".repeat(120)).join(SOCKET_FILE);
        assert!(bind(&long).unwrap_err().contains("longer than"));
    }

    #[test]
    fn requests_need_a_newline_within_64_kib() {
        let (mut client, server) = UnixStream::pair().unwrap();
        client.write_all(b"{\"v\":1,\"op\":\"reopen\"}\n").unwrap();
        assert_eq!(read_request(&server), Some(Ok(r#"{"v":1,"op":"reopen"}"#.to_string())));

        // The socket buffer is far smaller than 70 KiB, so the writer needs its own thread; it ends when the
        // server side is dropped.
        let (mut client, server) = UnixStream::pair().unwrap();
        let writer = std::thread::spawn(move || {
            let _ = client.write_all(&vec![b'a'; 70 * 1024]);
        });
        assert_eq!(read_request(&server), Some(Err(())));
        drop(server);
        writer.join().unwrap();

        let (client, server) = UnixStream::pair().unwrap();
        drop(client);
        assert_eq!(read_request(&server), None);

        let (client, server) = UnixStream::pair().unwrap();
        assert!(same_user(&server));
        drop(client);
    }
}
