//! The companion's reading as the Mac receives it (build spec §11.2 `Bundle`; ADR 0024): the outputs of Firstmate's
//! scripts on the VPS, verbatim, plus what only the VPS knows. Each part goes to the parser the local cycle already uses
//! — nothing here interprets the crew. Fields join as their slices land; one the Mac does not know yet is ignored, and a
//! bundle of another version is refused with one line.

use super::ledger;
use crate::proc::{Exit, Ran};
use crate::remote::Unreachable;
use rusqlite::{params, Connection};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Component, Path};

pub(crate) const BUNDLE_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
pub(crate) struct Bundle {
    pub companion: CompanionInfo,
    /// Whether Firstmate's home is there at all.
    pub installed: bool,
    /// `fm-fleet-snapshot.sh --json`, as it answered.
    pub snapshot: Option<ScriptOut>,
    /// The VPS's clock when the companion answered: the heartbeat's age is read on that clock, never against this Mac's.
    #[serde(default)]
    pub served_at: Option<i64>,
    /// Firstmate's home on the VPS, as the fleet's paths name it (slice 2): where a task's clone path is checked.
    #[serde(default)]
    pub home: Option<String>,
    /// `fm-capacity.sh --json`, only behind the lane gate on the VPS; `capacity_at` says when it ran there.
    #[serde(default)]
    pub capacity: Option<ScriptOut>,
    #[serde(default)]
    pub capacity_at: Option<i64>,
    /// Each clone under `<home>/projects/` and its `[remote "origin"]` url as the companion read the file.
    #[serde(default)]
    pub origins: BTreeMap<String, Option<String>>,
    /// `herdr api snapshot` and the focused pane's `pane process-info`, verbatim.
    #[serde(default)]
    pub herdr_view: Option<String>,
    #[serde(default)]
    pub herdr_foreground: Option<String>,
    /// The latest `gh pr view` of each PR still due on the VPS, verbatim, with when it was asked.
    #[serde(default)]
    pub prs: Vec<PrOut>,
    /// The fleet ledger's complete lines since the Mac's cursor; None while there is no ledger file.
    #[serde(default)]
    pub ledger: Option<LedgerChunk>,
    /// Each task branch's `git log --name-only` (the review flag, `touches.rs`), verbatim, with when it was read there.
    #[serde(default)]
    pub branches: Vec<BranchOut>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PrOut {
    pub url: String,
    pub checked_at: i64,
    pub out: ScriptOut,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BranchOut {
    pub task: String,
    pub checked_at: i64,
    pub out: ScriptOut,
}

/// A piece of `state/fleet-ledger.jsonl` on the VPS: bytes `from..to` of the file `dev`/`ino`, complete lines only.
#[derive(Debug, Deserialize)]
pub(crate) struct LedgerChunk {
    pub dev: u64,
    pub ino: u64,
    pub from: u64,
    pub to: u64,
    pub text: String,
}

/// The heartbeat on this Mac's clock: as old here, when the bundle was taken, as it was on the VPS when it was served.
pub(crate) fn heartbeat_here(info: &CompanionInfo, served_at: Option<i64>, now: i64) -> CompanionInfo {
    let heartbeat_at = served_at.map_or(info.heartbeat_at, |served| now - (served - info.heartbeat_at).max(0));
    CompanionInfo { heartbeat_at, ..info.clone() }
}

/// The Mac's ledger cursor as the companion's: the file's identity and the byte after the last line taken.
pub(crate) fn cursor_for(c: ledger::Cursor) -> crate::remote::Cursor {
    crate::remote::Cursor { epoch: format!("{}:{}", c.dev, c.ino), offset: c.offset, events: 0 }
}

/// A chunk as the local reader's `LedgerRead`: the same `parse_lines`, and the cursor past what it consumed — `to` when
/// it took every line (`to` also skips a line longer than the companion's cap), else `from` plus what it took.
pub(crate) fn ledger_of(chunk: &LedgerChunk) -> ledger::LedgerRead {
    let (events, consumed, error) = ledger::parse_lines(chunk.text.as_bytes());
    let offset = if consumed == chunk.text.len() { chunk.to } else { chunk.from + consumed as u64 };
    ledger::LedgerRead { events, cursor: ledger::Cursor { dev: chunk.dev, ino: chunk.ino, offset }, error }
}

/// A task clone's repository on the VPS, checked as `repo::clone_repo` checks one here — an absolute path under
/// `<home>/projects/`, no `..` — then the origin the companion read, normalised as this Mac's would be.
pub(crate) fn clone_repo_there(home: &Path, project: &str, origins: &BTreeMap<String, Option<String>>) -> Option<String> {
    let path = Path::new(project);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return None;
    }
    if path.strip_prefix(home.join("projects")).ok()?.as_os_str().is_empty() {
        return None;
    }
    let url = origins.get(project.trim_end_matches('/'))?.as_deref()?;
    crate::crew::repo::normalise(url)
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CompanionInfo {
    pub version: String,
    pub heartbeat_at: i64,
}

/// One script's answer, as it ran on the VPS. `stderr_first` is never logged (it can name a task).
#[derive(Debug, Deserialize)]
pub(crate) struct ScriptOut {
    pub exit: Option<i32>,
    #[serde(default)]
    pub timed_out: bool,
    pub stdout: String,
    pub stderr_first: Option<String>,
}

impl ScriptOut {
    /// The answer as the local runner would have handed it to the same parser.
    pub fn ran(&self) -> Ran {
        let exit = match (self.timed_out, self.exit) {
            (true, _) => Exit::TimedOut,
            (false, Some(code)) => Exit::Code(code),
            (false, None) => Exit::Signal,
        };
        Ran { exit, stdout: self.stdout.clone(), first_err: self.stderr_first.clone(), last_err: self.stderr_first.clone() }
    }
}

pub(crate) fn decode(value: serde_json::Value) -> Result<Bundle, String> {
    match value.get("v").and_then(serde_json::Value::as_u64) {
        Some(v) if v == u64::from(BUNDLE_VERSION) => {}
        Some(v) => return Err(format!("the VPS answered with reading version {v}; this Kinas reads version {BUNDLE_VERSION}")),
        None => return Err("the VPS's answer is not a reading".into()),
    }
    serde_json::from_value(value).map_err(|_| "the VPS's reading could not be read".into())
}

/// The VPS as the door last reached it (0008's `vps_reachability`): one row, replaced on every attempt; the last success
/// and the companion's version are kept across a failure.
pub(crate) fn remember(conn: &Connection, org: &str, label: &str, now: i64, outcome: Result<&CompanionInfo, Unreachable>) -> rusqlite::Result<()> {
    match outcome {
        Ok(info) => conn.execute(
            "INSERT INTO vps_reachability (org_id, label, last_attempt_at, last_success_at, reason, companion_version, companion_heartbeat_at)
             VALUES (?1, ?2, ?3, ?3, NULL, ?4, ?5)
             ON CONFLICT (org_id) DO UPDATE SET label = excluded.label, last_attempt_at = excluded.last_attempt_at,
               last_success_at = excluded.last_success_at, reason = NULL, companion_version = excluded.companion_version,
               companion_heartbeat_at = excluded.companion_heartbeat_at",
            params![org, label, now, info.version, info.heartbeat_at],
        )?,
        Err(why) => conn.execute(
            "INSERT INTO vps_reachability (org_id, label, last_attempt_at, reason) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (org_id) DO UPDATE SET label = excluded.label, last_attempt_at = excluded.last_attempt_at, reason = excluded.reason",
            params![org, label, now, why.code()],
        )?,
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../../../fixtures/companion-bundle.synthetic.json")).unwrap()
    }

    #[test]
    fn decodes_the_fixture_into_what_the_local_parser_reads() {
        let b = decode(fixture()).unwrap();
        assert!(b.installed);
        let ran = b.snapshot.as_ref().unwrap().ran();
        assert_eq!(ran.exit, Exit::Code(0));
        let local = include_str!("../../../../../fixtures/firstmate-fleet-snapshot.current.synthetic.json");
        assert_eq!(ran.stdout, local, "the snapshot arrives verbatim");
        let from_bundle = super::super::snapshot::parse_fleet(&ran.stdout).unwrap();
        let from_file = super::super::snapshot::parse_fleet(local).unwrap();
        assert_eq!(from_bundle.tasks.len(), from_file.tasks.len());
        assert_eq!(from_bundle.generated, from_file.generated);
    }

    #[test]
    fn another_version_or_shape_is_refused_with_one_line() {
        let mut v2 = fixture();
        v2["v"] = serde_json::json!(2);
        assert_eq!(decode(v2).unwrap_err(), "the VPS answered with reading version 2; this Kinas reads version 1");
        assert_eq!(decode(serde_json::json!({"error": "no-reading"})).unwrap_err(), "the VPS's answer is not a reading");
        assert_eq!(decode(serde_json::json!({"v": 1})).unwrap_err(), "the VPS's reading could not be read");
    }

    #[test]
    fn a_timed_out_or_signalled_script_reads_as_it_would_locally() {
        let out = |exit, timed_out| ScriptOut { exit, timed_out, stdout: String::new(), stderr_first: None }.ran().exit;
        assert_eq!(out(None, true), Exit::TimedOut);
        assert_eq!(out(None, false), Exit::Signal);
        assert_eq!(out(Some(3), false), Exit::Code(3));
    }

    #[test]
    fn reachability_keeps_the_last_success_across_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(dir.path()).unwrap();
        let conn = store.conn();
        let org = store.org_id();
        let info = CompanionInfo { version: "0.1.0".into(), heartbeat_at: 90 };
        remember(&conn, org, "vps-1", 100, Ok(&info)).unwrap();
        remember(&conn, org, "vps-1", 200, Err(Unreachable::TimedOut)).unwrap();
        let row: (i64, Option<i64>, Option<String>, Option<String>) = conn
            .query_row("SELECT last_attempt_at, last_success_at, reason, companion_version FROM vps_reachability", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap();
        assert_eq!(row, (200, Some(100), Some("timeout".into()), Some("0.1.0".into())));
    }
}
