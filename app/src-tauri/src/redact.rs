//! Redaction (PRD R4) and the one writer of `reader_status` (R12).

use rusqlite::{params, Connection};

const REDACTED: &str = "[redacted]";

/// Replaces `Bearer <token>` and `sk-ant-…` with `[redacted]`. Runs on every error string before it is
/// stored or logged, so a credential that slips into an error message never lands on disk.
pub fn redact(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("Bearer") {
            let spaces = after.len() - after.trim_start().len();
            let token_len = after[spaces..].find(char::is_whitespace).unwrap_or(after.len() - spaces);
            if spaces > 0 && token_len > 0 {
                out.push_str(REDACTED);
                rest = &after[spaces + token_len..];
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix("sk-ant-") {
            let token_len = after.find(char::is_whitespace).unwrap_or(after.len());
            out.push_str(REDACTED);
            rest = &after[token_len..];
            continue;
        }
        let ch = rest.chars().next().expect("rest is not empty");
        out.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reader {
    ClaudePlan,
    OllamaCloud,
    ClaudeCodeLogs,
    PiLogs,
    Host,
    Convex,
    Hostinger,
    /// The crew's collector (the first mate, build spec §6.6): the fleet snapshot.
    Crew,
}

/// Every reader's limit for turning dead (R12).
pub const DEAD_AFTER_MS: i64 = 43_200_000;

impl Reader {
    pub fn id(self) -> &'static str {
        match self {
            Reader::ClaudePlan => "claude-plan",
            Reader::OllamaCloud => "ollama-cloud",
            Reader::ClaudeCodeLogs => "claude-code-logs",
            Reader::PiLogs => "pi-logs",
            Reader::Host => "host",
            Reader::Convex => "convex",
            Reader::Hostinger => "hostinger",
            Reader::Crew => "crew",
        }
    }

    /// Twice the reader's own cadence; for the Claude hand-off, 30 minutes without a Claude Code response.
    pub fn stale_after_ms(self) -> i64 {
        match self {
            Reader::ClaudePlan => 1_800_000,
            // Twice the 5-minute cadence, matching Ollama's (R13).
            Reader::OllamaCloud | Reader::Convex | Reader::Hostinger => 600_000,
            Reader::ClaudeCodeLogs | Reader::PiLogs | Reader::Host => 120_000,
            // The Crew page says "stale" past 60 s (build spec §4): its baseline is 60 s while the window is visible.
            Reader::Crew => 60_000,
        }
    }
}

pub enum Outcome<'a> {
    Success,
    /// A success that still has something to say, e.g. "3 unparseable lines in <file>" (R25).
    Partial(&'a str),
    Error(&'a str),
    NotConfigured(&'a str),
}

/// The only function that writes `reader_status`. Always records the attempt and the reader's limits;
/// a failure keeps `last_success_at`, and every message is redacted.
pub fn write_reader_status(conn: &Connection, org_id: &str, reader: Reader, outcome: Outcome<'_>, now: i64) -> rusqlite::Result<()> {
    let (state, success_at, error) = match outcome {
        Outcome::Success => ("ok", Some(now), None),
        Outcome::Partial(note) => ("ok", Some(now), Some(redact(note))),
        Outcome::Error(message) => ("error", None, Some(redact(message))),
        Outcome::NotConfigured(message) => ("not_configured", None, Some(redact(message))),
    };
    conn.execute(
        "INSERT INTO reader_status (org_id, reader, state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (org_id, reader) DO UPDATE SET
           state = excluded.state,
           last_attempt_at = excluded.last_attempt_at,
           last_success_at = COALESCE(excluded.last_success_at, reader_status.last_success_at),
           last_error = excluded.last_error,
           stale_after_ms = excluded.stale_after_ms,
           dead_after_ms = excluded.dead_after_ms",
        params![org_id, reader.id(), state, now, success_at, error, reader.stale_after_ms(), DEAD_AFTER_MS],
    )?;
    Ok(())
}

/// Records an attempt without changing the reader's state, e.g. the hand-off file was read but carried
/// nothing new. A reader seen for the first time this way starts as `ok`.
pub fn record_attempt(conn: &Connection, org_id: &str, reader: Reader, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO reader_status (org_id, reader, state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms)
         VALUES (?1, ?2, 'ok', ?3, NULL, NULL, ?4, ?5)
         ON CONFLICT (org_id, reader) DO UPDATE SET
           last_attempt_at = excluded.last_attempt_at,
           stale_after_ms = excluded.stale_after_ms,
           dead_after_ms = excluded.dead_after_ms",
        params![org_id, reader.id(), now, reader.stale_after_ms(), DEAD_AFTER_MS],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn redacts_bearer_tokens_and_anthropic_keys() {
        assert_eq!(redact("401 for Authorization: Bearer abc.DEF-123 at x"), "401 for Authorization: [redacted] at x");
        assert_eq!(redact("key sk-ant-oat01-XYZ_9 leaked"), "key [redacted] leaked");
        assert_eq!(redact("Bearer\tsecret"), "[redacted]");
    }

    #[test]
    fn leaves_clean_strings_alone() {
        for s in ["connection refused", "Bearer", "Bearer ", "not a Bearertoken", "ção ✓ 🎛️"] {
            assert_eq!(redact(s), s);
        }
    }

    fn row(store: &Store, reader: Reader) -> (String, Option<i64>, Option<i64>, Option<String>, i64, i64) {
        store
            .conn()
            .query_row(
                "SELECT state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms FROM reader_status WHERE org_id = ?1 AND reader = ?2",
                params![store.org_id(), reader.id()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .unwrap()
    }

    #[test]
    fn a_failure_keeps_the_last_success_and_redacts_the_error() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        write_reader_status(&store.conn(), store.org_id(), Reader::OllamaCloud, Outcome::Success, 1_000).unwrap();
        write_reader_status(&store.conn(), store.org_id(), Reader::OllamaCloud, Outcome::Error("HTTP 401 Bearer ollama-FAKE-key"), 2_000).unwrap();
        let (state, attempt, success, error, _, _) = row(&store, Reader::OllamaCloud);
        assert_eq!(state, "error");
        assert_eq!(attempt, Some(2_000));
        assert_eq!(success, Some(1_000));
        assert_eq!(error.as_deref(), Some("HTTP 401 [redacted]"));
    }

    #[test]
    fn every_reader_writes_its_own_limits() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        for (reader, stale) in [
            (Reader::ClaudePlan, 1_800_000),
            (Reader::OllamaCloud, 600_000),
            (Reader::Convex, 600_000),
            (Reader::Hostinger, 600_000),
            (Reader::Host, 120_000),
            (Reader::ClaudeCodeLogs, 120_000),
            (Reader::PiLogs, 120_000),
            (Reader::Crew, 60_000),
        ] {
            write_reader_status(&store.conn(), store.org_id(), reader, Outcome::NotConfigured("no key"), 5).unwrap();
            let (state, _, success, _, stale_after, dead_after) = row(&store, reader);
            assert_eq!(state, "not_configured");
            assert_eq!(success, None);
            assert_eq!(stale_after, stale);
            assert_eq!(dead_after, DEAD_AFTER_MS);
        }
    }
}
