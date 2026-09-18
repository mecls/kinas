//! Download a copy (three-column shell §6.3–6.5): the one place Kinas writes a file of Miguel's.
//!
//! The webview says *which* open file — nothing else. It never supplies the bytes and never names the destination:
//! Rust re-checks the path, opens the save sheet itself, reads the source itself and writes the copy itself. So a
//! page that can run script in the webview still cannot write a byte anywhere Miguel did not choose in a macOS
//! dialog, and cannot choose what is written there.
//!
//! The save sheet comes from `tauri-plugin-dialog`, used from Rust only. The plugin is registered with **no**
//! `dialog:*` permission in any capability, and Tauri checks the ACL on every `plugin:` command
//! (tauri 2.11.5, webview/mod.rs:1823-1851), so the webview cannot raise a dialog of its own. `reader-panel.e2e.ts`
//! pins that.

use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

use super::access::{self, Denied, Kind};
use super::{checked, off_main, ReaderError, ReaderState};

/// What the webview hears back. The **name** only, never the folder: where Miguel put a copy is his business, and
/// nothing on this side of the dialog needs to know it (§6.7).
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Exported {
    Saved { name: String, bytes: u64 },
    Cancelled,
}

/// Why a copy was not written. Every one of these leaves the destination's folder exactly as it was.
#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    /// The destination is the file being copied: the same path, or another name for the same file.
    SameFile,
    /// The destination is inside Kinas' own data, its logs, or the running app.
    Protected,
    /// The name is taken by a folder, a symlink, a socket — anything that is not a plain file.
    NotRegular,
    /// The source has grown past what the reader opens.
    TooLarge(u64),
    /// Anything else: the folder is gone, the disk is full, the write was refused.
    Failed,
}

impl Refused {
    fn into_error(self, source: &Path, name: &str) -> ReaderError {
        match self {
            Refused::SameFile => ReaderError::new("export_same_file", "That is this file — choose another place"),
            Refused::Protected => ReaderError::new("export_protected", "Kinas won't write there — choose another folder"),
            Refused::NotRegular => ReaderError::new("export_not_regular", "That name is taken by something that isn't a plain file"),
            Refused::TooLarge(len) => ReaderError::denied(&Denied::TooLarge(len), source),
            Refused::Failed => ReaderError::new("export_failed", format!("Could not save {name}")),
        }
    }
}

/// Copies `source` — already resolved and already permitted — to `dest`, byte for byte, or refuses.
///
/// Pure of Tauri on purpose: every rule here is proved against real files in a temp folder.
///
/// The order matters. "Is this the same file" comes before "is this a plain file", because a symlink that points
/// at the source is both, and "that is this file" is the answer that helps. The copy goes to a sibling temp file
/// first and is renamed over the destination last, so a full disk or a pulled drive leaves either the old file or
/// the new one and never half of one; and the temp file is opened with `create_new`, so it can never be written
/// *through* something that was already there.
pub fn write_copy(source: &Path, dest: &Path, protected: &[PathBuf], max_bytes: u64) -> Result<(String, u64), Refused> {
    let name = dest.file_name().and_then(|n| n.to_str()).ok_or(Refused::Failed)?.to_string();
    let parent = dest.parent().filter(|p| !p.as_os_str().is_empty()).ok_or(Refused::Failed)?;
    // The folder's real path: a symlinked folder must be judged by where it leads, not by what it is called.
    let parent = std::fs::canonicalize(parent).map_err(|_| Refused::Failed)?;
    let dest = parent.join(&name);

    let source_meta = std::fs::metadata(source).map_err(|_| Refused::Failed)?;
    if dest == source {
        return Err(Refused::SameFile);
    }
    // Follows links: a symlink or a hard link to the source is the source, whatever it is called.
    if let Ok(meta) = std::fs::metadata(&dest) {
        if meta.dev() == source_meta.dev() && meta.ino() == source_meta.ino() {
            return Err(Refused::SameFile);
        }
    }
    // Does not follow links: what is *at* that name. A dangling symlink has no metadata above, but it is here.
    if let Ok(meta) = std::fs::symlink_metadata(&dest) {
        if !meta.file_type().is_file() {
            return Err(Refused::NotRegular);
        }
    }
    if protected.iter().any(|p| access::inside(&parent, p)) {
        return Err(Refused::Protected);
    }

    if source_meta.len() > max_bytes {
        return Err(Refused::TooLarge(source_meta.len()));
    }
    let mut bytes = Vec::with_capacity(source_meta.len() as usize);
    // Bounded even if the file grows between the stat and the read.
    std::fs::File::open(source).and_then(|f| f.take(max_bytes + 1).read_to_end(&mut bytes)).map_err(|_| Refused::Failed)?;
    if bytes.len() as u64 > max_bytes {
        return Err(Refused::TooLarge(bytes.len() as u64));
    }

    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let temp = parent.join(format!(".{name}.kinas-{}-{nanos}.tmp", std::process::id()));
    let written = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, &dest)
    })();
    if written.is_err() {
        // Whatever failed, nothing of ours is left behind.
        let _ = std::fs::remove_file(&temp);
        return Err(Refused::Failed);
    }
    Ok((name, bytes.len() as u64))
}

/// One export at a time: a second click while the save sheet is up must not stack a second sheet on it. Released
/// when the command ends however it ends — success, refusal, a cancelled sheet, or a dropped future.
struct Busy(tauri::AppHandle);

impl Busy {
    fn take(app: &tauri::AppHandle) -> Result<Self, ReaderError> {
        let state = app.state::<ReaderState>();
        let mut inner = state.lock();
        if inner.exporting {
            return Err(ReaderError::new("export_busy", "A download is already in progress"));
        }
        inner.exporting = true;
        Ok(Busy(app.clone()))
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        self.0.state::<ReaderState>().lock().exporting = false;
    }
}

/// The gate, run before the sheet and again after it (§6.4): minutes can pass while a sheet is open, and nothing
/// is trusted because it was checked earlier. Only a file opened in the reader this session can be exported.
fn gate(app: &tauri::AppHandle, path: &str) -> Result<(PathBuf, u64), ReaderError> {
    let state = app.state::<ReaderState>();
    let root = crate::paths::projects_root_of(&app.state::<crate::store::Store>());
    let (real, kind) = checked(&state, &root, path)?;
    if kind != Kind::File {
        return Err(ReaderError::new("not_file", "Choose a file to download"));
    }
    if !state.lock().recent.contains(&real) {
        return Err(ReaderError::new("not_open", "Open the file before downloading it"));
    }
    let max = if access::is_image(&real) { access::MAX_IMAGE_BYTES } else { access::MAX_TEXT_BYTES };
    Ok((real, max))
}

/// Where a copy must never go: Kinas' own data (the store, the socket), its logs, and the app it is running from.
/// Real paths, so that `/var` and `/private/var` are one place.
fn protected_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(dir) = crate::paths::data_dir(app) {
        dirs.push(dir);
    }
    if let Ok(dir) = app.path().app_log_dir() {
        dirs.push(dir);
    }
    if let Some(bundle) = std::env::current_exe().ok().and_then(|exe| exe.ancestors().find(|a| a.extension().is_some_and(|e| e == "app")).map(Path::to_path_buf)) {
        dirs.push(bundle);
    }
    dirs.into_iter().map(|d| std::fs::canonicalize(&d).unwrap_or(d)).collect()
}

/// Asks Miguel where the copy goes. `None` is Cancel. The only function that knows a dialog plugin exists.
async fn choose_destination(app: &tauri::AppHandle, window: &tauri::WebviewWindow, name: &str) -> Result<Option<PathBuf>, ReaderError> {
    // Debug builds only: no agent can click a native sheet, so e2e names the destination instead. Every guard in
    // `write_copy` still runs — the seam replaces the question, never the rules.
    #[cfg(debug_assertions)]
    if let Some(to) = std::env::var_os("KINAS_E2E_EXPORT_TO") {
        return Ok(Some(PathBuf::from(to)));
    }
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_parent(window).set_title("Download a copy").set_file_name(name).set_can_create_directories(true);
    if let Ok(downloads) = app.path().download_dir() {
        dialog = dialog.set_directory(downloads);
    }
    // The plugin runs the sheet on the main thread itself and this waits for it on a worker: blocking here, on the
    // async runtime's own thread, would stall every other command. Not through `off_main` — a person choosing a
    // folder takes longer than a second, and that is not slow file work worth a warning in the log.
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| ReaderError::new("internal", format!("the save dialog did not finish: {e}")))?;
    Ok(picked.and_then(|p| p.into_path().ok()))
}

/// Download a copy of the open file to wherever Miguel chooses in the save sheet.
#[tauri::command]
pub async fn reader_export(app: tauri::AppHandle, window: tauri::WebviewWindow, path: String) -> Result<Exported, ReaderError> {
    let _busy = Busy::take(&app)?;

    let (real, _) = {
        let (app, path) = (app.clone(), path.clone());
        off_main(move || gate(&app, &path)).await?
    };
    let name = real.file_name().and_then(|n| n.to_str()).unwrap_or("copy").to_string();

    let Some(dest) = choose_destination(&app, &window, &name).await? else {
        return Ok(Exported::Cancelled);
    };

    let started = std::time::Instant::now();
    let worker = app.clone();
    let (name, bytes) = off_main(move || {
        let (real, max) = gate(&worker, &path)?;
        let fallback = dest.file_name().and_then(|n| n.to_str()).unwrap_or("the copy").to_string();
        write_copy(&real, &dest, &protected_dirs(&worker), max).map_err(|refused| refused.into_error(&real, &fallback))
    })
    .await?;
    // Counts only: never the name, never the folder (§6.7).
    log::info!("reader: exported {bytes} bytes in {} ms", started.elapsed().as_millis());
    Ok(Exported::Saved { name, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    const MAX: u64 = 1024;

    /// A source file in its own folder, a separate folder to save into, and what each holds before anything runs.
    struct Bench {
        _dir: tempfile::TempDir,
        source: PathBuf,
        out: PathBuf,
        mtime: std::time::SystemTime,
    }

    fn bench() -> Bench {
        let dir = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(dir.path()).unwrap();
        fs::create_dir_all(base.join("project")).unwrap();
        fs::create_dir_all(base.join("out")).unwrap();
        let source = base.join("project/plan.md");
        fs::write(&source, b"# Plan\n\nbytes \xEF\xBB\xBF and a BOM in the middle, kept exactly\n").unwrap();
        let mtime = fs::metadata(&source).unwrap().modified().unwrap();
        Bench { _dir: dir, source, out: base.join("out"), mtime }
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    /// After a refusal: the source is untouched, and the destination's folder holds exactly what it held before.
    fn assert_untouched(b: &Bench, folder: &Path, before: &[String]) {
        assert_eq!(names(folder), before, "a refusal left something behind");
        assert_eq!(fs::read(&b.source).unwrap(), b"# Plan\n\nbytes \xEF\xBB\xBF and a BOM in the middle, kept exactly\n");
        assert_eq!(fs::metadata(&b.source).unwrap().modified().unwrap(), b.mtime, "the source was written to");
    }

    #[test]
    fn a_copy_is_the_same_bytes_and_leaves_no_temp_file() {
        let b = bench();
        let (name, bytes) = write_copy(&b.source, &b.out.join("copy.md"), &[], MAX).unwrap();
        assert_eq!(name, "copy.md");
        assert_eq!(bytes, fs::metadata(&b.source).unwrap().len());
        // Byte for byte: `read_text` would have stripped a BOM and refused bad UTF-8; a copy does neither.
        assert_eq!(fs::read(b.out.join("copy.md")).unwrap(), fs::read(&b.source).unwrap());
        assert_eq!(names(&b.out), ["copy.md"]);
        assert_untouched(&b, &b.out, &["copy.md".to_string()]);
    }

    #[test]
    fn replacing_an_existing_plain_file_is_allowed_because_the_sheet_already_asked() {
        let b = bench();
        fs::write(b.out.join("copy.md"), b"older").unwrap();
        write_copy(&b.source, &b.out.join("copy.md"), &[], MAX).unwrap();
        assert_eq!(fs::read(b.out.join("copy.md")).unwrap(), fs::read(&b.source).unwrap());
        assert_eq!(names(&b.out), ["copy.md"]);
    }

    #[test]
    fn the_file_itself_is_refused_by_path() {
        let b = bench();
        let folder = b.source.parent().unwrap().to_path_buf();
        let before = names(&folder);
        assert_eq!(write_copy(&b.source, &b.source, &[], MAX), Err(Refused::SameFile));
        assert_untouched(&b, &folder, &before);
    }

    #[test]
    fn the_file_itself_is_refused_through_a_symlinked_folder() {
        let b = bench();
        // `out/alias` leads back to the project folder, so `out/alias/plan.md` is the source by another route.
        symlink(b.source.parent().unwrap(), b.out.join("alias")).unwrap();
        let before = names(&b.out);
        assert_eq!(write_copy(&b.source, &b.out.join("alias/plan.md"), &[], MAX), Err(Refused::SameFile));
        assert_untouched(&b, &b.out, &before);
    }

    #[test]
    fn a_symlink_to_the_file_is_the_file() {
        let b = bench();
        symlink(&b.source, b.out.join("link.md")).unwrap();
        let before = names(&b.out);
        assert_eq!(write_copy(&b.source, &b.out.join("link.md"), &[], MAX), Err(Refused::SameFile));
        assert_untouched(&b, &b.out, &before);
    }

    #[test]
    fn a_hard_link_to_the_file_is_the_file() {
        let b = bench();
        fs::hard_link(&b.source, b.out.join("hard.md")).unwrap();
        let before = names(&b.out);
        // Renaming a copy over a hard link would be harmless to the source; refusing is still right, because what
        // Miguel picked *is* this file, and "saved a copy" would be a lie about what he now has.
        assert_eq!(write_copy(&b.source, &b.out.join("hard.md"), &[], MAX), Err(Refused::SameFile));
        assert_untouched(&b, &b.out, &before);
    }

    #[test]
    fn a_name_taken_by_anything_but_a_plain_file_is_refused() {
        let b = bench();
        fs::write(b.out.join("elsewhere.md"), b"another file").unwrap();
        symlink(b.out.join("elsewhere.md"), b.out.join("to-other.md")).unwrap();
        symlink(b.out.join("nowhere"), b.out.join("dangling.md")).unwrap();
        fs::create_dir(b.out.join("folder.md")).unwrap();
        let before = names(&b.out);
        for taken in ["to-other.md", "dangling.md", "folder.md"] {
            assert_eq!(write_copy(&b.source, &b.out.join(taken), &[], MAX), Err(Refused::NotRegular), "{taken}");
            assert_untouched(&b, &b.out, &before);
        }
        // Writing through the symlink would have replaced the file it points at.
        assert_eq!(fs::read(b.out.join("elsewhere.md")).unwrap(), b"another file");
    }

    #[test]
    fn kinas_own_folders_are_refused_however_they_are_reached() {
        let b = bench();
        let data = b.out.join("ai.sintralabs.kinas");
        fs::create_dir_all(data.join("deeper")).unwrap();
        let app = b.out.join("Kinas.app/Contents/MacOS");
        fs::create_dir_all(&app).unwrap();
        symlink(&data, b.out.join("shortcut")).unwrap();
        let protected = [data.clone(), b.out.join("Kinas.app")];
        for dest in [data.join("plan.md"), data.join("deeper/plan.md"), app.join("plan.md"), b.out.join("shortcut/plan.md")] {
            let folder = fs::canonicalize(dest.parent().unwrap()).unwrap();
            let before = names(&folder);
            assert_eq!(write_copy(&b.source, &dest, &protected, MAX), Err(Refused::Protected), "{}", dest.display());
            assert_untouched(&b, &folder, &before);
        }
        // A folder that merely starts with the same letters is somewhere else.
        fs::create_dir_all(b.out.join("ai.sintralabs.kinas-backup")).unwrap();
        assert!(write_copy(&b.source, &b.out.join("ai.sintralabs.kinas-backup/plan.md"), &protected, MAX).is_ok());
    }

    #[test]
    fn a_source_past_the_limit_is_refused_before_anything_is_written() {
        let b = bench();
        let before = names(&b.out);
        let len = fs::metadata(&b.source).unwrap().len();
        assert_eq!(write_copy(&b.source, &b.out.join("copy.md"), &[], len - 1), Err(Refused::TooLarge(len)));
        assert_untouched(&b, &b.out, &before);
        assert!(write_copy(&b.source, &b.out.join("copy.md"), &[], len).is_ok());
    }

    #[test]
    fn a_failed_write_leaves_no_temp_file_and_a_missing_folder_is_a_failure() {
        let b = bench();
        assert_eq!(write_copy(&b.source, &b.out.join("gone/copy.md"), &[], MAX), Err(Refused::Failed));
        assert_eq!(write_copy(&b.source, Path::new("copy.md"), &[], MAX), Err(Refused::Failed));

        // A folder that cannot be written to: the temp file cannot even be created, and nothing appears.
        use std::os::unix::fs::PermissionsExt;
        let locked = b.out.join("locked");
        fs::create_dir(&locked).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        let refused = write_copy(&b.source, &locked.join("copy.md"), &[], MAX);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(refused, Err(Refused::Failed));
        assert_eq!(names(&locked), Vec::<String>::new());
        assert_untouched(&b, &locked, &[]);
    }

    #[test]
    fn every_refusal_has_its_own_code_and_the_exact_words() {
        let source = Path::new("/p/plan.md");
        let said = |r: Refused| {
            let e = r.into_error(source, "plan.md");
            (e.code, e.message)
        };
        assert_eq!(said(Refused::SameFile), ("export_same_file", "That is this file — choose another place".to_string()));
        assert_eq!(said(Refused::Protected), ("export_protected", "Kinas won't write there — choose another folder".to_string()));
        assert_eq!(said(Refused::NotRegular), ("export_not_regular", "That name is taken by something that isn't a plain file".to_string()));
        assert_eq!(said(Refused::Failed), ("export_failed", "Could not save plan.md".to_string()));
        assert_eq!(said(Refused::TooLarge(9_000_000)).0, "too_large");
    }

    #[test]
    fn the_answer_names_the_file_and_never_its_folder() {
        let saved = serde_json::to_value(Exported::Saved { name: "plan.md".into(), bytes: 12 }).unwrap();
        assert_eq!(saved, serde_json::json!({ "status": "saved", "name": "plan.md", "bytes": 12 }));
        assert_eq!(serde_json::to_value(Exported::Cancelled).unwrap(), serde_json::json!({ "status": "cancelled" }));
    }
}
