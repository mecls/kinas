//! Where the agents run (ADR 0024; build spec §7 Place): this Mac, the default, or one VPS named by an SSH target and a
//! label. Kept in the settings table as `place`, `vps_target` and `vps_label`. A target is what OpenSSH is given as its
//! host argument, so it is held to a shape that can never be read as an option or a shell word: `user@host`, `host`,
//! `host:port` is not ssh's syntax and is refused (a port belongs in `~/.ssh/config`), and an alias is just a host.

use crate::store::Store;
use crate::system::{get_setting, put_setting};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub(crate) const PLACE_KEY: &str = "place";
pub(crate) const TARGET_KEY: &str = "vps_target";
pub(crate) const LABEL_KEY: &str = "vps_label";
/// Emitted when Settings saves a different place: the Work page's pane starts again on it.
pub(crate) const PLACE_CHANGED: &str = "place_changed";

const TARGET_HELP: &str = "Write it as user@host, host, or an ssh alias.";
const LABEL_HELP: &str = "A label is 1 to 32 lowercase letters, digits and dashes.";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "place", rename_all = "snake_case")]
pub enum Place {
    Mac,
    Vps { target: String, label: String },
}

/// The place as stored; anything missing or malformed reads as this Mac, so a damaged row never points Kinas at a
/// machine nobody chose.
pub(crate) fn place(conn: &Connection, org: &str) -> Place {
    let text = |key: &str| get_setting(conn, org, key).and_then(|v| v.as_str().map(str::to_string));
    match text(PLACE_KEY).as_deref() {
        Some("vps") => match (text(TARGET_KEY), text(LABEL_KEY)) {
            (Some(target), Some(label)) if valid_target(&target).is_ok() && valid_label(&label).is_ok() => Place::Vps { target, label },
            _ => Place::Mac,
        },
        _ => Place::Mac,
    }
}

pub(crate) fn save(conn: &Connection, org: &str, place: &Place) -> Result<(), &'static str> {
    match place {
        Place::Mac => put_setting(conn, org, PLACE_KEY, &serde_json::json!("mac")).map_err(|_| "Could not save the setting."),
        Place::Vps { target, label } => {
            valid_target(target)?;
            valid_label(label)?;
            put_setting(conn, org, TARGET_KEY, &serde_json::json!(target)).map_err(|_| "Could not save the setting.")?;
            put_setting(conn, org, LABEL_KEY, &serde_json::json!(label)).map_err(|_| "Could not save the setting.")?;
            put_setting(conn, org, PLACE_KEY, &serde_json::json!("vps")).map_err(|_| "Could not save the setting.")
        }
    }
}

/// `user@host` or `host`: a user of letters, digits, `.`, `_` and `-`; a host of letters, digits, `.`, `_` and `-`,
/// starting with a letter or digit; 1 to 253 characters in all. Nothing that starts with `-` (an option to ssh),
/// no whitespace, quote, `;`, `$`, backtick, `:` or `/`.
pub(crate) fn valid_target(t: &str) -> Result<(), &'static str> {
    if t.is_empty() || t.len() > 253 {
        return Err(TARGET_HELP);
    }
    let (user, host) = match t.split_once('@') {
        Some((u, h)) => (Some(u), h),
        None => (None, t),
    };
    let word = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let starts_well = |s: &str| s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
    if let Some(u) = user {
        if !word(u) || !starts_well(u) {
            return Err(TARGET_HELP);
        }
    }
    if !word(host) || !starts_well(host) {
        return Err(TARGET_HELP);
    }
    Ok(())
}

pub(crate) fn valid_label(l: &str) -> Result<(), &'static str> {
    let ok = (1..=32).contains(&l.len()) && l.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !l.starts_with('-');
    if ok {
        Ok(())
    } else {
        Err(LABEL_HELP)
    }
}

/// A refusal the webview shows as it is.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PlaceError {
    message: String,
}

#[tauri::command]
pub async fn get_place(app: AppHandle) -> Result<Place, PlaceError> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let conn = store.conn();
        place(&conn, store.org_id())
    })
    .await
    .map_err(|e| PlaceError { message: format!("could not read the setting: {e}") })
}

#[tauri::command]
pub async fn set_place(app: AppHandle, place: Place) -> Result<Place, PlaceError> {
    tauri::async_runtime::spawn_blocking(move || {
        let (before, saved) = {
            let store = app.state::<Store>();
            let conn = store.conn();
            let before = self::place(&conn, store.org_id());
            (before, save(&conn, store.org_id(), &place).map(|_| self::place(&conn, store.org_id())))
        };
        let saved = saved.map_err(|m| PlaceError { message: m.to_string() })?;
        log::info!("place: {}", if saved == Place::Mac { "this Mac" } else { "a VPS" });
        app.state::<crate::readers::runtime::ReaderControl>().refresh();
        // The Work page's pane attaches where the agents run (slice 3.1): a new place starts it again there.
        if saved != before {
            use tauri::Emitter;
            let _ = app.emit(PLACE_CHANGED, ());
        }
        Ok(saved)
    })
    .await
    .map_err(|e| PlaceError { message: format!("could not save the setting: {e}") })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_target_cases() {
        for ok in ["captain@203.0.113.24", "vps-1", "ab12cd34ef.agent37.app", "root@ab12cd34ef.agent37.app", "node@h", "kinas_vps"] {
            assert_eq!(valid_target(ok), Ok(()), "{ok}");
        }
        for bad in [
            "",
            "-oProxyCommand=x",
            "a b",
            "a;b",
            "a`b`",
            "$(x)",
            "h:2222",
            "u@",
            "@h",
            "-u@h",
            "u@-h",
            "u@h/x",
            "u@h\nother",
            "'h'",
            "a@b@c",
        ] {
            assert_eq!(valid_target(bad), Err(TARGET_HELP), "{bad:?}");
        }
        assert_eq!(valid_target(&"a".repeat(254)), Err(TARGET_HELP));
    }

    #[test]
    fn valid_label_cases() {
        for ok in ["vps-1", "kinas", "a"] {
            assert_eq!(valid_label(ok), Ok(()), "{ok}");
        }
        for bad in ["", "VPS", "-a", "a b", "a_b", &"a".repeat(33)] {
            assert_eq!(valid_label(bad), Err(LABEL_HELP), "{bad:?}");
        }
    }

    #[test]
    fn the_place_round_trips_and_a_damaged_row_reads_as_this_mac() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let conn = store.conn();
        let org = store.org_id();
        assert_eq!(place(&conn, org), Place::Mac);
        let vps = Place::Vps { target: "captain@203.0.113.24".into(), label: "vps-1".into() };
        save(&conn, org, &vps).unwrap();
        assert_eq!(place(&conn, org), vps);
        assert_eq!(save(&conn, org, &Place::Vps { target: "-oProxyCommand=x".into(), label: "vps-1".into() }), Err(TARGET_HELP));
        assert_eq!(place(&conn, org), vps, "a refused save changes nothing");
        put_setting(&conn, org, TARGET_KEY, &serde_json::json!("a b")).unwrap();
        assert_eq!(place(&conn, org), Place::Mac, "a damaged target reads as this Mac");
        save(&conn, org, &Place::Mac).unwrap();
        assert_eq!(place(&conn, org), Place::Mac);
    }
}
