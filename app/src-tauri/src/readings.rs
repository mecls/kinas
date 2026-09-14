//! Everything the Usage page (and later the CLI's palette door) shows, read in one go so a page never
//! mixes readings from different moments. States are computed here, at read time, from each reader's
//! stored limits (PRD R12).

use crate::readers::claude_plan::HookStatus;
use crate::readers::runtime::Backfill;
use crate::redact::{Reader, DEAD_AFTER_MS};
use crate::staleness::{reading_state, ReadingState};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;

pub const CHART_DAYS: i64 = 30;

#[derive(Debug, Serialize, PartialEq)]
pub struct QuotaView {
    pub subscription: String,
    pub window: String,
    pub used_pct: f64,
    /// Unrounded; every surface floors it for display (build spec invariant 6).
    pub left_pct: f64,
    pub resets_at: Option<i64>,
    pub plan: Option<String>,
    pub source: String,
    pub updated_at: i64,
    pub state: ReadingState,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ReaderView {
    pub reader: String,
    pub state: String,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
    pub stale_after_ms: i64,
    pub dead_after_ms: i64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct HostView {
    pub machine: String,
    pub cpu_pct: Option<f64>,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub disk_used_gb: f64,
    pub disk_total_gb: f64,
    pub updated_at: i64,
    pub state: ReadingState,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct UsageDay {
    pub date: String,
    pub harness: String,
    pub provider: String,
    pub model: String,
    pub tokens_in: i64,
    pub tokens_cache_read: i64,
    pub tokens_out: i64,
    pub messages: i64,
}

#[derive(Debug, Serialize)]
pub struct UsageSnapshot {
    pub now: i64,
    pub quotas: Vec<QuotaView>,
    pub readers: Vec<ReaderView>,
    pub host: Option<HostView>,
    pub usage: Vec<UsageDay>,
    pub first_usage_date: Option<String>,
    pub days: Vec<String>,
    pub backfill: Backfill,
    pub claude_hook: HookStatus,
}

fn default_limits(reader: &str) -> (i64, i64) {
    let r = match reader {
        "claude-plan" => Reader::ClaudePlan,
        "ollama-cloud" => Reader::OllamaCloud,
        "claude-code-logs" => Reader::ClaudeCodeLogs,
        "pi-logs" => Reader::PiLogs,
        _ => Reader::Host,
    };
    (r.stale_after_ms(), DEAD_AFTER_MS)
}

/// The 30 Europe/Lisbon dates ending today, oldest first.
pub fn chart_days(now_ms: i64) -> Vec<String> {
    let Ok(today) = jiff::Timestamp::from_millisecond(now_ms).and_then(|t| t.in_tz("Europe/Lisbon")).map(|z| z.date()) else {
        return Vec::new();
    };
    (0..CHART_DAYS)
        .rev()
        .filter_map(|back| today.checked_sub(jiff::Span::new().days(back)).ok())
        .map(|d| d.strftime("%Y-%m-%d").to_string())
        .collect()
}

pub fn snapshot(conn: &Connection, org_id: &str, now: i64, backfill: Backfill, claude_hook: HookStatus) -> rusqlite::Result<UsageSnapshot> {
    let readers: Vec<ReaderView> = conn
        .prepare(
            "SELECT reader, state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms
             FROM reader_status WHERE org_id = ?1 ORDER BY reader",
        )?
        .query_map(params![org_id], |r| {
            Ok(ReaderView {
                reader: r.get(0)?,
                state: r.get(1)?,
                last_attempt_at: r.get(2)?,
                last_success_at: r.get(3)?,
                last_error: r.get(4)?,
                stale_after_ms: r.get(5)?,
                dead_after_ms: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let limits: HashMap<&str, (i64, i64)> = readers.iter().map(|r| (r.reader.as_str(), (r.stale_after_ms, r.dead_after_ms))).collect();
    let limits_for = |reader: &str| limits.get(reader).copied().unwrap_or_else(|| default_limits(reader));

    let quotas = conn
        .prepare(
            "SELECT subscription, \"window\", used_pct, resets_at, plan, source, updated_at FROM quotas
             WHERE org_id = ?1 ORDER BY subscription, CASE \"window\" WHEN 'session' THEN 0 WHEN 'week' THEN 1 ELSE 2 END",
        )?
        .query_map(params![org_id], |r| {
            let subscription: String = r.get(0)?;
            let used_pct: f64 = r.get(2)?;
            let resets_at: Option<i64> = r.get(3)?;
            let updated_at: i64 = r.get(6)?;
            let (stale, dead) = limits_for(&subscription);
            Ok(QuotaView {
                window: r.get(1)?,
                used_pct,
                left_pct: 100.0 - used_pct,
                resets_at,
                plan: r.get(4)?,
                source: r.get(5)?,
                updated_at,
                state: reading_state(Some(updated_at), stale, dead, resets_at, now),
                subscription,
            })
        })?
        .collect::<Result<_, _>>()?;

    let host = conn
        .prepare(
            "SELECT machine, cpu_pct, mem_used_gb, mem_total_gb, disk_used_gb, disk_total_gb, updated_at FROM hosts
             WHERE org_id = ?1 ORDER BY updated_at DESC LIMIT 1",
        )?
        .query_map(params![org_id], |r| {
            let updated_at: i64 = r.get(6)?;
            let (stale, dead) = limits_for("host");
            Ok(HostView {
                machine: r.get(0)?,
                cpu_pct: r.get(1)?,
                mem_used_gb: r.get(2)?,
                mem_total_gb: r.get(3)?,
                disk_used_gb: r.get(4)?,
                disk_total_gb: r.get(5)?,
                updated_at,
                state: reading_state(Some(updated_at), stale, dead, None, now),
            })
        })?
        .next()
        .transpose()?;

    let days = chart_days(now);
    let usage = conn
        .prepare(
            "SELECT date, harness, provider, model, sum(tokens_in), sum(tokens_cache_read), sum(tokens_out), sum(messages)
             FROM usage_daily WHERE org_id = ?1 AND date >= ?2
             GROUP BY date, harness, provider, model ORDER BY date, harness, provider, model",
        )?
        .query_map(params![org_id, days.first().cloned().unwrap_or_default()], |r| {
            Ok(UsageDay {
                date: r.get(0)?,
                harness: r.get(1)?,
                provider: r.get(2)?,
                model: r.get(3)?,
                tokens_in: r.get(4)?,
                tokens_cache_read: r.get(5)?,
                tokens_out: r.get(6)?,
                messages: r.get(7)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let first_usage_date: Option<String> = conn.query_row("SELECT min(date) FROM usage_daily WHERE org_id = ?1", params![org_id], |r| r.get(0))?;

    Ok(UsageSnapshot { now, quotas, readers, host, usage, first_usage_date, days, backfill, claude_hook })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::redact::{write_reader_status, Outcome};
    use crate::store::Store;

    const NOW: i64 = 1_789_390_320_000; // 2026-09-14T12:52:00Z

    fn hook() -> HookStatus {
        HookStatus { state: "never_seen", captured_at: None, minutes_ago: None }
    }

    #[test]
    fn chart_days_are_30_lisbon_dates_ending_today() {
        let days = chart_days(NOW);
        assert_eq!(days.len(), 30);
        assert_eq!(days.last().map(String::as_str), Some("2026-09-14"));
        assert_eq!(days.first().map(String::as_str), Some("2026-08-16"));
        // 23:30Z on 24 October is already 25 October in Lisbon.
        assert_eq!(chart_days(1_792_884_600_000).last().map(String::as_str), Some("2026-10-25"));
    }

    #[test]
    fn states_come_from_each_readers_own_limits() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let conn = store.conn();
        let org = store.org_id();
        write_reader_status(&conn, org, Reader::ClaudePlan, Outcome::Success, NOW).unwrap();
        write_reader_status(&conn, org, Reader::OllamaCloud, Outcome::Success, NOW).unwrap();
        // Claude: 20 min old → fresh under its 30 min limit. Ollama: 11 min old → stale under its 10 min limit.
        conn.execute(
            "INSERT INTO quotas VALUES (?1,'claude-plan','session',42,?2,NULL,'s',?3), (?1,'ollama-cloud','week',33.5,NULL,NULL,'o',?4), (?1,'claude-plan','week',10,?5,NULL,'s',?3)",
            params![org, NOW + 3_600_000, NOW - 20 * 60_000, NOW - 11 * 60_000, NOW - 1],
        )
        .unwrap();
        drop(conn);
        let snap = snapshot(&store.conn(), org, NOW, Backfill::default(), hook()).unwrap();
        let find = |s: &str, w: &str| snap.quotas.iter().find(|q| q.subscription == s && q.window == w).unwrap();
        assert_eq!(find("claude-plan", "session").state, ReadingState::Fresh);
        assert_eq!(find("claude-plan", "session").left_pct, 58.0);
        assert_eq!(find("ollama-cloud", "week").state, ReadingState::Stale);
        assert_eq!(find("ollama-cloud", "week").left_pct, 66.5);
        assert_eq!(find("claude-plan", "week").state, ReadingState::Reset);
        assert_eq!(snap.quotas[0].window, "session", "session sorts before week");
    }

    #[test]
    fn usage_covers_the_chart_window_and_reports_the_first_date() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let org = store.org_id();
        store
            .conn()
            .execute(
                "INSERT INTO usage_daily (org_id, date, provider, model, harness, machine, tokens_in, tokens_cache_read, tokens_out, messages)
                 VALUES (?1,'2026-07-01','anthropic','m','claude-code','mac',1,0,1,1), (?1,'2026-09-13','anthropic','m','claude-code','mac',5,6,7,2)",
                params![org],
            )
            .unwrap();
        let snap = snapshot(&store.conn(), org, NOW, Backfill::default(), hook()).unwrap();
        assert_eq!(snap.first_usage_date.as_deref(), Some("2026-07-01"));
        assert_eq!(snap.usage.len(), 1, "July is outside the 30-day window");
        assert_eq!(snap.usage[0].tokens_out, 7);
        assert!(snap.host.is_none());
    }
}
