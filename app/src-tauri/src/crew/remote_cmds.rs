//! Settings → Where agents run (build spec §4, §11.2): what the webview asks of the VPS, each through the one door
//! (ADR 0024), off the main thread and with no store guard held across the call. Slice 1: the Reachable row. Slice 2:
//! the status bar's VPS part, read from what the crew's readings left (`vps_reachability`), never a call of its own.
//! Slice 4: setup — `hello` carries the companion's checks (crew/setup.rs filters them), the client folders to clone and
//! the bootstrap command; `remote_install` runs one item and checks again.

use crate::crew::setup::{self, Bootstrap, Check, CloneOffer};
use crate::place::{place, Place};
use crate::readers::runtime::ReaderControl;
use crate::remote::{self, InstallItem, Request};
use std::path::Path;
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
    /// Slice 4: no companion answered there (ssh ran, `kinas` did not) — Settings shows the bootstrap.
    pub companion_missing: bool,
    /// Setup's rows, as crew/setup.rs lets them through; empty when the VPS was not reached.
    pub checks: Vec<Check>,
    /// The Mac's client folders with a GitHub origin, and whether the VPS has each.
    pub clones: Vec<CloneOffer>,
    /// The command that puts the companion there, for this app's version.
    pub bootstrap: Bootstrap,
}

/// The status bar's VPS part (DESIGN.md 1.14): the agents' machine in four states.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MachineState {
    Connected,
    /// The door failed less than `RECONNECTING_MS` ago, after a success; or nothing has been tried yet.
    Reconnecting,
    Unreachable,
    /// The door works but the companion's run loop has not read for `HEARTBEAT_MS`: `Kinas on the Linux machine is not running`.
    NotRunning,
}

/// Two missed readings (the loop reads every 15 s) before a failing door reads as unreachable.
const RECONNECTING_MS: i64 = 30_000;
/// The run loop's heartbeat is its reading; one older than this, while the door works, means the loop is not running.
const HEARTBEAT_MS: i64 = 60_000;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PlaceStatus {
    pub label: String,
    pub state: MachineState,
    /// When the door started failing: `unreachable since 14:02`.
    pub since: Option<i64>,
    pub last_success_at: Option<i64>,
    /// `can't reach vps-1: timed out` while failing; None otherwise.
    pub problem: Option<String>,
}

/// `vps_reachability`'s one row, as read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Reach {
    pub last_attempt_at: i64,
    pub last_success_at: Option<i64>,
    pub reason: Option<String>,
    pub heartbeat_at: Option<i64>,
}

/// The four states from the last attempt. `failing_since` is this run's memory of the first failure; without it (Kinas
/// restarted while the VPS was down) the last attempt stands in.
pub(crate) fn status_of(label: &str, reach: Option<&Reach>, failing_since: Option<i64>, now: i64) -> PlaceStatus {
    let status = |state, since, last_success_at, problem| PlaceStatus { label: label.to_string(), state, since, last_success_at, problem };
    let Some(r) = reach else { return status(MachineState::Reconnecting, None, None, None) };
    match &r.reason {
        None => {
            // A heartbeat stamped in what is now the future has an unknown age: not a reason to say the loop stopped.
            let stopped = r.heartbeat_at.is_none_or(|at| now - at > HEARTBEAT_MS);
            status(if stopped { MachineState::NotRunning } else { MachineState::Connected }, None, r.last_success_at, None)
        }
        Some(code) => {
            let since = failing_since.unwrap_or(r.last_attempt_at);
            let fresh = r.last_success_at.is_some() && (0..RECONNECTING_MS).contains(&(now - since));
            let problem = remote::Unreachable::from_code(code).map(|u| u.words(label));
            status(if fresh { MachineState::Reconnecting } else { MachineState::Unreachable }, Some(since), r.last_success_at, problem)
        }
    }
}

/// The status bar's VPS part: None while the agents run on this Mac. Reads the store only.
#[tauri::command]
pub async fn place_status(app: AppHandle) -> Result<Option<PlaceStatus>, RemoteError> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let conn = store.conn();
        let Place::Vps { label, .. } = place(&conn, store.org_id()) else { return Ok(None) };
        let reach = conn
            .query_row(
                "SELECT last_attempt_at, last_success_at, reason, companion_heartbeat_at FROM vps_reachability WHERE org_id = ?1",
                [store.org_id()],
                |r| Ok(Reach { last_attempt_at: r.get(0)?, last_success_at: r.get(1)?, reason: r.get(2)?, heartbeat_at: r.get(3)? }),
            )
            .ok();
        drop(conn);
        let failing_since = app.state::<crate::readers::crew::CrewLive>().remote_failing_since();
        Ok(Some(status_of(&label, reach.as_ref(), failing_since, now_ms())))
    })
    .await
    .map_err(|e| RemoteError { message: format!("could not read the Linux machine's state: {e}") })?
}

/// A code to pair a phone: what the companion minted, once, and the link when it knows the page (slice 8.1). Kept nowhere:
/// not in the store, not in the log, and not in the door's argv — it comes back on the reply and goes to the screen.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PairStart {
    pub code: String,
    pub url: Option<String>,
    pub expires_at: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Phone {
    pub id: String,
    pub name: String,
    pub paired_at: i64,
    pub last_seen_at: i64,
    pub push: bool,
}

/// The words of the companion's two cloud errors; any other reply is a reply that could not be read.
fn cloud_words(reply: &serde_json::Value) -> Option<&'static str> {
    match reply.get("error").and_then(|e| e.as_str()) {
        Some("no-cloud") => Some("The cloud store isn't set up on the Linux machine."),
        Some("cloud-failed") => Some("The cloud store didn't answer. Try again."),
        _ => None,
    }
}

/// `^[0-9A-HJKMNP-TV-Z]{8}$` (Crockford's base32): a code anything else can't be.
fn code_ok(code: &str) -> bool {
    code.len() == 8 && code.bytes().all(|b| matches!(b, b'0'..=b'9' | b'A'..=b'H' | b'J' | b'K' | b'M' | b'N' | b'P'..=b'T' | b'V'..=b'Z'))
}

/// A link to the phone page: https, no spaces or quotes, short.
fn page_url_ok(url: &str) -> bool {
    url.starts_with("https://") && url.len() <= 300 && url.bytes().all(|b| b.is_ascii_graphic())
}

fn pair_of(reply: &serde_json::Value) -> Result<PairStart, String> {
    if let Some(words) = cloud_words(reply) {
        return Err(words.to_string());
    }
    let code = reply.get("code").and_then(|c| c.as_str()).filter(|c| code_ok(c));
    let expires_at = reply.get("expires_at").and_then(|e| e.as_i64());
    let (Some(code), Some(expires_at)) = (code, expires_at) else { return Err("the answer could not be read".into()) };
    let url = reply.get("url").and_then(|u| u.as_str()).filter(|u| page_url_ok(u) && u.ends_with(&format!("#pair={code}"))).map(str::to_string);
    Ok(PairStart { code: code.to_string(), url, expires_at })
}

fn phones_of(reply: &serde_json::Value) -> Result<Vec<Phone>, String> {
    if let Some(words) = cloud_words(reply) {
        return Err(words.to_string());
    }
    let Some(rows) = reply.get("phones").and_then(|p| p.as_array()) else { return Err("the answer could not be read".into()) };
    Ok(rows
        .iter()
        .filter_map(|r| {
            let id = r.get("id")?.as_str().filter(|i| (1..=64).contains(&i.len()) && i.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))?;
            let name: String = r.get("name")?.as_str()?.chars().filter(|c| !c.is_control() && !matches!(c, '<' | '>')).take(60).collect();
            Some(Phone { id: id.to_string(), name, paired_at: r.get("paired_at")?.as_i64()?, last_seen_at: r.get("last_seen_at")?.as_i64()?, push: r.get("push")?.as_bool()? })
        })
        .collect())
}

/// The VPS chosen, and its door's words for a failure, shared by the three phone commands.
fn vps_of(app: &AppHandle) -> Result<(String, String), RemoteError> {
    let store = app.state::<Store>();
    let conn = store.conn();
    match place(&conn, store.org_id()) {
        Place::Vps { target, label } => Ok((target, label)),
        Place::Mac => Err(RemoteError { message: "Agents run on this Mac.".into() }),
    }
}

fn phone_call(app: &AppHandle, request: Request) -> Result<serde_json::Value, RemoteError> {
    let (target, label) = vps_of(app)?;
    let data_dir = app.state::<ReaderControl>().data_dir().to_path_buf();
    remote::call(&target, &data_dir, &request).map_err(|why| RemoteError { message: why.words(&label) })
}

/// Pair a phone (Settings → Where agents run): a code for the captain to type on the phone, or its link. The code is on this
/// reply and nowhere else; nothing here keeps it.
#[tauri::command]
pub async fn remote_pair_start(app: AppHandle) -> Result<PairStart, RemoteError> {
    tauri::async_runtime::spawn_blocking(move || {
        let reply = phone_call(&app, Request::PairStart)?;
        pair_of(&reply).map_err(|message| RemoteError { message })
    })
    .await
    .map_err(|e| RemoteError { message: format!("pairing did not start: {e}") })?
}

/// `{ sent: true }`, or the companion's cloud error in words.
fn test_sent(reply: &serde_json::Value) -> Result<(), String> {
    if let Some(words) = cloud_words(reply) {
        return Err(words.to_string());
    }
    if reply.get("sent") == Some(&serde_json::Value::Bool(true)) {
        Ok(())
    } else {
        Err("the answer could not be read".into())
    }
}

/// Settings' Send a test notification: the store pushes to each phone that has allowed them. Whether one arrived is for
/// the phone to say; this only says the store was asked.
#[tauri::command]
pub async fn remote_test_notification(app: AppHandle) -> Result<(), RemoteError> {
    tauri::async_runtime::spawn_blocking(move || {
        let reply = phone_call(&app, Request::TestNotification)?;
        test_sent(&reply).map_err(|message| RemoteError { message })
    })
    .await
    .map_err(|e| RemoteError { message: format!("the test did not start: {e}") })?
}

#[tauri::command]
pub async fn remote_phones(app: AppHandle) -> Result<Vec<Phone>, RemoteError> {
    tauri::async_runtime::spawn_blocking(move || {
        let reply = phone_call(&app, Request::Phones)?;
        phones_of(&reply).map_err(|message| RemoteError { message })
    })
    .await
    .map_err(|e| RemoteError { message: format!("the phones could not be read: {e}") })?
}

/// Remove one phone; the phones that are left come back.
#[tauri::command]
pub async fn remote_unpair(app: AppHandle, id: String) -> Result<Vec<Phone>, RemoteError> {
    tauri::async_runtime::spawn_blocking(move || {
        if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return Err(RemoteError { message: "That is not a phone's id.".into() });
        }
        let reply = phone_call(&app, Request::Unpair { id })?;
        phones_of(&reply).map_err(|message| RemoteError { message })
    })
    .await
    .map_err(|e| RemoteError { message: format!("the phone was not removed: {e}") })?
}

/// A version as the screen may show it: at most 40 characters of digits, dots and letters.
fn short_version(v: &serde_json::Value) -> Option<String> {
    v.as_str().map(|s| s.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-')).take(40).collect())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RemoteError {
    message: String,
}

/// What the Mac adds to a hello: its projects root (for the clone offers) and its own version (for the bootstrap).
pub(crate) struct Here<'a> {
    pub herdr: Option<String>,
    pub root: Option<&'a Path>,
    pub version: &'a str,
}

fn hello_of(label: &str, reply: Result<serde_json::Value, remote::Unreachable>, here: Here, now: i64) -> Hello {
    let down = |why: remote::Unreachable| Hello {
        reachable: false,
        problem: Some(why.words(label)),
        companion_version: None,
        herdr_there: None,
        herdr_here: here.herdr.clone(),
        checked_at: now,
        companion_missing: why == remote::Unreachable::CompanionMissing,
        checks: Vec::new(),
        clones: Vec::new(),
        bootstrap: setup::bootstrap(here.version),
    };
    match reply {
        Ok(v) => match v.pointer("/companion/version").and_then(short_version) {
            Some(version) => Hello {
                reachable: true,
                problem: None,
                companion_version: Some(version),
                herdr_there: v.pointer("/herdr/version").and_then(short_version),
                herdr_here: here.herdr.clone(),
                checked_at: now,
                companion_missing: false,
                checks: setup::checks_of(&v),
                clones: here.root.map(|r| setup::clone_offers(r, &setup::folders_there(&v))).unwrap_or_default(),
                bootstrap: setup::bootstrap(here.version),
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
        Ok(hello_now(&app, &target, &label))
    })
    .await
    .map_err(|e| RemoteError { message: format!("the check did not finish: {e}") })?
}

/// `hello` through the door, with the Mac's half added. No store guard is held across the call (ADR 0005).
fn hello_now(app: &AppHandle, target: &str, label: &str) -> Hello {
    let data_dir = app.state::<ReaderControl>().data_dir().to_path_buf();
    let root = crate::paths::projects_root_of(&app.state::<Store>());
    let reply = remote::call(target, &data_dir, &Request::Hello);
    let version = app.package_info().version.to_string();
    let here = Here { herdr: crate::crew::tools::herdr_version_here(), root: Some(&root), version: &version };
    hello_of(label, reply, here, now_ms())
}

/// One setup item on the VPS, the captain's click (slice 4.3); then the checks again. `folder` names a client folder to
/// clone — its repository is read here from the Mac's own folder, never taken from the webview. `adopt` is the captain's
/// "Run Herdr under systemd", which stops the server already running there.
#[tauri::command]
pub async fn remote_install(app: AppHandle, item: InstallItem, folder: Option<String>, adopt: Option<bool>, restart: Option<bool>) -> Result<Hello, RemoteError> {
    tauri::async_runtime::spawn_blocking(move || {
        let chosen = {
            let store = app.state::<Store>();
            let conn = store.conn();
            place(&conn, store.org_id())
        };
        let Place::Vps { target, label } = chosen else {
            return Err(RemoteError { message: "Agents run on this Mac.".into() });
        };
        let request = install_request(&app, item, folder, adopt, restart)?;
        let data_dir = app.state::<ReaderControl>().data_dir().to_path_buf();
        log::info!("setup: install {} on {label}", serde_json::to_value(item).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default());
        match remote::call(&target, &data_dir, &request) {
            Ok(reply) => match install_answer(&reply) {
                Ok(()) => Ok(hello_now(&app, &target, &label)),
                Err(code) => Err(RemoteError { message: setup::cannot_words(&code, &label) }),
            },
            Err(why) => Err(RemoteError { message: why.words(&label) }),
        }
    })
    .await
    .map_err(|e| RemoteError { message: format!("the install did not finish: {e}") })?
}

fn install_request(app: &AppHandle, item: InstallItem, folder: Option<String>, adopt: Option<bool>, restart: Option<bool>) -> Result<Request, RemoteError> {
    match item {
        InstallItem::Clone => {
            let folder = folder.ok_or_else(|| RemoteError { message: "Which folder?".into() })?;
            let root = crate::paths::projects_root_of(&app.state::<Store>());
            let repo = setup::repo_for(&root, &folder).ok_or_else(|| RemoteError { message: format!("{folder} has no GitHub origin on this Mac") })?;
            Ok(Request::Install { item, folder: Some(folder), repo: Some(repo), adopt: None, restart: None })
        }
        InstallItem::HerdrService => Ok(Request::Install { item, folder: None, repo: None, adopt: adopt.filter(|a| *a), restart: None }),
        // ADR 0027: the restart that closes every pane there is only ever the captain's second click.
        InstallItem::WorkerSandbox => Ok(Request::Install { item, folder: None, repo: None, adopt: None, restart: restart.filter(|r| *r) }),
        _ => Ok(Request::Install { item, folder: None, repo: None, adopt: None, restart: None }),
    }
}

/// `{ done: true }`, or the companion's `cannot` code; anything else reads as a reply that could not be read.
fn install_answer(reply: &serde_json::Value) -> Result<(), String> {
    if reply.get("done") == Some(&serde_json::Value::Bool(true)) {
        return Ok(());
    }
    Err(reply.get("cannot").and_then(|c| c.as_str()).filter(|c| c.len() <= 40).unwrap_or("bad-reply").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// DESIGN.md 1.14, build spec §4 and Journey C: the four states of the status bar's VPS part.
    #[test]
    fn the_machine_reads_in_four_states() {
        let now = 1_000_000;
        let ok = Reach { last_attempt_at: now - 5_000, last_success_at: Some(now - 5_000), reason: None, heartbeat_at: Some(now - 10_000) };
        assert_eq!(status_of("vps-1", Some(&ok), None, now).state, MachineState::Connected);
        let stopped = Reach { heartbeat_at: Some(now - 61_000), ..ok.clone() };
        assert_eq!(status_of("vps-1", Some(&stopped), None, now).state, MachineState::NotRunning);
        assert_eq!(status_of("vps-1", Some(&Reach { heartbeat_at: None, ..ok.clone() }), None, now).state, MachineState::NotRunning);
        let ahead = Reach { heartbeat_at: Some(now + 90_000), ..ok.clone() };
        assert_eq!(status_of("vps-1", Some(&ahead), None, now).state, MachineState::Connected, "a stamp from the future is not a stopped loop");

        let failing = Reach { last_attempt_at: now - 1_000, last_success_at: Some(now - 20_000), reason: Some("timeout".into()), heartbeat_at: Some(now - 20_000) };
        let blip = status_of("vps-1", Some(&failing), Some(now - 15_000), now);
        assert_eq!((blip.state, blip.since), (MachineState::Reconnecting, Some(now - 15_000)));
        assert_eq!(blip.problem.as_deref(), Some("can't reach vps-1: timed out"));
        let down = status_of("vps-1", Some(&failing), Some(now - 30_000), now);
        assert_eq!((down.state, down.since, down.last_success_at), (MachineState::Unreachable, Some(now - 30_000), Some(now - 20_000)));
        let never = Reach { last_success_at: None, ..failing.clone() };
        assert_eq!(status_of("vps-1", Some(&never), None, now).state, MachineState::Unreachable, "never reached is not a blip");
        let restarted = status_of("vps-1", Some(&failing), None, now);
        assert_eq!(restarted.since, Some(now - 1_000), "after a restart the last attempt stands in");
        assert_eq!(status_of("vps-1", None, None, now).state, MachineState::Reconnecting, "nothing tried yet");
        let unknown = Reach { reason: Some("new-code".into()), ..failing };
        assert_eq!(status_of("vps-1", Some(&unknown), None, now).problem, None, "an unknown code is not put into words");
    }

    #[test]
    fn hello_reads_the_versions_or_says_why_in_fixed_words() {
        let herdr = || Some("0.9.0".to_string());
        let here = || Here { herdr: herdr(), root: None, version: "0.1.0" };
        let ok = hello_of("vps-1", Ok(serde_json::json!({"v": 1, "companion": {"version": "0.1.0"}, "herdr": {"version": "0.9.5"}})), here(), 5);
        assert_eq!(
            ok,
            Hello {
                reachable: true,
                problem: None,
                companion_version: Some("0.1.0".into()),
                herdr_there: Some("0.9.5".into()),
                herdr_here: herdr(),
                checked_at: 5,
                companion_missing: false,
                checks: Vec::new(),
                clones: Vec::new(),
                bootstrap: setup::bootstrap("0.1.0"),
            }
        );
        let none = || Here { herdr: None, root: None, version: "0.1.0" };
        let no_herdr = hello_of("vps-1", Ok(serde_json::json!({"v": 1, "companion": {"version": "0.1.0"}, "herdr": null})), none(), 5);
        assert_eq!((no_herdr.reachable, no_herdr.herdr_there, no_herdr.herdr_here), (true, None, None));
        let down = hello_of("vps-1", Err(remote::Unreachable::CompanionMissing), here(), 5);
        assert_eq!(down.problem.as_deref(), Some("can't reach vps-1: Kinas is not installed there"));
        assert!(down.companion_missing, "the bootstrap shows only when ssh ran and kinas did not");
        assert_eq!(down.herdr_here, herdr(), "the Mac's own version shows even when the VPS cannot be reached");
        assert!(!hello_of("vps-1", Err(remote::Unreachable::TimedOut), here(), 5).companion_missing);
        let odd = hello_of("vps-1", Ok(serde_json::json!({"v": 1})), here(), 5);
        assert_eq!(odd.problem.as_deref(), Some("can't reach vps-1: the answer could not be read"));
        let sly = hello_of("vps-1", Ok(serde_json::json!({"v": 1, "companion": {"version": "0.1.0"}, "herdr": {"version": "<b>9</b> /etc/passwd"}})), none(), 5);
        assert_eq!(sly.herdr_there.as_deref(), Some("b9betcpasswd"), "only digits, letters, dots and dashes reach the screen");
    }

    #[test]
    fn a_pairing_reply_is_a_code_of_crockfords_alphabet_and_a_link_that_carries_it() {
        let ok = pair_of(&serde_json::json!({"v": 1, "code": "AB3K9XZQ", "url": "https://kinas-phone.example.app/#pair=AB3K9XZQ", "expires_at": 605000}));
        assert_eq!(ok, Ok(PairStart { code: "AB3K9XZQ".into(), url: Some("https://kinas-phone.example.app/#pair=AB3K9XZQ".into()), expires_at: 605000 }));
        let no_page = pair_of(&serde_json::json!({"v": 1, "code": "AB3K9XZQ", "url": null, "expires_at": 1})).unwrap();
        assert_eq!(no_page.url, None);
        for bad in ["ab3k9xzq", "AB3K9XZ", "AB3K9XZQQ", "AB3I9XZQ", "AB3O9XZQ", "AB3L9XZQ", "AB3U9XZQ", "AB3K 9XZ", "<b>3K9XZQ"] {
            assert!(pair_of(&serde_json::json!({"v": 1, "code": bad, "url": null, "expires_at": 1})).is_err(), "{bad}");
        }
        let wrong_link = pair_of(&serde_json::json!({"v": 1, "code": "AB3K9XZQ", "url": "https://evil.example/#pair=ZZZZZZZZ", "expires_at": 1})).unwrap();
        assert_eq!(wrong_link.url, None, "a link that doesn't carry this code is dropped");
        let http = pair_of(&serde_json::json!({"v": 1, "code": "AB3K9XZQ", "url": "http://kinas-phone.example.app/#pair=AB3K9XZQ", "expires_at": 1})).unwrap();
        assert_eq!(http.url, None);
        assert_eq!(pair_of(&serde_json::json!({"v": 1, "error": "no-cloud"})), Err("The cloud store isn't set up on the Linux machine.".into()));
        assert_eq!(pair_of(&serde_json::json!({"v": 1, "error": "cloud-failed"})), Err("The cloud store didn't answer. Try again.".into()));
        assert_eq!(pair_of(&serde_json::json!({"v": 1})), Err("the answer could not be read".into()));
        assert_eq!(pair_of(&serde_json::json!({"v": 1, "error": "something <new>"})), Err("the answer could not be read".into()), "an unknown error is never put into words");
    }

    #[test]
    fn a_test_notification_is_sent_or_says_why() {
        assert_eq!(test_sent(&serde_json::json!({"v": 1, "sent": true})), Ok(()));
        assert_eq!(test_sent(&serde_json::json!({"v": 1, "error": "no-cloud"})), Err("The cloud store isn't set up on the Linux machine.".into()));
        assert_eq!(test_sent(&serde_json::json!({"v": 1, "error": "cloud-failed"})), Err("The cloud store didn't answer. Try again.".into()));
        assert_eq!(test_sent(&serde_json::json!({"v": 1, "sent": false})), Err("the answer could not be read".into()));
        assert_eq!(test_sent(&serde_json::json!({"v": 1})), Err("the answer could not be read".into()));
    }

    #[test]
    fn the_phones_list_keeps_names_plain_and_drops_a_row_it_cannot_read() {
        let reply = serde_json::json!({"v": 1, "phones": [
            {"id": "k5788xyz", "name": "Miguel's iPhone", "paired_at": 1, "last_seen_at": 2, "push": true},
            {"id": "k57<>", "name": "bad id", "paired_at": 1, "last_seen_at": 2, "push": true},
            {"id": "k5788abc", "name": "<b>x</b>\u{7}", "paired_at": 3, "last_seen_at": 4, "push": false},
            {"id": "k5788def", "name": "no times"}
        ]});
        let phones = phones_of(&reply).unwrap();
        assert_eq!(phones.iter().map(|p| (p.id.as_str(), p.name.as_str())).collect::<Vec<_>>(), vec![("k5788xyz", "Miguel's iPhone"), ("k5788abc", "bx/b")]);
        assert_eq!(phones_of(&serde_json::json!({"v": 1, "error": "no-cloud"})), Err("The cloud store isn't set up on the Linux machine.".into()));
        assert!(phones_of(&serde_json::json!({"v": 1})).is_err());
    }

    #[test]
    fn hello_carries_the_rows_and_the_install_answer_reads_done_or_its_code() {
        let reply = serde_json::json!({"v": 1, "companion": {"version": "0.1.0"}, "herdr": null,
            "checks": [{"id": "herdr", "state": "bad", "detail": "not installed", "install": "herdr"}], "folders": []});
        let hello = hello_of("vps-1", Ok(reply), Here { herdr: None, root: None, version: "0.1.0" }, 5);
        assert_eq!(hello.checks.len(), 1);
        assert_eq!(hello.checks[0].install, Some(InstallItem::Herdr));
        assert_eq!(install_answer(&serde_json::json!({"v": 1, "done": true})), Ok(()));
        assert_eq!(install_answer(&serde_json::json!({"v": 1, "cannot": "foreign"})), Err("foreign".into()));
        assert_eq!(install_answer(&serde_json::json!({"v": 1})), Err("bad-reply".into()));
        assert_eq!(install_answer(&serde_json::json!({"v": 1, "cannot": "x".repeat(80)})), Err("bad-reply".into()));
    }
}
