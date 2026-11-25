//! The Linux machine's own readings, as the bundle brings them (build spec §12 slice 5.2; PRD rule 8): Claude Code's
//! plan hand-off, the host's CPU, memory and disk, and token counts from its transcripts
//! (`cli/src/companion/machine.ts`). They go where this Mac's own go, under the place's label:
//! - the plan through `claude_plan`'s parser and `apply`. One plan, one gauge: whichever machine's reading is newest is
//!   shown, its source naming the machine.
//! - the host as a `hosts` row named for the label;
//! - the counts as `usage_daily` rows with `machine` = the label, each day's figure replaced by the newer recount.
//!
//! Each part is applied once, by the companion's own stamp. One that does not decode is dropped with a log line, never
//! the crew's reading with it. Times on the Linux machine's clock are moved onto this Mac's as the heartbeat is.

use super::bundle::{heartbeat_here, Bundle};
use crate::readers::claude_plan::{self, HandOff};
use crate::readers::host::write_host_there;
use crate::redact::{record_attempt, write_reader_status, Outcome, Reader};
use rusqlite::{params, Connection};
use serde::de::DeserializeOwned;
use serde::Deserialize;

/// More rows than 31 days of every model on both harnesses is not a recount.
const MAX_USAGE_ROWS: usize = 5_000;
const MAX_NAME: usize = 128;

#[derive(Debug, Deserialize)]
pub(crate) struct PlanOut {
    pub text: String,
    pub file_at: i64,
    #[serde(default)]
    pub last_assistant_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct HostOut {
    #[serde(default)]
    pub cpu_pct: Option<f64>,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub disk_used_gb: f64,
    pub disk_total_gb: f64,
    #[serde(default)]
    pub disk_available_gb: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UsageOut {
    pub counted_at: i64,
    pub rows: Vec<UsageRow>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UsageRow {
    pub date: String,
    pub harness: String,
    pub provider: String,
    pub model: String,
    pub tokens_in: i64,
    pub tokens_cache_read: i64,
    pub tokens_out: i64,
    pub messages: i64,
}

/// The companion's stamps of what was applied last.
#[derive(Debug, Default)]
pub(crate) struct Seen {
    plan: Option<(i64, Option<i64>)>,
    host: Option<i64>,
    usage: Option<i64>,
}

fn part<T: DeserializeOwned>(name: &str, value: &Option<serde_json::Value>) -> Option<T> {
    let value = value.as_ref().filter(|v| !v.is_null())?;
    match serde_json::from_value(value.clone()) {
        Ok(t) => Some(t),
        Err(_) => {
            log::warn!("crew: the Linux machine's {name} reading could not be read");
            None
        }
    }
}

/// Applies what is new in the bundle; true when something was written. `mac` is this Mac's own machine name: a label
/// equal to it would mix the two machines' rows, so the host and the counts are left out then.
pub(crate) fn apply(conn: &mut Connection, org: &str, label: &str, mac: &str, b: &Bundle, now: i64, seen: &mut Seen) -> bool {
    // A time on the Linux machine's clock, on this Mac's: as old here, when the bundle was taken, as it was there.
    let offset = b.served_at.map_or(0, |served| now - served);
    let mut wrote = false;

    if let Some(plan) = part::<PlanOut>("plan", &b.plan) {
        let stamp = (plan.file_at, plan.last_assistant_at);
        if seen.plan != Some(stamp) {
            seen.plan = Some(stamp);
            wrote |= apply_plan(conn, org, label, &plan, offset, now);
        }
    }

    let separate = label != mac;
    if !separate && (b.host.is_some() || b.usage.is_some()) {
        log::warn!("crew: the Linux machine's label is this Mac's name; its host and token counts are not shown");
    }

    if let Some(host) = part::<HostOut>("host", &b.host).filter(|_| separate) {
        if seen.host != Some(b.companion.heartbeat_at) {
            let at = heartbeat_here(&b.companion, b.served_at, now).heartbeat_at.min(now);
            if valid_host(&host) {
                match write_host_there(conn, org, label, host.cpu_pct, (host.mem_used_gb, host.mem_total_gb), (host.disk_used_gb, host.disk_total_gb, host.disk_available_gb), at) {
                    Ok(()) => {
                        seen.host = Some(b.companion.heartbeat_at);
                        wrote = true;
                    }
                    Err(e) => log::error!("crew: could not write the Linux machine's host row: {e}"),
                }
            } else {
                seen.host = Some(b.companion.heartbeat_at);
                log::warn!("crew: the Linux machine's host reading is out of range");
            }
        }
    }

    if let Some(usage) = part::<UsageOut>("usage", &b.usage).filter(|_| separate) {
        if seen.usage != Some(usage.counted_at) {
            match write_usage(conn, org, label, &usage.rows) {
                Ok((written, refused)) => {
                    seen.usage = Some(usage.counted_at);
                    wrote |= written > 0;
                    if refused > 0 {
                        log::warn!("crew: {refused} token-count rows from the Linux machine refused");
                    }
                }
                Err(e) => log::error!("crew: could not write the Linux machine's token counts: {e}"),
            }
        }
    }
    wrote
}

fn apply_plan(conn: &mut Connection, org: &str, label: &str, plan: &PlanOut, offset: i64, now: i64) -> bool {
    match claude_plan::parse_handoff(&plan.text) {
        Err(message) => {
            let _ = write_reader_status(conn, org, Reader::ClaudePlan, Outcome::Error(&format!("{label}: {message}")), now);
            true
        }
        Ok(HandOff::NoRateLimits) => {
            let _ = record_attempt(conn, org, Reader::ClaudePlan, now);
            false
        }
        Ok(HandOff::Windows { captured_at, windows, .. }) => {
            // `claude_plan::data_time`'s rule, with the transcript read there: the earlier of the last response and the
            // capture, else the file's time.
            let base = captured_at.unwrap_or(plan.file_at);
            let when = (plan.last_assistant_at.map_or(base, |t| t.min(base)) + offset).min(now);
            let source = format!("{} · {label}", claude_plan::SOURCE);
            match claude_plan::apply_from(conn, org, &windows, when, now, &source) {
                Ok(n) if n > 0 => {
                    let _ = write_reader_status(conn, org, Reader::ClaudePlan, Outcome::Success, now);
                    true
                }
                Ok(_) => {
                    let _ = record_attempt(conn, org, Reader::ClaudePlan, now);
                    false
                }
                Err(message) => {
                    let _ = write_reader_status(conn, org, Reader::ClaudePlan, Outcome::Error(&message), now);
                    true
                }
            }
        }
    }
}

fn valid_host(h: &HostOut) -> bool {
    let size = |v: f64| v.is_finite() && (0.0..1.0e7).contains(&v);
    h.cpu_pct.is_none_or(|c| c.is_finite() && (0.0..=100.0).contains(&c))
        && [h.mem_used_gb, h.mem_total_gb, h.disk_used_gb, h.disk_total_gb].into_iter().all(size)
        && h.disk_available_gb.is_none_or(size)
}

fn valid_row(r: &UsageRow) -> bool {
    let date = r.date.len() == 10 && r.date.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() });
    let name = |s: &str| !s.is_empty() && s.len() <= MAX_NAME && !s.chars().any(char::is_control);
    date && matches!(r.harness.as_str(), "claude-code" | "pi")
        && name(&r.provider)
        && name(&r.model)
        && [r.tokens_in, r.tokens_cache_read, r.tokens_out, r.messages].into_iter().all(|n| n >= 0)
}

/// Each day's recounted figure replaces the stored one for that machine: the recount is the whole day, not a delta.
/// Days the recount no longer carries keep what was stored; nothing is deleted.
fn write_usage(conn: &mut Connection, org: &str, machine: &str, rows: &[UsageRow]) -> rusqlite::Result<(usize, usize)> {
    if rows.len() > MAX_USAGE_ROWS {
        return Ok((0, rows.len()));
    }
    let tx = conn.transaction()?;
    let (mut written, mut refused) = (0, 0);
    for r in rows {
        if !valid_row(r) {
            refused += 1;
            continue;
        }
        tx.execute(
            "INSERT INTO usage_daily (org_id, date, provider, model, harness, source, machine, tokens_in, tokens_cache_read, tokens_out, messages, cost_usd)
             VALUES (?1, ?2, ?3, ?4, ?5, 'interactive', ?6, ?7, ?8, ?9, ?10, NULL)
             ON CONFLICT (org_id, date, provider, model, harness, machine) DO UPDATE SET
               tokens_in = excluded.tokens_in, tokens_cache_read = excluded.tokens_cache_read,
               tokens_out = excluded.tokens_out, messages = excluded.messages",
            params![org, r.date, r.provider, r.model, r.harness, machine, r.tokens_in, r.tokens_cache_read, r.tokens_out, r.messages],
        )?;
        written += 1;
    }
    tx.commit()?;
    Ok((written, refused))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::readers::crew::bundle;
    use crate::store::Store;

    const NOW: i64 = 1_795_650_000_000;
    const MAC: &str = "mac-9c2e";

    fn bundle_with(served_at: i64, heartbeat_at: i64, extra: serde_json::Value) -> Bundle {
        let mut v = serde_json::json!({
            "v": 1, "at": heartbeat_at, "served_at": served_at,
            "companion": { "version": "0.1.0", "since": heartbeat_at, "heartbeat_at": heartbeat_at },
            "installed": false, "snapshot": null
        });
        for (k, val) in extra.as_object().unwrap() {
            v[k] = val.clone();
        }
        bundle::decode(v).unwrap()
    }

    fn handoff(captured_at: i64) -> String {
        serde_json::json!({
            "rate_limits": { "five_hour": { "used_percentage": 12, "resets_at": (NOW / 1000) + 3600 }, "seven_day": { "used_percentage": 40, "resets_at": (NOW / 1000) + 86_400 } },
            "session_id": "0f3a9c2e-1b2c-4d5e-8f90-123456789abc",
            "captured_at": captured_at
        })
        .to_string()
    }

    fn row(date: &str, model: &str, out: i64) -> serde_json::Value {
        serde_json::json!({ "date": date, "harness": "claude-code", "provider": "anthropic", "model": model, "tokens_in": 10, "tokens_cache_read": 100, "tokens_out": out, "messages": 2 })
    }

    fn quotas(store: &Store) -> Vec<(String, f64, String, i64)> {
        let conn = store.conn();
        let mut st = conn.prepare("SELECT \"window\", used_pct, source, updated_at FROM quotas WHERE subscription = 'claude-plan' ORDER BY \"window\"").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(Result::unwrap).collect()
    }

    fn usage(store: &Store) -> Vec<(String, String, String, i64, i64)> {
        let conn = store.conn();
        let mut st = conn.prepare("SELECT date, model, machine, tokens_out, messages FROM usage_daily ORDER BY date, model, machine").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn the_plan_the_host_and_the_counts_land_under_the_label_on_this_macs_clock_each_once() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let org = store.org_id().to_string();
        // The Linux machine's clock runs 90 s behind this Mac's.
        let skew = 90_000;
        let there = NOW - skew;
        let b = bundle_with(
            there,
            there - 5_000,
            serde_json::json!({
                "plan": { "text": handoff(there - 60_000), "file_at": there - 59_000, "last_assistant_at": there - 120_000 },
                "host": { "cpu_pct": null, "mem_used_gb": 3.5, "mem_total_gb": 16.0, "disk_used_gb": 40.0, "disk_total_gb": 200.0, "disk_available_gb": 150.0 },
                "usage": { "counted_at": there - 10_000, "rows": [row("2026-11-25", "claude-opus-5-5", 7), row("2026-11-24", "claude-sonnet-5-5", 3)] }
            }),
        );
        let mut seen = Seen::default();
        assert!(apply(&mut store.conn(), &org, "homelab", MAC, &b, NOW, &mut seen));

        // The earlier of the last response and the capture, moved onto this Mac's clock.
        let source = format!("{} · homelab", claude_plan::SOURCE);
        assert_eq!(quotas(&store), vec![("session".into(), 12.0, source.clone(), NOW - 120_000), ("week".into(), 40.0, source, NOW - 120_000)]);
        let host: (String, Option<f64>, f64, Option<f64>, i64) = store
            .conn()
            .query_row("SELECT machine, cpu_pct, mem_used_gb, disk_available_gb, updated_at FROM hosts", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .unwrap();
        assert_eq!(host, ("homelab".into(), None, 3.5, Some(150.0), NOW - 5_000));
        assert_eq!(
            usage(&store),
            vec![("2026-11-24".into(), "claude-sonnet-5-5".into(), "homelab".into(), 3, 2), ("2026-11-25".into(), "claude-opus-5-5".into(), "homelab".into(), 7, 2)]
        );

        // The same stamps again write nothing.
        assert!(!apply(&mut store.conn(), &org, "homelab", MAC, &b, NOW + 15_000, &mut seen));

        // A newer recount replaces the day's figure rather than adding to it; a day it no longer carries is kept.
        let later = bundle_with(
            there + 300_000,
            there + 295_000,
            serde_json::json!({ "usage": { "counted_at": there + 290_000, "rows": [row("2026-11-25", "claude-opus-5-5", 9)] } }),
        );
        assert!(apply(&mut store.conn(), &org, "homelab", MAC, &later, NOW + 300_000, &mut seen));
        assert_eq!(usage(&store)[1], ("2026-11-25".into(), "claude-opus-5-5".into(), "homelab".into(), 9, 2));
        assert_eq!(usage(&store).len(), 2);
    }

    #[test]
    fn a_part_that_does_not_decode_or_is_out_of_range_is_dropped_and_the_crew_reading_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let org = store.org_id().to_string();
        let b = bundle_with(
            NOW,
            NOW,
            serde_json::json!({
                "plan": "not a plan",
                "host": { "cpu_pct": 250.0, "mem_used_gb": 1.0, "mem_total_gb": 2.0, "disk_used_gb": 1.0, "disk_total_gb": 2.0 },
                "usage": { "counted_at": NOW, "rows": [
                    row("2026-11-25", "claude-opus-5-5", 1),
                    { "date": "2026-11-25", "harness": "codex", "provider": "anthropic", "model": "m", "tokens_in": 1, "tokens_cache_read": 0, "tokens_out": 1, "messages": 1 },
                    { "date": "25/11/2026", "harness": "pi", "provider": "anthropic", "model": "m", "tokens_in": 1, "tokens_cache_read": 0, "tokens_out": 1, "messages": 1 },
                    { "date": "2026-11-25", "harness": "pi", "provider": "anthropic", "model": "m\u{1b}[31m", "tokens_in": 1, "tokens_cache_read": 0, "tokens_out": 1, "messages": 1 },
                    { "date": "2026-11-25", "harness": "pi", "provider": "anthropic", "model": "m", "tokens_in": -1, "tokens_cache_read": 0, "tokens_out": 1, "messages": 1 }
                ] }
            }),
        );
        let mut seen = Seen::default();
        assert!(apply(&mut store.conn(), &org, "homelab", MAC, &b, NOW, &mut seen));
        assert!(quotas(&store).is_empty());
        assert_eq!(store.conn().query_row("SELECT count(*) FROM hosts", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(usage(&store), vec![("2026-11-25".into(), "claude-opus-5-5".into(), "homelab".into(), 1, 2)]);
    }

    #[test]
    fn an_unreadable_hand_off_is_the_plan_readers_error_named_for_the_machine() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let org = store.org_id().to_string();
        let b = bundle_with(NOW, NOW, serde_json::json!({ "plan": { "text": "{not json", "file_at": NOW } }));
        apply(&mut store.conn(), &org, "homelab", MAC, &b, NOW, &mut Seen::default());
        let (state, error): (String, Option<String>) =
            store.conn().query_row("SELECT state, last_error FROM reader_status WHERE reader = 'claude-plan'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((state.as_str(), error.as_deref()), ("error", Some("homelab: unreadable hand-off file")));
    }

    #[test]
    fn a_label_that_is_this_macs_name_keeps_the_two_machines_rows_apart_by_writing_neither() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let org = store.org_id().to_string();
        let b = bundle_with(
            NOW,
            NOW,
            serde_json::json!({
                "host": { "cpu_pct": 5.0, "mem_used_gb": 1.0, "mem_total_gb": 2.0, "disk_used_gb": 1.0, "disk_total_gb": 2.0 },
                "usage": { "counted_at": NOW, "rows": [row("2026-11-25", "claude-opus-5-5", 1)] }
            }),
        );
        assert!(!apply(&mut store.conn(), &org, MAC, MAC, &b, NOW, &mut Seen::default()));
        assert_eq!(store.conn().query_row("SELECT count(*) FROM hosts", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert!(usage(&store).is_empty());
    }
}
