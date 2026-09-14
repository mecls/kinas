//! Interactive token usage from Claude Code and Pi transcripts into `usage_daily` (PRD R20–R26).
//!
//! `scripts/usage-recount.ts` implements the same rules independently; the two are compared by
//! `scripts/check-usage.ts` (AC-5).

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Harness {
    ClaudeCode,
    Pi,
}

impl Harness {
    pub fn id(self) -> &'static str {
        match self {
            Harness::ClaudeCode => "claude-code",
            Harness::Pi => "pi",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UsageEvent {
    pub key: String,
    pub date: String,
    pub provider: String,
    pub model: String,
    pub tokens_in: i64,
    pub tokens_cache_read: i64,
    pub tokens_out: i64,
}

#[derive(Debug, PartialEq)]
pub enum Parsed {
    Event(UsageEvent),
    /// A valid line that carries no countable usage.
    Skip,
    Malformed,
}

/// The Europe/Lisbon calendar date of an RFC 3339 timestamp (R23).
pub fn lisbon_date(timestamp: &str) -> Option<String> {
    let ts: jiff::Timestamp = timestamp.parse().ok()?;
    let zoned = ts.in_tz("Europe/Lisbon").ok()?;
    Some(zoned.date().strftime("%Y-%m-%d").to_string())
}

fn int(v: &Value) -> i64 {
    v.as_i64().unwrap_or(0)
}

/// A Claude Code transcript line (R20, R22). Counted when `type == "assistant"`, `message.usage`
/// exists and the model is not `<synthetic>`; keyed by `message.id` across all files (R21).
pub fn parse_claude_line(line: &str) -> Parsed {
    let Ok(j) = serde_json::from_str::<Value>(line) else { return Parsed::Malformed };
    if j["type"] != "assistant" {
        return Parsed::Skip;
    }
    let m = &j["message"];
    let usage = &m["usage"];
    let (Some(id), Some(ts), true) = (m["id"].as_str(), j["timestamp"].as_str(), usage.is_object()) else {
        return Parsed::Skip;
    };
    let model = m["model"].as_str().unwrap_or("unknown");
    if model == "<synthetic>" {
        return Parsed::Skip;
    }
    let Some(date) = lisbon_date(ts) else { return Parsed::Malformed };
    Parsed::Event(UsageEvent {
        key: id.to_string(),
        date,
        provider: "anthropic".into(),
        model: model.to_string(),
        tokens_in: int(&usage["input_tokens"]) + int(&usage["cache_creation_input_tokens"]),
        tokens_cache_read: int(&usage["cache_read_input_tokens"]),
        tokens_out: int(&usage["output_tokens"]),
    })
}

/// A Pi session line (R20, R22). Counted when `type == "message"` and `message.usage` exists; keyed by
/// `<session file name>:<entry id>`.
pub fn parse_pi_line(line: &str, file_name: &str) -> Parsed {
    let Ok(j) = serde_json::from_str::<Value>(line) else { return Parsed::Malformed };
    if j["type"] != "message" {
        return Parsed::Skip;
    }
    let m = &j["message"];
    let usage = &m["usage"];
    let (Some(id), Some(ts), true) = (j["id"].as_str(), j["timestamp"].as_str(), usage.is_object()) else {
        return Parsed::Skip;
    };
    let Some(date) = lisbon_date(ts) else { return Parsed::Malformed };
    Parsed::Event(UsageEvent {
        key: format!("{file_name}:{id}"),
        date,
        provider: m["provider"].as_str().unwrap_or("unknown").to_string(),
        model: m["model"].as_str().unwrap_or("unknown").to_string(),
        tokens_in: int(&usage["input"]) + int(&usage["cacheWrite"]),
        tokens_cache_read: int(&usage["cacheRead"]),
        tokens_out: int(&usage["output"]),
    })
}

/// Counts one event (R21): the first line of a message adds its values and one message; a later line
/// with more output tokens replaces the counted values by adding the difference; anything else is a no-op.
pub fn count_event(conn: &Connection, org_id: &str, machine: &str, harness: Harness, ev: &UsageEvent) -> rusqlite::Result<()> {
    type Seen = (i64, i64, i64, String, String, String, String);
    let seen: Option<Seen> = conn
        .query_row(
            "SELECT tokens_in, tokens_cache_read, tokens_out, date, provider, model, machine
             FROM usage_seen WHERE org_id = ?1 AND harness = ?2 AND message_key = ?3",
            params![org_id, harness.id(), ev.key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .optional()?;

    let (d_in, d_cache, d_out, messages, date, provider, model, row_machine) = match seen {
        None => {
            conn.execute(
                "INSERT INTO usage_seen (org_id, harness, message_key, date, provider, model, machine, tokens_in, tokens_cache_read, tokens_out)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![org_id, harness.id(), ev.key, ev.date, ev.provider, ev.model, machine, ev.tokens_in, ev.tokens_cache_read, ev.tokens_out],
            )?;
            (ev.tokens_in, ev.tokens_cache_read, ev.tokens_out, 1, ev.date.clone(), ev.provider.clone(), ev.model.clone(), machine.to_string())
        }
        Some((s_in, s_cache, s_out, date, provider, model, row_machine)) => {
            if ev.tokens_out <= s_out {
                return Ok(());
            }
            conn.execute(
                "UPDATE usage_seen SET tokens_in = ?4, tokens_cache_read = ?5, tokens_out = ?6
                 WHERE org_id = ?1 AND harness = ?2 AND message_key = ?3",
                params![org_id, harness.id(), ev.key, ev.tokens_in, ev.tokens_cache_read, ev.tokens_out],
            )?;
            (ev.tokens_in - s_in, ev.tokens_cache_read - s_cache, ev.tokens_out - s_out, 0, date, provider, model, row_machine)
        }
    };

    conn.execute(
        "INSERT INTO usage_daily (org_id, date, provider, model, harness, source, machine, tokens_in, tokens_cache_read, tokens_out, messages, cost_usd)
         VALUES (?1, ?2, ?3, ?4, ?5, 'interactive', ?6, ?7, ?8, ?9, ?10, NULL)
         ON CONFLICT (org_id, date, provider, model, harness, machine) DO UPDATE SET
           tokens_in = tokens_in + excluded.tokens_in,
           tokens_cache_read = tokens_cache_read + excluded.tokens_cache_read,
           tokens_out = tokens_out + excluded.tokens_out,
           messages = messages + excluded.messages",
        params![org_id, date, provider, model, harness.id(), row_machine, d_in, d_cache, d_out, messages],
    )?;
    Ok(())
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct FileResult {
    pub events: usize,
    pub malformed: usize,
}

/// Reads a file from its cursor to its last complete line, counting every event, and moves the cursor —
/// all in one transaction (R25). A changed inode or a file shorter than the cursor starts again from 0;
/// the per-message keys stop that from double counting.
pub fn ingest_file(conn: &mut Connection, org_id: &str, machine: &str, harness: Harness, path: &Path, now: i64) -> Result<FileResult, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let inode = meta.ino() as i64;
    let len = meta.len();
    let path_key = path.to_string_lossy().to_string();
    let cursor: Option<(i64, i64)> = conn
        .query_row(
            "SELECT inode, \"offset\" FROM log_cursors WHERE org_id = ?1 AND path = ?2",
            params![org_id, path_key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let start = match cursor {
        Some((i, offset)) if i == inode && offset >= 0 && (offset as u64) <= len => offset as u64,
        _ => 0,
    };
    if start == len {
        return Ok(FileResult::default());
    }

    let mut file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let Some(last_newline) = buf.iter().rposition(|b| *b == b'\n') else {
        // Only a partial line so far: it waits for the next pass.
        return Ok(FileResult::default());
    };
    let complete = &buf[..=last_newline];
    let new_offset = start + last_newline as u64 + 1;
    let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut result = FileResult::default();
    for raw in complete.split(|b| *b == b'\n') {
        if raw.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let parsed = match std::str::from_utf8(raw) {
            Ok(line) => match harness {
                Harness::ClaudeCode => parse_claude_line(line),
                Harness::Pi => parse_pi_line(line, &file_name),
            },
            Err(_) => Parsed::Malformed,
        };
        match parsed {
            Parsed::Event(ev) => {
                count_event(&tx, org_id, machine, harness, &ev).map_err(|e| e.to_string())?;
                result.events += 1;
            }
            Parsed::Skip => {}
            Parsed::Malformed => result.malformed += 1,
        }
    }
    tx.execute(
        "INSERT INTO log_cursors (org_id, path, inode, \"offset\", updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (org_id, path) DO UPDATE SET inode = excluded.inode, \"offset\" = excluded.\"offset\", updated_at = excluded.updated_at",
        params![org_id, path_key, inode, new_offset as i64, now],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

/// Every `*.jsonl` under `root`, recursively (subagent transcripts included), sorted.
pub fn jsonl_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(t) if t.is_dir() => stack.push(path),
                Ok(t) if t.is_file() && path.extension().is_some_and(|e| e == "jsonl") => out.push(path),
                _ => {}
            }
        }
    }
    out.sort();
    out
}

/// `sweep` is the whole-root pass the tests use; the runtime takes the store's lock per file instead.
#[cfg(test)]
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SweepResult {
    pub files: usize,
    pub events: usize,
    pub malformed: usize,
    /// Files that could not be read, with the reason; they are retried on the next sweep.
    pub failed: Vec<String>,
}

/// Ingests every transcript under `root`. `progress(done, total)` is called after each file.
#[cfg(test)]
pub fn sweep(conn: &mut Connection, org_id: &str, machine: &str, harness: Harness, root: &Path, now: i64, mut progress: impl FnMut(usize, usize)) -> SweepResult {
    let files = jsonl_files(root);
    let total = files.len();
    let mut result = SweepResult { files: total, ..SweepResult::default() };
    for (i, file) in files.iter().enumerate() {
        match ingest_file(conn, org_id, machine, harness, file, now) {
            Ok(r) => {
                result.events += r.events;
                result.malformed += r.malformed;
            }
            Err(e) => result.failed.push(e),
        }
        progress(i + 1, total);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use std::io::Write;

    fn fixtures() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/transcripts")
    }

    #[derive(Debug, PartialEq, serde::Deserialize)]
    struct Row {
        date: String,
        harness: String,
        provider: String,
        model: String,
        tokens_in: i64,
        tokens_cache_read: i64,
        tokens_out: i64,
        messages: i64,
    }

    fn rows(store: &Store) -> Vec<Row> {
        let conn = store.conn();
        let mut stmt = conn
            .prepare(
                "SELECT date, harness, provider, model, sum(tokens_in), sum(tokens_cache_read), sum(tokens_out), sum(messages)
                 FROM usage_daily GROUP BY date, harness, provider, model ORDER BY date, harness, provider, model",
            )
            .unwrap();
        stmt.query_map([], |r| {
            Ok(Row { date: r.get(0)?, harness: r.get(1)?, provider: r.get(2)?, model: r.get(3)?, tokens_in: r.get(4)?, tokens_cache_read: r.get(5)?, tokens_out: r.get(6)?, messages: r.get(7)? })
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
    }

    fn expected() -> Vec<Row> {
        let json: Value = serde_json::from_str(&std::fs::read_to_string(fixtures().join("expected.json")).unwrap()).unwrap();
        serde_json::from_value(json["rows"].clone()).unwrap()
    }

    fn ingest_fixtures(store: &Store) -> (SweepResult, SweepResult) {
        let mut conn = store.conn();
        let claude = sweep(&mut conn, store.org_id(), "mac", Harness::ClaudeCode, &fixtures().join("claude"), 1, |_, _| {});
        let pi = sweep(&mut conn, store.org_id(), "mac", Harness::Pi, &fixtures().join("pi"), 1, |_, _| {});
        (claude, pi)
    }

    #[test]
    fn lisbon_dates_across_the_dst_change() {
        assert_eq!(lisbon_date("2026-10-24T23:30:00.000Z").as_deref(), Some("2026-10-25"));
        assert_eq!(lisbon_date("2026-10-25T23:30:00Z").as_deref(), Some("2026-10-25"));
        assert_eq!(lisbon_date("not a time"), None);
    }

    #[test]
    fn fixture_transcripts_match_the_hand_derived_totals() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let (claude, pi) = ingest_fixtures(&store);
        assert_eq!(rows(&store), expected());
        assert_eq!(claude.files, 2);
        assert_eq!(claude.malformed, 1);
        assert_eq!(pi.files, 1);
        assert!(claude.failed.is_empty() && pi.failed.is_empty());
    }

    #[test]
    fn largest_output_wins_in_any_order() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let conn = store.conn();
        for out in [40, 5, 112, 60] {
            let ev = UsageEvent { key: "m".into(), date: "2026-09-10".into(), provider: "anthropic".into(), model: "x".into(), tokens_in: 1, tokens_cache_read: 2, tokens_out: out };
            count_event(&conn, store.org_id(), "mac", Harness::ClaudeCode, &ev).unwrap();
        }
        let (out, messages): (i64, i64) = conn.query_row("SELECT tokens_out, messages FROM usage_daily", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((out, messages), (112, 1));
    }

    #[test]
    fn a_partial_trailing_line_waits_for_the_next_pass() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let path = dir.path().join("t.jsonl");
        let line = std::fs::read_to_string(fixtures().join("claude/-Users-test-project/11111111-1111-1111-1111-111111111111/subagents/agent-a1.jsonl")).unwrap();
        let first = line.lines().next().unwrap();
        let (head, tail) = first.split_at(first.len() / 2);
        std::fs::write(&path, head).unwrap();
        let r = ingest_file(&mut store.conn(), store.org_id(), "mac", Harness::ClaudeCode, &path, 1).unwrap();
        assert_eq!(r, FileResult::default());
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "{tail}").unwrap();
        let r = ingest_file(&mut store.conn(), store.org_id(), "mac", Harness::ClaudeCode, &path, 2).unwrap();
        assert_eq!(r.events, 1);
    }

    #[test]
    fn re_reading_from_zero_never_double_counts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        ingest_fixtures(&store);
        let before = rows(&store);
        // Nothing new: a second sweep adds nothing.
        ingest_fixtures(&store);
        assert_eq!(rows(&store), before);
        // Cursors gone (as after a truncation or an inode change): everything is re-read, nothing doubles.
        store.conn().execute("DELETE FROM log_cursors", []).unwrap();
        ingest_fixtures(&store);
        assert_eq!(rows(&store), before);
    }

    #[test]
    fn a_truncated_file_is_read_again_from_the_start() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let path = dir.path().join("pi.jsonl");
        let source = std::fs::read_to_string(fixtures().join("pi/--Users-test--/2026-09-13T15-18-56-787Z_01a09b59-9e13-7323-8668-790ea33ef6d0.jsonl")).unwrap();
        std::fs::write(&path, &source).unwrap();
        ingest_file(&mut store.conn(), store.org_id(), "mac", Harness::Pi, &path, 1).unwrap();
        // Rewrite shorter: only the header and the first message.
        let shorter: String = source.lines().take(3).map(|l| format!("{l}\n")).collect();
        std::fs::write(&path, shorter).unwrap();
        let r = ingest_file(&mut store.conn(), store.org_id(), "mac", Harness::Pi, &path, 2).unwrap();
        assert_eq!(r.events, 1, "re-read from 0 sees the one remaining message");
        let messages: i64 = store.conn().query_row("SELECT sum(messages) FROM usage_daily", [], |r| r.get(0)).unwrap();
        assert_eq!(messages, 2, "the already-counted messages are not counted again");
    }

    #[test]
    fn a_missing_root_is_an_empty_sweep() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let r = sweep(&mut store.conn(), store.org_id(), "mac", Harness::Pi, Path::new("/nonexistent/pi"), 1, |_, _| {});
        assert_eq!(r, SweepResult::default());
    }

    #[test]
    fn counted_message_keys_are_never_deleted() {
        // A deleted key lets its line count twice the next time its file is read from zero, and
        // transcripts outlive any fixed window (this Mac kept 59-day-old ones; 6 days doubled in AC-6).
        let forbidden = concat!("DELETE FROM ", "usage_seen");
        for (name, source) in [("logs.rs", include_str!("logs.rs")), ("runtime.rs", include_str!("runtime.rs"))] {
            assert!(!source.contains(forbidden), "{name} deletes counted message keys");
        }
    }
}
