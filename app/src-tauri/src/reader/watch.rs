//! Live reload (reader PRD R29): watch the open file's folder, not the file, because vim and most agents save by
//! writing a new file and renaming it over the old one, and a watch on the file would follow the old inode and go
//! silent after the first save. Events naming the file are debounced, then the webview is told which file changed.

use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Emitted with the changed file's path; the reader re-reads it if it is still the one on screen.
pub const READER_CHANGED: &str = "reader_changed";
const DEBOUNCE: Duration = Duration::from_millis(75);

#[derive(Clone, Serialize)]
struct Changed {
    path: String,
}

/// The log's note for a folder that could not be watched: the kind of failure and nothing else. notify's own words
/// end "about [<the folder>]", and the folder of an open file, or a transcripts root, is a path (ADR 0007).
pub(crate) fn watch_note(e: &notify::Error) -> String {
    format!("could not watch a folder ({})", super::changes::error_kind(e))
}

/// A watch that lasts as long as the returned watcher; dropping it (another file, or closing the reader) ends the
/// thread too. `None` when the folder cannot be watched: the page still shows, it just does not follow the file.
pub fn watch_file(app: AppHandle, file: PathBuf) -> Option<RecommendedWatcher> {
    let dir = file.parent()?.to_path_buf();
    let name = file.file_name()?.to_os_string();
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if event.paths.iter().any(|p| p.file_name() == Some(name.as_os_str())) {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| log::error!("reader watch: {e}"))
    .ok()?;
    watcher.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| log::warn!("reader watch: {}", watch_note(&e))).ok()?;

    let path = file.display().to_string();
    std::thread::Builder::new()
        .name("reader-watch".into())
        .spawn(move || debounce(&rx, DEBOUNCE, || {
            let _ = app.emit(READER_CHANGED, Changed { path: path.clone() });
        }))
        .map_err(|e| log::error!("reader watch: could not start its thread: {e}"))
        .ok()?;
    Some(watcher)
}

/// Fires once per burst: after an event, waits until `quiet` passes with no other, then calls `fire`. Returns when the
/// sender is gone.
pub fn debounce(rx: &Receiver<()>, quiet: Duration, mut fire: impl FnMut()) {
    while rx.recv().is_ok() {
        while rx.recv_timeout(quiet).is_ok() {}
        fire();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread::sleep;

    /// ADR 0007: notify's own words for a failed watch end "about [<the folder>]", and the folder of an open file is a
    /// client's. The note the log gets says what kind of failure it was and nothing else — here and in the readers'
    /// `watch_with`, which logs through the same words.
    #[test]
    fn a_failed_watch_s_note_never_names_the_folder() {
        let folder = PathBuf::from("/Users/me/Documents/Projects/acme-client-9c2e/docs");
        let gone = notify::Error::path_not_found().add_path(folder.clone());
        assert!(gone.to_string().contains("9c2e"), "notify does name it: {gone}");
        let io = notify::Error::io(std::io::Error::other("Operation not permitted")).add_path(folder);
        for (e, kind) in [(gone, "path not found"), (io, "io")] {
            let note = watch_note(&e);
            assert!(!note.contains("9c2e") && !note.contains('/'), "{note}");
            assert_eq!(note, format!("could not watch a folder ({kind})"));
        }
    }

    #[test]
    fn a_burst_of_saves_fires_once_and_a_later_save_fires_again() {
        let (tx, rx) = mpsc::channel();
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        let thread = std::thread::spawn(move || debounce(&rx, Duration::from_millis(75), || {
            counter.fetch_add(1, Ordering::SeqCst);
        }));

        for _ in 0..3 {
            tx.send(()).unwrap();
            sleep(Duration::from_millis(20));
        }
        sleep(Duration::from_millis(250));
        assert_eq!(fired.load(Ordering::SeqCst), 1);

        tx.send(()).unwrap();
        sleep(Duration::from_millis(250));
        assert_eq!(fired.load(Ordering::SeqCst), 2);

        drop(tx);
        thread.join().unwrap();
    }
}
