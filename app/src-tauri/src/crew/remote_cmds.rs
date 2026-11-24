//! Settings → Where agents run (build spec §4, §11.2): what the webview asks of the VPS, each through the one door
//! (ADR 0024), off the main thread and with no store guard held across the call. Slice 1: the Reachable row.

use crate::place::{place, Place};
use crate::readers::runtime::ReaderControl;
use crate::remote::{self, Request};
use crate::store::{now_ms, Store};
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The Reachable row: whether the door reached the companion, and in what words when it did not; and Herdr's version on
/// both sides, which the row marks when they differ (build spec §17, 2026-11-24 #4).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Hello {
    pub reachable: bool,
    /// `can't reach vps-1: timed out`, or None when reachable.
    pub problem: Option<String>,
    pub companion_version: Option<String>,
    /// The VPS's Herdr, as its companion found it at `~/.local/bin/herdr`; None when there is none or it was not reached.
    pub herdr_there: Option<String>,
    /// This Mac's Herdr.
    pub herdr_here: Option<String>,
    pub checked_at: i64,
}

/// A version as the screen may show it: at most 40 characters of digits, dots and letters.
fn short_version(v: &serde_json::Value) -> Option<String> {
    v.as_str().map(|s| s.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-')).take(40).collect())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RemoteError {
    message: String,
}

fn hello_of(label: &str, reply: Result<serde_json::Value, remote::Unreachable>, here: Option<String>, now: i64) -> Hello {
    let down = |why: remote::Unreachable| Hello {
        reachable: false,
        problem: Some(why.words(label)),
        companion_version: None,
        herdr_there: None,
        herdr_here: here.clone(),
        checked_at: now,
    };
    match reply {
        Ok(v) => match v.pointer("/companion/version").and_then(short_version) {
            Some(version) => Hello {
                reachable: true,
                problem: None,
                companion_version: Some(version),
                herdr_there: v.pointer("/herdr/version").and_then(short_version),
                herdr_here: here.clone(),
                checked_at: now,
            },
            None => down(remote::Unreachable::BadReply),
        },
        Err(why) => down(why),
    }
}

#[tauri::command]
pub async fn remote_hello(app: AppHandle) -> Result<Hello, RemoteError> {
    tauri::async_runtime::spawn_blocking(move || {
        let chosen = {
            let store = app.state::<Store>();
            let conn = store.conn();
            place(&conn, store.org_id())
        };
        let Place::Vps { target, label } = chosen else {
            return Err(RemoteError { message: "Agents run on this Mac.".into() });
        };
        let data_dir = app.state::<ReaderControl>().data_dir().to_path_buf();
        let reply = remote::call(&target, &data_dir, &Request::Hello);
        Ok(hello_of(&label, reply, crate::crew::tools::herdr_version_here(), now_ms()))
    })
    .await
    .map_err(|e| RemoteError { message: format!("the check did not finish: {e}") })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_reads_the_versions_or_says_why_in_fixed_words() {
        let here = || Some("0.9.0".to_string());
        let ok = hello_of("vps-1", Ok(serde_json::json!({"v": 1, "companion": {"version": "0.1.0"}, "herdr": {"version": "0.9.5"}})), here(), 5);
        assert_eq!(
            ok,
            Hello {
                reachable: true,
                problem: None,
                companion_version: Some("0.1.0".into()),
                herdr_there: Some("0.9.5".into()),
                herdr_here: here(),
                checked_at: 5
            }
        );
        let no_herdr = hello_of("vps-1", Ok(serde_json::json!({"v": 1, "companion": {"version": "0.1.0"}, "herdr": null})), None, 5);
        assert_eq!((no_herdr.reachable, no_herdr.herdr_there, no_herdr.herdr_here), (true, None, None));
        let down = hello_of("vps-1", Err(remote::Unreachable::CompanionMissing), here(), 5);
        assert_eq!(down.problem.as_deref(), Some("can't reach vps-1: Kinas is not installed there"));
        assert_eq!(down.herdr_here, here(), "the Mac's own version shows even when the VPS cannot be reached");
        let odd = hello_of("vps-1", Ok(serde_json::json!({"v": 1})), here(), 5);
        assert_eq!(odd.problem.as_deref(), Some("can't reach vps-1: the answer could not be read"));
        let sly = hello_of("vps-1", Ok(serde_json::json!({"v": 1, "companion": {"version": "0.1.0"}, "herdr": {"version": "<b>9</b> /etc/passwd"}})), None, 5);
        assert_eq!(sly.herdr_there.as_deref(), Some("b9betcpasswd"), "only digits, letters, dots and dashes reach the screen");
    }
}
