//! Settings → Where agents run (build spec §4, §11.2): what the webview asks of the VPS, each through the one door
//! (ADR 0024), off the main thread and with no store guard held across the call. Slice 1: the Reachable row.

use crate::place::{place, Place};
use crate::readers::runtime::ReaderControl;
use crate::remote::{self, Request};
use crate::store::{now_ms, Store};
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The Reachable row: whether the door reached the companion, and in what words when it did not.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Hello {
    pub reachable: bool,
    /// `can't reach vps-1: timed out`, or None when reachable.
    pub problem: Option<String>,
    pub companion_version: Option<String>,
    pub checked_at: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RemoteError {
    message: String,
}

fn hello_of(label: &str, reply: Result<serde_json::Value, remote::Unreachable>, now: i64) -> Hello {
    match reply {
        Ok(v) => match v.pointer("/companion/version").and_then(serde_json::Value::as_str) {
            Some(version) => Hello { reachable: true, problem: None, companion_version: Some(version.chars().take(40).collect()), checked_at: now },
            None => Hello { reachable: false, problem: Some(remote::Unreachable::BadReply.words(label)), companion_version: None, checked_at: now },
        },
        Err(why) => Hello { reachable: false, problem: Some(why.words(label)), companion_version: None, checked_at: now },
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
        Ok(hello_of(&label, reply, now_ms()))
    })
    .await
    .map_err(|e| RemoteError { message: format!("the check did not finish: {e}") })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_reads_the_version_or_says_why_in_fixed_words() {
        let ok = hello_of("vps-1", Ok(serde_json::json!({"v": 1, "companion": {"version": "0.1.0"}})), 5);
        assert_eq!(ok, Hello { reachable: true, problem: None, companion_version: Some("0.1.0".into()), checked_at: 5 });
        let down = hello_of("vps-1", Err(remote::Unreachable::CompanionMissing), 5);
        assert_eq!(down.problem.as_deref(), Some("can't reach vps-1: Kinas is not installed there"));
        let odd = hello_of("vps-1", Ok(serde_json::json!({"v": 1})), 5);
        assert_eq!(odd.problem.as_deref(), Some("can't reach vps-1: the answer could not be read"));
    }
}
