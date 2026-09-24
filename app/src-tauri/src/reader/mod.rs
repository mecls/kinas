//! The reader (`kinas open`, reader PRD): what it keeps for this session, the door the CLI uses, and the commands the
//! webview calls. Everything here lives in memory and is gone when Kinas quits; the only thing stored is the
//! `reader_editor` setting — and, since 2026-09-18, the paths Miguel explicitly pins (`pins.rs`). It only reads — with one exception, `export.rs`, which writes a copy of the open file
//! to a place Miguel chooses in a save sheet. Every command re-checks its path (R9): nothing is trusted because someone checked it before.

pub mod access;
pub mod changes;
pub mod editor;
pub mod export;
pub mod pins;
pub mod socket;
pub mod watch;
pub mod workspace;

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{Manager, State};

use access::{Denied, Kind, Text};

/// `kinas open` with no path reopens the most recent of these (R38).
pub const RECENT_CAP: usize = 20;
/// A folder lists at most this many entries, with a count of the rest (R35).
pub const LIST_CAP: usize = 2000;
const SKIPPED_NAMES: [&str; 4] = ["node_modules", "target", "dist", "build"];

#[derive(Default)]
pub struct Inner {
    /// Real file paths opened this session, most recent first.
    pub recent: VecDeque<PathBuf>,
    /// Real paths Miguel allowed by a click: a confirmation card or a link (R7, R8). Only ever grows.
    pub allowed: HashSet<PathBuf>,
    /// The one `--anywhere` request waiting for Open or Dismiss.
    pub pending_confirm: Option<PathBuf>,
    /// The watch on the open file's folder (R29), held only to keep it alive.
    #[allow(dead_code)]
    pub watcher: Option<notify::RecommendedWatcher>,
    /// The socket this instance bound, so quitting removes only its own (R16).
    pub socket: Option<PathBuf>,
    /// A download is under way: its save sheet is up, or its copy is being written. One at a time (export.rs).
    pub exporting: bool,
}

impl Inner {
    pub fn remember(&mut self, path: PathBuf) {
        self.recent.retain(|p| p != &path);
        self.recent.push_front(path);
        self.recent.truncate(RECENT_CAP);
    }
}

#[derive(Default)]
pub struct ReaderState(Mutex<Inner>);

impl ReaderState {
    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// A refusal the webview shows as it is: `message` is the reader's line (§4 of the build spec).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ReaderError {
    code: &'static str,
    message: String,
}

impl ReaderError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        ReaderError { code, message: message.into() }
    }

    fn denied(denied: &Denied, path: &Path) -> Self {
        ReaderError { code: denied.code(), message: denied.reader_message(path) }
    }
}

#[derive(Debug, Serialize)]
pub struct ReaderDoc {
    path: String,
    display_path: String,
    /// The projects root's real path, for links that start with `/`.
    root: String,
    kind: Kind,
    /// How the webview shows it (R2). None for a folder, which has no document.
    render: Option<access::Render>,
    /// The lowercased extension, or file name when there is none, so the webview can pick a highlighter (R11).
    /// A neutral fact about the file: the mapping to a highlighter's own language ids lives in the webview.
    ext: String,
    text: Option<Text>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct DirEntry {
    name: String,
    path: String,
    kind: Kind,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct DirListing {
    entries: Vec<DirEntry>,
    more: usize,
}

#[derive(Debug, Serialize)]
pub struct ClickTarget {
    path: String,
    kind: Kind,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

fn absolute(path: &str) -> Result<PathBuf, ReaderError> {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(ReaderError::new("bad_request", format!("Not an absolute path: {}", path.display())))
    }
}

/// Resolved (R2, R3) and inside the root or allowed (R8).
fn checked(state: &ReaderState, root: &Path, path: &str) -> Result<(PathBuf, Kind), ReaderError> {
    let path = absolute(path)?;
    let (real, kind) = access::resolve(&path).map_err(|d| ReaderError::denied(&d, &path))?;
    if !access::permitted(&real, root, &state.lock().allowed) {
        return Err(ReaderError::denied(&Denied::Outside, &real));
    }
    Ok((real, kind))
}

/// Runs a reader command's file work on a worker thread.
///
/// A sync Tauri command runs on the main thread. On the first prod install (2026-09-15) one read never returned, and
/// that froze the window, the terminal pane with it, and — through the window call in the socket's handler — every
/// `kinas open` after it. Nothing in the reader touches the disk on the main thread any more. A slow read is logged
/// with its duration only: never a path or any file content (R9's privacy rule).
async fn off_main<T: Send + 'static>(work: impl FnOnce() -> Result<T, ReaderError> + Send + 'static) -> Result<T, ReaderError> {
    let started = std::time::Instant::now();
    let finished = tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| ReaderError::new("internal", format!("the reader's file work did not finish: {e}")))?;
    let ms = started.elapsed().as_millis();
    if ms > 1000 {
        log::warn!("reader: file work took {ms} ms");
    }
    finished
}

/// Opens a file (its text, R10) or a folder (no text) and records the file for `kinas open` with no path (R38).
#[tauri::command]
pub async fn reader_open(app: tauri::AppHandle, path: String) -> Result<ReaderDoc, ReaderError> {
    off_main(move || {
        let state = app.state::<ReaderState>();
        let root = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
        let (real, kind) = checked(&state, &root, &path)?;
        // Each step is timed on its own, so a repeat of the freeze says in the log which one blocked.
        let started = std::time::Instant::now();
        // An image is recognised by its extension and never read as text (R2); its bytes go to the webview
        // later, through reader_read_image. Everything else is read first, because deciding between `source`
        // and a refusal needs the head — and `read_text` sniffs it anyway, so there is no second read.
        let (render, text) = match kind {
            Kind::Dir => (None, None),
            Kind::File if access::is_image(&real) => (Some(access::Render::Image), None),
            Kind::File => {
                let text = access::read_text(&real).map_err(|d| ReaderError::denied(&d, &real))?;
                let head = text.text.as_bytes();
                let render = access::render_of(&real, Some(&head[..access::SNIFF_BYTES.min(head.len())]))
                    .map_err(|d| ReaderError::denied(&d, &real))?;
                (Some(render), Some(text))
            }
        };
        let read_ms = started.elapsed().as_millis();
        let watch_started = std::time::Instant::now();
        {
            let mut inner = state.lock();
            if kind == Kind::File {
                inner.remember(real.clone());
                // One watch at a time: the previous file's is dropped here (R29).
                inner.watcher = watch::watch_file(app.clone(), real.clone());
            }
            if inner.pending_confirm.as_deref() == Some(real.as_path()) {
                inner.pending_confirm = None;
            }
        }
        log::info!("reader: read in {read_ms} ms, watch in {} ms", watch_started.elapsed().as_millis());
        Ok(ReaderDoc {
            display_path: access::display_path(&real, &root, &home()),
            root: access::real_root(&root).display().to_string(),
            path: real.display().to_string(),
            kind,
            render,
            ext: access::ext_of(&real),
            text,
        })
    })
    .await
}

/// The open file again, for a live reload (R30).
#[tauri::command]
pub async fn reader_read_text(app: tauri::AppHandle, path: String) -> Result<Text, ReaderError> {
    off_main(move || {
        let state = app.state::<ReaderState>();
        let root = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
        let (real, kind) = checked(&state, &root, &path)?;
        if kind != Kind::File {
            // Its own code: a folder is not "not a text file". Reusing the text refusal here was a misuse from
            // the start, and it is webview-only — it never crosses the CLI wire — so a new code costs nothing.
            return Err(ReaderError::new("not_file", format!("Not a file: {}", real.display())));
        }
        access::read_text(&real).map_err(|d| ReaderError::denied(&d, &real))
    })
    .await
}

#[tauri::command]
pub async fn reader_list_dir(app: tauri::AppHandle, path: String) -> Result<DirListing, ReaderError> {
    off_main(move || {
        let state = app.state::<ReaderState>();
        let root = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
        let (real, kind) = checked(&state, &root, &path)?;
        if kind != Kind::Dir {
            return Err(ReaderError::new("not_dir", format!("Not a folder: {}", real.display())));
        }
        let allowed = state.lock().allowed.clone();
        list_dir(&real, &|p| access::permitted(p, &root, &allowed), LIST_CAP).map_err(|e| ReaderError::new("unreadable", format!("Could not read this folder: {e}")))
    })
    .await
}

/// Whether a file's head reads as text, for the tree's filter (R8).
///
/// Reads at most `SNIFF_BYTES`, not the file: a video sitting in a folder must cost one page, not its whole
/// length. An unreadable file answers false, so a permission error omits one row instead of failing the listing.
fn reads_as_text(real: &Path) -> bool {
    use std::io::Read;
    let Ok(mut file) = std::fs::File::open(real) else {
        return false;
    };
    let mut head = [0u8; access::SNIFF_BYTES];
    match file.read(&mut head) {
        Ok(read) => access::sniff(&head[..read]) == access::Content::Text,
        Err(_) => false,
    }
}

/// Whether the tree lists an entry of this name at all (R8): no dot-names — so nothing under `.git` — and no build
/// output. The one place the rule lives: `list_dir` asks it of every entry, and the tree's change marks (tree changes
/// rule 5) ask it of every component of a changed path, so a file the tree hides can never be marked.
pub fn listable_name(name: &str) -> bool {
    !name.starts_with('.') && !SKIPPED_NAMES.contains(&name)
}

/// Whether the tree lists this file (R8), judged by its real path: an image by its extension, anything else by its
/// head. The sniff reads at most `SNIFF_BYTES`; call it last, after every cheap filter.
pub fn listable_file(real: &Path) -> bool {
    access::is_image(real) || reads_as_text(real)
}

/// One folder for the tree (R35, R8): everything the reader can open, no dot-names or build output, folders first,
/// symlinks followed only to where the reader may go.
///
/// Binaries are omitted rather than greyed out: a greyed row needs a third tree state and names a file that
/// cannot be opened at all. A file over `MAX_TEXT_BYTES` is still listed — hiding a file Miguel can see in Finder
/// is worse than a clear refusal when he clicks it.
pub fn list_dir(dir: &Path, permitted: &dyn Fn(&Path) -> bool, cap: usize) -> std::io::Result<DirListing> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !listable_name(&name) {
            continue;
        }
        let Ok((real, kind)) = access::resolve(&entry.path()) else {
            continue;
        };
        if !permitted(&real) {
            continue;
        }
        // The sniff comes last, after every cheap filter, so most entries never cost a read. An image answers by
        // its extension, so a folder of screenshots reads nothing. Only the head is read: reading whole files to
        // list a folder would be absurd, and this runs inside `off_main`, never on the main thread.
        if kind == Kind::File && !listable_file(&real) {
            continue;
        }
        entries.push(DirEntry { name, path: real.display().to_string(), kind });
    }
    entries.sort_by(|a, b| (a.kind != Kind::Dir).cmp(&(b.kind != Kind::Dir)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let more = entries.len().saturating_sub(cap);
    entries.truncate(cap);
    Ok(DirListing { entries, more })
}

/// An image a page shows (R20), as raw bytes for a Blob URL.
#[tauri::command]
pub async fn reader_read_image(app: tauri::AppHandle, path: String) -> Result<tauri::ipc::Response, ReaderError> {
    off_main(move || {
        let state = app.state::<ReaderState>();
        let root = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
        let path = absolute(&path)?;
        let allowed = state.lock().allowed.clone();
        image_bytes(&path, &|p| access::permitted(p, &root, &allowed)).map(tauri::ipc::Response::new)
    })
    .await
}

pub fn image_bytes(path: &Path, permitted: &dyn Fn(&Path) -> bool) -> Result<Vec<u8>, ReaderError> {
    let real = std::fs::canonicalize(path).map_err(|_| ReaderError::denied(&Denied::Missing, path))?;
    if !access::is_image(&real) {
        return Err(ReaderError::new("not_image", format!("Not an image Kinas shows: {}", real.display())));
    }
    if !permitted(&real) {
        return Err(ReaderError::denied(&Denied::Outside, &real));
    }
    let meta = std::fs::metadata(&real).map_err(|e| ReaderError::new("unreadable", e.to_string()))?;
    if !meta.is_file() {
        return Err(ReaderError::new("not_image", format!("Not an image Kinas shows: {}", real.display())));
    }
    if meta.len() > access::MAX_IMAGE_BYTES {
        return Err(ReaderError::denied(&Denied::TooLarge(meta.len()), &real));
    }
    std::fs::read(&real).map_err(|e| ReaderError::new("unreadable", e.to_string()))
}

/// Open or Dismiss on the confirmation card (R7). Only the exact pending path can be allowed.
#[tauri::command]
pub async fn reader_confirm(app: tauri::AppHandle, path: String, allow: bool) -> Result<(), ReaderError> {
    off_main(move || {
        let state = app.state::<ReaderState>();
        let given = absolute(&path)?;
        let real = std::fs::canonicalize(&given).map_err(|_| ReaderError::denied(&Denied::Missing, &given))?;
        // The guard is bound, not a temporary in the tail expression: it must drop before `state` does.
        let mut inner = state.lock();
        confirm(&mut inner, &real, allow)
    })
    .await
}

pub fn confirm(inner: &mut Inner, real: &Path, allow: bool) -> Result<(), ReaderError> {
    if inner.pending_confirm.as_deref() != Some(real) {
        return Err(ReaderError::new("not_pending", "Nothing is waiting to be opened"));
    }
    inner.pending_confirm = None;
    if allow {
        inner.allowed.insert(real.to_path_buf());
    }
    Ok(())
}

/// A link or tree click is Miguel's intent (R8): an existing markdown file or folder becomes allowed.
#[tauri::command]
pub async fn reader_allow_click(app: tauri::AppHandle, path: String) -> Result<ClickTarget, ReaderError> {
    off_main(move || {
        let state = app.state::<ReaderState>();
        let path = absolute(&path)?;
        let (real, kind) = access::resolve(&path).map_err(|d| ReaderError::denied(&d, &path))?;
        state.lock().allowed.insert(real.clone());
        Ok(ClickTarget { path: real.display().to_string(), kind })
    })
    .await
}

#[tauri::command]
pub fn reader_close(state: State<'_, ReaderState>) {
    state.lock().watcher = None;
}

/// Only http, https and mailto, with no control characters (R21).
pub fn external_url_ok(url: &str) -> bool {
    let head = url.get(..8).unwrap_or(url).to_ascii_lowercase();
    url.len() <= 2048 && !url.chars().any(char::is_control) && (head.starts_with("http://") || head.starts_with("https://") || head.starts_with("mailto:"))
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), ReaderError> {
    if !external_url_ok(&url) {
        return Err(ReaderError::new("bad_url", "Kinas opens only http, https and mailto links"));
    }
    // Debug builds only: e2e clicks a link without opening a browser on Miguel's screen.
    #[cfg(debug_assertions)]
    if std::env::var("KINAS_E2E_NO_OPEN").as_deref() == Ok("1") {
        log::info!("open_external: a link was not opened because KINAS_E2E_NO_OPEN is set");
        return Ok(());
    }
    let mut child = std::process::Command::new("/usr/bin/open")
        .arg(&url)
        .spawn()
        .map_err(|e| ReaderError::new("open_failed", format!("Could not open the link: {e}")))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// How long an open took, from the socket to the last diagram (the 200 ms target). Counts only: never a path.
#[tauri::command]
pub fn reader_rendered(lines: u32, diagrams: u32, ms: u64) {
    log::info!("reader: rendered {lines} lines, {diagrams} diagrams in {ms} ms");
}

/// Print as PDF (three-column shell §9): raises the macOS print sheet on the window, where "Save as PDF" lives.
///
/// `print()` only posts a message to the event loop, which runs the sheet on the main thread (wry 0.55.1,
/// wkwebview/mod.rs:858-898), so there is nothing here to move off it. The sheet gives no signal when it closes and
/// the whole webview is what gets printed — so nothing is prepared here and nothing is undone afterwards: what reaches
/// the paper is decided by `styles/print.css` alone, and `scripts/print-probe.ts` proves that stylesheet on the engine.
///
/// Called from Rust rather than by granting the webview `core:webview:allow-print`: the capability file stays as it
/// was, and the page can ask for the sheet only through this one command.
#[tauri::command]
pub async fn reader_print(window: tauri::WebviewWindow) -> Result<(), ReaderError> {
    // Debug builds only: a native sheet would hang an e2e run, and no agent can click it away.
    #[cfg(debug_assertions)]
    if std::env::var("KINAS_E2E_NO_PRINT").as_deref() == Ok("1") {
        log::info!("reader: print skipped because KINAS_E2E_NO_PRINT is set");
        return Ok(());
    }
    window.print().map_err(|_| ReaderError::new("print_failed", "Could not open the print sheet"))
}

/// Open in editor (R37): re-check the file, read the editor setting, then split Herdr's focused pane off the UI
/// thread, since three `herdr` calls can take up to 3 s each.
#[tauri::command]
pub async fn reader_open_in_editor(app: tauri::AppHandle, path: String) -> Result<(), ReaderError> {
    let (real, editor_command) = {
        let state = app.state::<ReaderState>();
        let root = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
        let (real, kind) = checked(&state, &root, &path)?;
        if kind != Kind::File {
            return Err(ReaderError::new("not_file", "Choose a file to open in the editor"));
        }
        let store = app.state::<crate::store::Store>();
        let editor_command = crate::system::get_setting(&store.conn(), store.org_id(), "reader_editor")
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| editor::DEFAULT_EDITOR.into());
        (real, editor_command)
    };
    tauri::async_runtime::spawn_blocking(move || editor::open_in_editor(&editor_command, &real))
        .await
        .map_err(|e| ReaderError::new("editor_failed", e.to_string()))?
        .map_err(|message| ReaderError::new("editor_failed", message))
}

/// Open in the terminal (R37b): re-check the folder, then ask Herdr for its workspace off the UI thread — focusing
/// the one that carries the folder's label, creating it in that folder otherwise. Nothing is typed into the Kinas
/// terminal. The log gets the outcome and the time, never the folder, its label or Herdr's words (which can repeat
/// `--cwd`).
#[tauri::command]
pub async fn reader_open_in_terminal(app: tauri::AppHandle, path: String) -> Result<workspace::Opened, ReaderError> {
    let (real, label) = {
        let state = app.state::<ReaderState>();
        let root = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
        let (real, kind) = checked(&state, &root, &path)?;
        if kind != Kind::Dir {
            return Err(ReaderError::new("not_dir", "Choose a folder to open in the terminal"));
        }
        let label = workspace::label_for(&real, &root, &home());
        (real, label)
    };
    let started = std::time::Instant::now();
    let opened = tauri::async_runtime::spawn_blocking(move || workspace::open_folder(&real, &label))
        .await
        .map_err(|e| ReaderError::new("terminal_failed", e.to_string()))?
        .map_err(|message| ReaderError::new("terminal_failed", message))?;
    log::info!("reader: folder opened in the terminal ({}) in {} ms", opened.word(), started.elapsed().as_millis());
    Ok(opened)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    #[test]
    fn recent_keeps_twenty_most_recent_first_without_repeats() {
        let mut inner = Inner::default();
        for i in 0..25 {
            inner.remember(PathBuf::from(format!("/r/{i}.md")));
        }
        inner.remember(PathBuf::from("/r/10.md"));
        assert_eq!(inner.recent.len(), RECENT_CAP);
        assert_eq!(inner.recent.front(), Some(&PathBuf::from("/r/10.md")));
        assert_eq!(inner.recent.iter().filter(|p| p.ends_with("10.md")).count(), 1);
        assert_eq!(inner.recent.get(1), Some(&PathBuf::from("/r/24.md")));
    }

    #[test]
    fn a_folder_lists_folders_then_every_openable_file_without_hidden_or_build_output() {
        let dir = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(dir.path()).unwrap();
        let root = base.join("root");
        for d in ["root/b", "root/z", "root/node_modules", "root/.git", "outside"] {
            fs::create_dir_all(base.join(d)).unwrap();
        }
        for f in ["root/A.md", "root/c.MDX", "root/.hidden.md", "root/notes.txt", "outside/x.md", "root/build"] {
            fs::write(base.join(f), "x").unwrap();
        }
        symlink(base.join("outside/x.md"), root.join("out.md")).unwrap();
        symlink(root.join("A.md"), root.join("alias.md")).unwrap();

        let permitted = |p: &Path| access::inside(p, &root);
        let listing = list_dir(&root, &permitted, LIST_CAP).unwrap();
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        // Folders first, then every openable file: `notes.txt` is listed now (R8). Still absent, each for its own
        // reason: `build` and `node_modules` by name, `.hidden.md` and `.git` by the dot rule, and `out.md`
        // because its target leaves the root.
        assert_eq!(names, ["b", "z", "A.md", "alias.md", "c.MDX", "notes.txt"]);
        // Found by name, not by index: an index asserts the sort order a second time and then breaks for the
        // wrong reason when the list changes.
        let a_md = listing.entries.iter().find(|e| e.name == "A.md").expect("A.md is listed");
        assert_eq!(a_md.path, root.join("A.md").display().to_string());
        assert_eq!(listing.more, 0);

        let capped = list_dir(&root, &permitted, 2).unwrap();
        assert_eq!((capped.entries.len(), capped.more), (2, 4));
    }

    #[test]
    fn listable_name_is_the_dot_rule_and_skipped_names() {
        for hidden in [".env", ".git", ".hidden.md", "node_modules", "target", "dist", "build"] {
            assert!(!listable_name(hidden), "{hidden} must not be listed");
        }
        for shown in ["README.md", "src", "builds", "Target", "dist.md", "a.b"] {
            assert!(listable_name(shown), "{shown} must be listed");
        }
    }

    #[test]
    fn images_must_be_known_types_within_reach_and_size() {
        let dir = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(dir.path()).unwrap();
        fs::write(base.join("p.png"), [1, 2, 3]).unwrap();
        fs::write(base.join("doc.pdf"), [1]).unwrap();
        let yes = |_: &Path| true;
        assert_eq!(image_bytes(&base.join("p.png"), &yes).unwrap(), vec![1, 2, 3]);
        assert_eq!(image_bytes(&base.join("doc.pdf"), &yes).unwrap_err().code, "not_image");
        assert_eq!(image_bytes(&base.join("gone.png"), &yes).unwrap_err().code, "missing");
        assert_eq!(image_bytes(&base.join("p.png"), &|_: &Path| false).unwrap_err().code, "outside");
    }

    #[test]
    fn only_the_pending_path_can_be_allowed() {
        let mut inner = Inner::default();
        let pending = PathBuf::from("/o/b.md");
        assert_eq!(confirm(&mut inner, &pending, true).unwrap_err().code, "not_pending");
        inner.pending_confirm = Some(pending.clone());
        assert_eq!(confirm(&mut inner, Path::new("/o/other.md"), true).unwrap_err().code, "not_pending");
        confirm(&mut inner, &pending, false).unwrap();
        assert!(inner.allowed.is_empty() && inner.pending_confirm.is_none());
        inner.pending_confirm = Some(pending.clone());
        confirm(&mut inner, &pending, true).unwrap();
        assert!(inner.allowed.contains(&pending));
    }

    #[test]
    fn only_http_https_and_mailto_links_are_opened() {
        for url in ["https://example.com/a?b#c", "HTTP://example.com", "mailto:x@y.z"] {
            assert!(external_url_ok(url), "{url}");
        }
        for url in ["file:///etc/hosts", "javascript:alert(1)", "vscode://file/x", "https://a\nb", "-a", ""] {
            assert!(!external_url_ok(url), "{url}");
        }
        assert!(!external_url_ok(&format!("https://{}", "a".repeat(2100))));
    }
}
