//! Claude plan limits from the status-line hand-off file (PRD R15–R17).
//!
//! Miguel's own `~/.claude/statusline-command.sh` writes `rate_limits`, `session_id` and `captured_at`
//! into the inbox. This module only reads that file and the session's transcript. It never touches
//! Claude Code's login, never contacts Anthropic and never writes under `~/.claude` (R17): Anthropic's
//! credential rules forbid collecting Claude.ai session tokens, and the account at risk is the one all
//! client work runs on.

use crate::redact::{record_attempt, write_reader_status, Outcome, Reader};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub const INBOX_FILE: &str = "inbox/claude-rate-limits.json";
pub const SOURCE: &str = "Claude Code status line";
/// "receiving" while the hook has written within this long (R17).
const RECEIVING_MS: i64 = 30 * 60 * 1000;
/// How much of a transcript's end is read to find its last assistant line.
const TAIL_BYTES: u64 = 512 * 1024;

pub fn handoff_path(data_dir: &Path) -> PathBuf {
    data_dir.join(INBOX_FILE)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Window {
    pub window: &'static str,
    pub used_pct: f64,
    pub resets_at: i64,
}

#[derive(Debug, PartialEq)]
pub enum HandOff {
    /// `rate_limits` null or absent: a session writes that before its first API response. Not an error.
    NoRateLimits,
    Windows { session_id: Option<String>, captured_at: Option<i64>, windows: Vec<Window> },
}

/// Parses the hand-off file. Unknown shapes and out-of-range values are errors that name key names only,
/// never values that could carry anything sensitive (R15, R16, R14).
pub fn parse_handoff(text: &str) -> Result<HandOff, String> {
    let j: Value = serde_json::from_str(text).map_err(|_| "unreadable hand-off file".to_string())?;
    if !j.is_object() {
        return Err("unreadable hand-off file".into());
    }
    let limits = &j["rate_limits"];
    if limits.is_null() {
        return Ok(HandOff::NoRateLimits);
    }
    let Some(object) = limits.as_object() else {
        return Err("unrecognized hand-off shape: rate_limits is not an object".into());
    };
    let unrecognized = || format!("unrecognized hand-off shape: {}", object.keys().cloned().collect::<Vec<_>>().join(", "));

    let mut windows = Vec::new();
    for (key, window) in [("five_hour", "session"), ("seven_day", "week")] {
        let w = &limits[key];
        if w.is_null() {
            // Claude Code drops a window once its resets_at passes; the stored row stays (R16).
            continue;
        }
        let (Some(used), Some(resets)) = (w["used_percentage"].as_f64(), w["resets_at"].as_f64()) else {
            return Err(unrecognized());
        };
        if !(0.0..=100.0).contains(&used) {
            return Err(format!("out of range: {used}"));
        }
        windows.push(Window { window, used_pct: used, resets_at: (resets * 1000.0) as i64 });
    }
    Ok(HandOff::Windows {
        session_id: j["session_id"].as_str().map(str::to_string),
        captured_at: j["captured_at"].as_i64(),
        windows,
    })
}

fn is_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// When the reading was true: the session transcript's last assistant line, never later than
/// `captured_at`. Rate limits only change on an API response, and the status line also re-runs without
/// one (a prompt cache expiring up to an hour later), so `captured_at` alone would call old numbers fresh.
pub fn data_time(projects_root: &Path, session_id: Option<&str>, captured_at: i64) -> i64 {
    session_id
        .filter(|id| is_session_id(id))
        .and_then(|id| last_assistant_time(projects_root, id))
        .map_or(captured_at, |t| t.min(captured_at))
}

fn last_assistant_time(projects_root: &Path, session_id: &str) -> Option<i64> {
    let file_name = format!("{session_id}.jsonl");
    let transcript = std::fs::read_dir(projects_root)
        .ok()?
        .flatten()
        .map(|entry| entry.path().join(&file_name))
        .find(|p| p.is_file())?;
    let mut file = std::fs::File::open(&transcript).ok()?;
    let len = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(TAIL_BYTES))).ok()?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail).ok()?;
    String::from_utf8_lossy(&tail).lines().rev().find_map(|line| {
        let j: Value = serde_json::from_str(line).ok()?;
        if j["type"] != "assistant" {
            return None;
        }
        let ts: jiff::Timestamp = j["timestamp"].as_str()?.parse().ok()?;
        Some(ts.as_millisecond())
    })
}

/// Upserts each window unless the stored reading is newer ("older loses", R16). Returns how many changed. A stored
/// reading stamped after `now` is from before the wall clock stepped back: it is newer than nothing, and the next
/// reading replaces it, as R12 promises when it reads such a row stale.
pub fn apply(conn: &mut Connection, org_id: &str, windows: &[Window], data_time: i64, now: i64) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut applied = 0;
    for w in windows {
        let stored: Option<i64> = tx
            .query_row(
                "SELECT updated_at FROM quotas WHERE org_id = ?1 AND subscription = 'claude-plan' AND \"window\" = ?2",
                params![org_id, w.window],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if stored.is_some_and(|updated| data_time < updated && updated <= now) {
            continue;
        }
        tx.execute(
            "INSERT INTO quotas (org_id, subscription, \"window\", used_pct, resets_at, plan, source, updated_at)
             VALUES (?1, 'claude-plan', ?2, ?3, ?4, NULL, ?5, ?6)
             ON CONFLICT (org_id, subscription, \"window\") DO UPDATE SET
               used_pct = excluded.used_pct, resets_at = excluded.resets_at, source = excluded.source, updated_at = excluded.updated_at",
            params![org_id, w.window, w.used_pct, w.resets_at, SOURCE, data_time],
        )
        .map_err(|e| e.to_string())?;
        applied += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(applied)
}

#[derive(Debug, PartialEq)]
pub enum IngestResult {
    NotConfigured,
    NoRateLimits,
    Applied(usize),
    Failed(String),
}

/// One pass over the hand-off file (PRD §3.2). Every outcome is recorded in `reader_status`.
pub fn ingest(conn: &mut Connection, org_id: &str, data_dir: &Path, projects_root: &Path, now: i64) -> IngestResult {
    let path = handoff_path(data_dir);
    let status = |conn: &Connection, outcome: Outcome<'_>| {
        if let Err(e) = write_reader_status(conn, org_id, Reader::ClaudePlan, outcome, now) {
            log::error!("claude-plan: could not record status: {e}");
        }
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            status(conn, Outcome::NotConfigured("never seen — add the Claude Code hook in Settings"));
            return IngestResult::NotConfigured;
        }
        Err(e) => {
            let message = format!("could not read the hand-off file: {e}");
            status(conn, Outcome::Error(&message));
            return IngestResult::Failed(message);
        }
    };
    let file_time = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(now, |d| d.as_millis() as i64);

    match parse_handoff(&text) {
        Err(message) => {
            status(conn, Outcome::Error(&message));
            IngestResult::Failed(message)
        }
        Ok(HandOff::NoRateLimits) => {
            let _ = record_attempt(conn, org_id, Reader::ClaudePlan, now);
            IngestResult::NoRateLimits
        }
        Ok(HandOff::Windows { session_id, captured_at, windows }) => {
            let when = data_time(projects_root, session_id.as_deref(), captured_at.unwrap_or(file_time));
            match apply(conn, org_id, &windows, when, now) {
                Ok(applied) => {
                    if applied > 0 {
                        status(conn, Outcome::Success);
                    } else {
                        let _ = record_attempt(conn, org_id, Reader::ClaudePlan, now);
                    }
                    IngestResult::Applied(applied)
                }
                Err(message) => {
                    status(conn, Outcome::Error(&message));
                    IngestResult::Failed(message)
                }
            }
        }
    }
}

#[derive(Debug, Serialize, PartialEq)]
pub struct HookStatus {
    /// "receiving", "last_seen" or "never_seen" (R17).
    pub state: &'static str,
    pub captured_at: Option<i64>,
    pub minutes_ago: Option<i64>,
}

/// R17's hook line, with `now` read from `clock` once the hand-off file is read. The status line writes that file from
/// another process, with no guard shared: with `now` read first, a capture stamped and moved into place in between read
/// as one from the future — a clock step back, the one thing a capture after now may mean — and **receiving** turned
/// into last seen 0 minutes ago.
pub fn hook_status(data_dir: &Path, clock: impl FnOnce() -> i64) -> HookStatus {
    let path = handoff_path(data_dir);
    let captured = std::fs::read_to_string(&path).ok().map(|text| {
        serde_json::from_str::<Value>(&text).ok().and_then(|j| j["captured_at"].as_i64()).or_else(|| {
            std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
        })
    });
    let now = clock();
    match captured.flatten() {
        Some(at) => HookStatus {
            // A gap, not a moment to reach: a capture stamped in what is now the future (a clock step back) is not recent.
            state: if (0..=RECEIVING_MS).contains(&(now - at)) { "receiving" } else { "last_seen" },
            captured_at: Some(at),
            minutes_ago: Some((now - at).max(0) / 60_000),
        },
        None => HookStatus { state: "never_seen", captured_at: None, minutes_ago: None },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/handoff").join(name)).unwrap()
    }

    const SESSION: &str = "11111111-1111-1111-1111-111111111111";

    fn quota(store: &Store, window: &str) -> Option<(f64, i64, i64)> {
        store
            .conn()
            .query_row(
                "SELECT used_pct, resets_at, updated_at FROM quotas WHERE subscription = 'claude-plan' AND \"window\" = ?1",
                params![window],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .unwrap()
    }

    #[test]
    fn parses_the_documented_shape() {
        let HandOff::Windows { session_id, captured_at, windows } = parse_handoff(&fixture("basic.json")).unwrap() else { panic!() };
        assert_eq!(session_id.as_deref(), Some(SESSION));
        assert_eq!(captured_at, Some(1789390320000));
        assert_eq!(
            windows,
            vec![
                Window { window: "session", used_pct: 42.0, resets_at: 1_893_456_000_000 },
                Window { window: "week", used_pct: 23.5, resets_at: 1_893_888_000_000 },
            ]
        );
    }

    #[test]
    fn null_rate_limits_is_not_an_error() {
        assert_eq!(parse_handoff(&fixture("null-rate-limits.json")).unwrap(), HandOff::NoRateLimits);
    }

    #[test]
    fn out_of_range_and_unknown_shapes_are_errors_without_values() {
        assert_eq!(parse_handoff(&fixture("out-of-range.json")).unwrap_err(), "out of range: 137");
        let err = parse_handoff(&fixture("unrecognized.json")).unwrap_err();
        assert_eq!(err, "unrecognized hand-off shape: five_hour, weekly");
        assert!(!err.contains("42"));
        assert_eq!(parse_handoff("not json").unwrap_err(), "unreadable hand-off file");
    }

    #[test]
    fn a_missing_window_is_simply_absent() {
        let HandOff::Windows { windows, .. } = parse_handoff(&fixture("no-five-hour.json")).unwrap() else { panic!() };
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].window, "week");
    }

    #[test]
    fn data_time_is_the_last_response_not_the_capture() {
        let projects = tempfile::tempdir().unwrap();
        let dir = projects.path().join("-Users-x");
        std::fs::create_dir_all(&dir).unwrap();
        // captured_at is 12:52Z; the last assistant line is 58 minutes earlier, at 11:54Z.
        std::fs::write(
            dir.join(format!("{SESSION}.jsonl")),
            concat!(
                r#"{"type":"assistant","timestamp":"2026-09-14T11:54:00.000Z","message":{"id":"m1"}}"#, "\n",
                r#"{"type":"user","timestamp":"2026-09-14T12:40:00.000Z"}"#, "\n",
            ),
        )
        .unwrap();
        let captured = 1_789_390_320_000; // 2026-09-14T12:52:00Z
        assert_eq!(data_time(projects.path(), Some(SESSION), captured), captured - 58 * 60 * 1000);
        assert_eq!(data_time(projects.path(), Some("22222222-2222-2222-2222-222222222222"), captured), captured);
        assert_eq!(data_time(projects.path(), Some("../../etc/passwd"), captured), captured);
    }

    #[test]
    fn an_older_reading_arriving_later_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let newer = [Window { window: "session", used_pct: 50.0, resets_at: 10 }];
        let older = [Window { window: "session", used_pct: 20.0, resets_at: 10 }];
        assert_eq!(apply(&mut store.conn(), store.org_id(), &newer, 2_000, 2_500).unwrap(), 1);
        assert_eq!(apply(&mut store.conn(), store.org_id(), &older, 1_000, 3_000).unwrap(), 0);
        assert_eq!(quota(&store, "session"), Some((50.0, 10, 2_000)));
    }

    /// R16's "older loses" stops a hand-off that arrived out of order from replacing a newer one. A stored reading
    /// stamped after now is from before the wall clock stepped back (R12 reads it stale, "the next reading puts it
    /// right"): it is no newer than anything, or every reading after the step lost to it — the session gauge and the
    /// menu bar held the old numbers, stale, for the length of the step.
    #[test]
    fn a_reading_stamped_before_a_clock_step_back_does_not_outlive_it() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let t0 = 1_789_390_320_000;
        let before_step = [Window { window: "session", used_pct: 42.0, resets_at: 10 }];
        assert_eq!(apply(&mut store.conn(), store.org_id(), &before_step, t0 + 2 * 3_600_000, t0 + 2 * 3_600_000).unwrap(), 1);
        // The clock steps back two hours; Claude Code answers five minutes later.
        let after_step = [Window { window: "session", used_pct: 80.0, resets_at: 10 }];
        assert_eq!(apply(&mut store.conn(), store.org_id(), &after_step, t0 + 300_000, t0 + 300_001).unwrap(), 1);
        assert_eq!(quota(&store, "session"), Some((80.0, 10, t0 + 300_000)));
    }

    #[test]
    fn ingest_covers_missing_null_valid_invalid_and_dropped_windows() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let projects = tempfile::tempdir().unwrap();
        let inbox = handoff_path(dir.path());
        let state = |store: &Store| -> (String, Option<String>) {
            store.conn().query_row("SELECT state, last_error FROM reader_status WHERE reader = 'claude-plan'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
        };

        assert_eq!(ingest(&mut store.conn(), store.org_id(), dir.path(), projects.path(), 1), IngestResult::NotConfigured);
        assert_eq!(state(&store).0, "not_configured");

        std::fs::create_dir_all(inbox.parent().unwrap()).unwrap();
        std::fs::write(&inbox, fixture("null-rate-limits.json")).unwrap();
        assert_eq!(ingest(&mut store.conn(), store.org_id(), dir.path(), projects.path(), 2), IngestResult::NoRateLimits);
        assert_eq!(quota(&store, "session"), None);

        std::fs::write(&inbox, fixture("basic.json")).unwrap();
        assert_eq!(ingest(&mut store.conn(), store.org_id(), dir.path(), projects.path(), 3), IngestResult::Applied(2));
        assert_eq!(state(&store), ("ok".into(), None));
        assert_eq!(quota(&store, "session"), Some((42.0, 1_893_456_000_000, 1_789_390_320_000)));

        std::fs::write(&inbox, fixture("out-of-range.json")).unwrap();
        assert!(matches!(ingest(&mut store.conn(), store.org_id(), dir.path(), projects.path(), 4), IngestResult::Failed(_)));
        assert_eq!(state(&store), ("error".into(), Some("out of range: 137".into())));
        assert_eq!(quota(&store, "session").unwrap().0, 42.0, "previous value kept");

        std::fs::write(&inbox, fixture("no-five-hour.json")).unwrap();
        assert_eq!(ingest(&mut store.conn(), store.org_id(), dir.path(), projects.path(), 5), IngestResult::Applied(1));
        assert!(quota(&store, "session").is_some(), "a dropped window is never deleted");
        assert_eq!(quota(&store, "week").unwrap().0, 24.0);
    }

    #[test]
    fn hook_status_follows_captured_at() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(hook_status(dir.path(), || 0).state, "never_seen");
        std::fs::create_dir_all(dir.path().join("inbox")).unwrap();
        std::fs::write(handoff_path(dir.path()), fixture("basic.json")).unwrap();
        let captured = 1_789_390_320_000;
        assert_eq!(hook_status(dir.path(), || captured + 29 * 60_000).state, "receiving");
        let later = hook_status(dir.path(), || captured + 31 * 60_000);
        assert_eq!((later.state, later.minutes_ago), ("last_seen", Some(31)));
    }

    /// The hook stamps `captured_at` from the wall clock, which can step back. A capture stamped in what is now the
    /// future is not a recent one: read as one, Settings said **receiving** for the length of the step plus 30 minutes
    /// after the hook had stopped writing.
    #[test]
    fn a_capture_stamped_in_the_future_is_not_receiving() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("inbox")).unwrap();
        std::fs::write(handoff_path(dir.path()), fixture("basic.json")).unwrap();
        let captured = 1_789_390_320_000;
        let before = hook_status(dir.path(), || captured - 2 * 60 * 60_000);
        assert_eq!((before.state, before.minutes_ago), ("last_seen", Some(0)));
        assert_eq!(hook_status(dir.path(), || captured).state, "receiving", "written just now");
    }

    #[test]
    fn this_reader_never_touches_claude_credentials_or_anthropic() {
        // R17 guard. The needles are assembled so this test does not match itself.
        let source = include_str!("claude_plan.rs");
        for needle in [["api", ".anthropic", ".com"].concat(), ["find-generic", "-password"].concat(), ["Claude Code", "-credentials"].concat()] {
            assert!(!source.contains(&needle), "claude_plan.rs must not contain {needle}");
        }
    }
}
