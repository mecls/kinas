//! Pinned files and folders (three-column shell §6.8, §6.11, §6.13): the sidebar's Pinned section.
//!
//! This is the one thing about what Miguel reads that Kinas remembers across launches, and the deliberate, narrow
//! exception to the reader's rule that file paths are never stored. Its limits are the point:
//!
//! - **An explicit click, and nothing else, writes a pin.** Opening a file does not; Recent lives in the webview's
//!   memory and dies with the process.
//! - **Paths only.** Never contents, never a hash, never a time.
//! - **One settings key**, `reader_pins`. Settings are read key by key everywhere (system.rs `get_setting`; the CLI's
//!   read-only adapter), so a pin cannot appear in `kinas status --json`; and nothing here logs a path.
//! - **A pin opens no door.** Pinning needs a path the reader may already read (`checked`), and opening a pin goes
//!   through `follow()` and its `reader_allow_click`, exactly as a click on the file tree does.
//! - **A missing pin stays.** `list` reports `exists: false` and only `reader_unpin` removes it: a file that is gone
//!   today may be back tomorrow (an unmounted drive, a branch switched away from), and silently dropping it would be
//!   Kinas deciding for Miguel what he still cares about.
//!
//! The store's mutex is not reentrant (it froze the window once), and `projects_root_of` takes it itself. So every
//! command here follows one order: the root first, with its guard dropped; then the disk work, holding no guard;
//! then one guard for the read-modify-write, with no file I/O inside it.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::access::{self, Kind};
use super::{absolute, checked, home, off_main, ReaderError, ReaderState};

pub const PINS_KEY: &str = "reader_pins";
pub const PINS_CAP: usize = 50;

/// A pin as it is stored: the real path, and what it was when pinned — so a missing folder still draws as a folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pin {
    pub path: String,
    pub kind: Kind,
}

/// A pin as the sidebar shows it.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct PinView {
    path: String,
    display_path: String,
    kind: Kind,
    /// False when nothing is at the path right now. The row stays, greyed, until Miguel unpins it.
    exists: bool,
}

/// The stored list. Anything that is not a list of pins reads as no pins — and is left alone until the next pin
/// overwrites it, rather than being "repaired" into something Miguel did not write. One entry per path, in the order
/// they were pinned, and never more than the cap even if the value was edited by hand.
pub fn parse(stored: Option<&serde_json::Value>) -> Vec<Pin> {
    let Some(entries) = stored.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut pins: Vec<Pin> = Vec::new();
    for entry in entries {
        let Ok(pin) = serde_json::from_value::<Pin>(entry.clone()) else {
            continue;
        };
        if Path::new(&pin.path).is_absolute() && !pins.iter().any(|p| p.path == pin.path) {
            pins.push(pin);
        }
        if pins.len() == PINS_CAP {
            break;
        }
    }
    pins
}

/// `pin` added at the end. Pinning what is already pinned changes nothing and is not an error; a 51st is refused.
pub fn with_pin(mut pins: Vec<Pin>, pin: Pin) -> Result<Vec<Pin>, ReaderError> {
    if pins.iter().any(|p| p.path == pin.path) {
        return Ok(pins);
    }
    if pins.len() >= PINS_CAP {
        return Err(ReaderError::new("pins_full", format!("{PINS_CAP} pins is the limit — unpin something first")));
    }
    pins.push(pin);
    Ok(pins)
}

pub fn without_pin(mut pins: Vec<Pin>, path: &str) -> Vec<Pin> {
    pins.retain(|p| p.path != path);
    pins
}

/// Read, change, write — under one guard, with no file I/O inside it. `change` is pure.
fn update(store: &crate::store::Store, change: impl FnOnce(Vec<Pin>) -> Result<Vec<Pin>, ReaderError>) -> Result<Vec<Pin>, ReaderError> {
    let conn = store.conn();
    let pins = change(parse(crate::system::get_setting(&conn, store.org_id(), PINS_KEY).as_ref()))?;
    let value = serde_json::to_value(&pins).map_err(|e| ReaderError::new("internal", e.to_string()))?;
    crate::system::put_setting(&conn, store.org_id(), PINS_KEY, &value).map_err(|_| ReaderError::new("pins_failed", "Could not save the pin"))?;
    Ok(pins)
}

fn stored(store: &crate::store::Store) -> Vec<Pin> {
    let conn = store.conn();
    parse(crate::system::get_setting(&conn, store.org_id(), PINS_KEY).as_ref())
}

/// What the sidebar shows for each pin. Disk work: call it with no store guard held.
pub fn views(pins: &[Pin], root: &Path, home: &Path) -> Vec<PinView> {
    pins.iter()
        .map(|pin| {
            let path = PathBuf::from(&pin.path);
            PinView { display_path: access::display_path(&path, root, home), exists: path.exists(), path: pin.path.clone(), kind: pin.kind }
        })
        .collect()
}

#[tauri::command]
pub async fn reader_pins(app: tauri::AppHandle) -> Result<Vec<PinView>, ReaderError> {
    off_main(move || {
        let store = app.state::<crate::store::Store>();
        let root = crate::paths::projects_root_of(&store);
        let pins = stored(&store);
        Ok(views(&pins, &root, &home()))
    })
    .await
}

/// Pins a file or folder the reader may already read. Returns the whole list, so the sidebar redraws from one answer.
#[tauri::command]
pub async fn reader_pin(app: tauri::AppHandle, path: String) -> Result<Vec<PinView>, ReaderError> {
    off_main(move || {
        let store = app.state::<crate::store::Store>();
        let root = crate::paths::projects_root_of(&store);
        let (real, kind) = checked(&app.state::<ReaderState>(), &root, &path)?;
        let pin = Pin { path: real.display().to_string(), kind };
        let pins = update(&store, |pins| with_pin(pins, pin))?;
        Ok(views(&pins, &root, &home()))
    })
    .await
}

/// Removes a pin by its stored path. No access check: the file may be gone, which is when unpinning matters most,
/// and removing a line from Miguel's own list reads nothing and reveals nothing.
#[tauri::command]
pub async fn reader_unpin(app: tauri::AppHandle, path: String) -> Result<Vec<PinView>, ReaderError> {
    off_main(move || {
        let store = app.state::<crate::store::Store>();
        let root = crate::paths::projects_root_of(&store);
        let path = absolute(&path)?.display().to_string();
        let pins = update(&store, |pins| Ok(without_pin(pins, &path)))?;
        Ok(views(&pins, &root, &home()))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pin(path: &str, kind: Kind) -> Pin {
        Pin { path: path.into(), kind }
    }

    #[test]
    fn a_stored_list_reads_back_in_order() {
        let stored = json!([{ "path": "/p/docs", "kind": "dir" }, { "path": "/p/plan.md", "kind": "file" }]);
        assert_eq!(parse(Some(&stored)), [pin("/p/docs", Kind::Dir), pin("/p/plan.md", Kind::File)]);
    }

    #[test]
    fn anything_that_is_not_a_list_of_pins_reads_as_no_pins() {
        assert_eq!(parse(None), []);
        for bad in [json!("nonsense"), json!({ "path": "/p" }), json!(7), json!(null)] {
            assert_eq!(parse(Some(&bad)), [], "{bad}");
        }
    }

    #[test]
    fn bad_entries_are_skipped_and_good_ones_kept() {
        let stored = json!([
            { "path": "/p/plan.md", "kind": "file" },
            { "path": "relative/plan.md", "kind": "file" },
            { "path": "/p/odd", "kind": "socket" },
            { "kind": "file" },
            "just a string",
            { "path": "/p/plan.md", "kind": "file" },
            { "path": "/p/docs", "kind": "dir" }
        ]);
        assert_eq!(parse(Some(&stored)), [pin("/p/plan.md", Kind::File), pin("/p/docs", Kind::Dir)]);
    }

    #[test]
    fn a_hand_edited_list_is_still_held_to_the_cap() {
        let many: Vec<_> = (0..80).map(|n| json!({ "path": format!("/p/{n}.md"), "kind": "file" })).collect();
        assert_eq!(parse(Some(&json!(many))).len(), PINS_CAP);
    }

    #[test]
    fn pinning_appends_pinning_twice_changes_nothing_and_the_fifty_first_is_refused() {
        let pins = with_pin(vec![pin("/p/a.md", Kind::File)], pin("/p/b.md", Kind::File)).unwrap();
        assert_eq!(pins, [pin("/p/a.md", Kind::File), pin("/p/b.md", Kind::File)]);
        assert_eq!(with_pin(pins.clone(), pin("/p/a.md", Kind::File)).unwrap(), pins);

        let full: Vec<Pin> = (0..PINS_CAP).map(|n| pin(&format!("/p/{n}.md"), Kind::File)).collect();
        let refused = with_pin(full.clone(), pin("/p/one-more.md", Kind::File)).unwrap_err();
        assert_eq!((refused.code, refused.message.as_str()), ("pins_full", "50 pins is the limit — unpin something first"));
        // Already pinned is still not an error when the list is full.
        assert_eq!(with_pin(full.clone(), pin("/p/0.md", Kind::File)).unwrap(), full);
    }

    #[test]
    fn unpinning_removes_that_path_only() {
        let pins = vec![pin("/p/a.md", Kind::File), pin("/p/b.md", Kind::File)];
        assert_eq!(without_pin(pins.clone(), "/p/a.md"), [pin("/p/b.md", Kind::File)]);
        assert_eq!(without_pin(pins.clone(), "/p/missing.md"), pins);
    }

    #[test]
    fn a_missing_pin_is_listed_as_missing_not_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("here.md"), "# here\n").unwrap();
        let pins = [pin(&root.join("here.md").display().to_string(), Kind::File), pin(&root.join("gone").display().to_string(), Kind::Dir)];
        let shown = views(&pins, &root, Path::new("/nowhere"));
        assert_eq!(shown.len(), 2);
        assert_eq!((shown[0].display_path.as_str(), shown[0].exists, shown[0].kind), ("here.md", true, Kind::File));
        // Still there, still a folder, and marked as missing.
        assert_eq!((shown[1].display_path.as_str(), shown[1].exists, shown[1].kind), ("gone", false, Kind::Dir));
    }

    #[test]
    fn pins_survive_the_store_being_closed_and_opened_again() {
        let dir = tempfile::tempdir().unwrap();
        {
            let store = crate::store::Store::open(dir.path()).unwrap();
            update(&store, |pins| with_pin(pins, pin("/p/plan.md", Kind::File))).unwrap();
            update(&store, |pins| with_pin(pins, pin("/p/docs", Kind::Dir))).unwrap();
        }
        // A relaunch: a new connection to the same file.
        let store = crate::store::Store::open(dir.path()).unwrap();
        assert_eq!(stored(&store), [pin("/p/plan.md", Kind::File), pin("/p/docs", Kind::Dir)]);
        update(&store, |pins| Ok(without_pin(pins, "/p/plan.md"))).unwrap();
        drop(store);
        let store = crate::store::Store::open(dir.path()).unwrap();
        assert_eq!(stored(&store), [pin("/p/docs", Kind::Dir)]);
    }

    #[test]
    fn a_value_that_cannot_be_read_is_left_alone_until_a_pin_overwrites_it() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(dir.path()).unwrap();
        crate::system::put_setting(&store.conn(), store.org_id(), PINS_KEY, &json!("not a list")).unwrap();
        assert_eq!(stored(&store), []);
        // Reading changed nothing on disk.
        assert_eq!(crate::system::get_setting(&store.conn(), store.org_id(), PINS_KEY), Some(json!("not a list")));
        update(&store, |pins| with_pin(pins, pin("/p/plan.md", Kind::File))).unwrap();
        assert_eq!(stored(&store), [pin("/p/plan.md", Kind::File)]);
    }
}
