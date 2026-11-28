//! The factory's events on the Mac (build spec §7 and §11.3 A, slice 11.2b; PRD rules 18 and 21): the companion's `bundle`
//! carries the events after the Mac's count, and each is kept in `factory_events` once (task, event, time). The Mac's count
//! is a setting that moves in the same transaction as the rows, so a crash never loses or repeats a line. An event that does
//! not read is skipped alone and never drops the rest; nothing here deletes a row (a record, not a cache).

use crate::system::{get_setting, put_setting};
use rusqlite::{params, Connection};
use serde::Deserialize;

/// How many lines of the companion's log the Mac has taken (`rpc bundle` sends it back as `cursor.events`).
pub(crate) const CURSOR_SETTING: &str = "crew_factory_cursor";
const MAX_TASK: usize = 128;
const MAX_PROJECT: usize = 100;
const EVENTS: [&str; 9] = ["dispatched", "pr_ready", "merged", "cleaned_up", "held", "answered", "hold_closed", "red", "tokens"];
/// 1 Jan 2020 in milliseconds: no event is older.
const EARLIEST_MS: i64 = 1_577_836_800_000;
const MAX_TOKENS: i64 = 1_000_000_000_000;

/// The count the Mac asks the companion to continue from.
pub(crate) fn cursor(conn: &Connection, org: &str) -> u64 {
    get_setting(conn, org, CURSOR_SETTING).and_then(|v| v.as_u64()).unwrap_or(0)
}

#[derive(Debug, Deserialize)]
struct Chunk {
    from: u64,
    taken: u64,
    #[serde(default)]
    events: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct Event {
    task: String,
    project: String,
    event: String,
    at: i64,
    #[serde(default)]
    value: Option<i64>,
}

fn valid(e: &Event) -> bool {
    let chars = |s: &str| s.chars().count();
    if e.task.is_empty() || chars(&e.task) > MAX_TASK || e.project.is_empty() || chars(&e.project) > MAX_PROJECT {
        return false;
    }
    if !EVENTS.contains(&e.event.as_str()) || e.at < EARLIEST_MS {
        return false;
    }
    match (e.event.as_str(), e.value) {
        ("tokens", Some(n)) => (0..=MAX_TOKENS).contains(&n),
        ("tokens", None) => false,
        (_, v) => v.is_none(),
    }
}

/// Keep what a bundle's `factory` chunk carries, and move the count to where it ended. Returns the rows added. A chunk that
/// is not one changes nothing.
pub(crate) fn mirror(conn: &mut Connection, org: &str, factory: Option<&serde_json::Value>) -> rusqlite::Result<usize> {
    let Some(chunk) = factory.and_then(|v| serde_json::from_value::<Chunk>(v.clone()).ok()) else { return Ok(0) };
    let tx = conn.transaction()?;
    let mut added = 0;
    for raw in &chunk.events {
        let Ok(e) = serde_json::from_value::<Event>(raw.clone()) else { continue };
        if !valid(&e) {
            continue;
        }
        added += tx.execute(
            "INSERT OR IGNORE INTO factory_events (org_id, task_id, project, event, at, value) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![org, e.task, e.project, e.event, e.at, e.value],
        )?;
    }
    put_setting(&tx, org, CURSOR_SETTING, &serde_json::json!(chunk.from.saturating_add(chunk.taken)))?;
    tx.commit()?;
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use serde_json::json;

    const T0: i64 = 1_795_600_000_000;

    fn ev(task: &str, event: &str, at: i64) -> serde_json::Value {
        json!({ "task": task, "project": "alpha", "event": event, "at": at })
    }
    fn count(store: &Store) -> i64 {
        store.conn().query_row("SELECT COUNT(*) FROM factory_events WHERE org_id = ?1", params![store.org_id()], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_chunk_is_kept_and_the_count_moves_past_it() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let chunk = json!({ "from": 0, "taken": 2, "events": [ev("t1", "dispatched", T0), ev("t1", "merged", T0 + 5)] });
        assert_eq!(mirror(&mut store.conn(), store.org_id(), Some(&chunk)).unwrap(), 2);
        assert_eq!(count(&store), 2);
        assert_eq!(cursor(&store.conn(), store.org_id()), 2);
        let next = json!({ "from": 2, "taken": 1, "events": [ev("t2", "held", T0 + 9)] });
        assert_eq!(mirror(&mut store.conn(), store.org_id(), Some(&next)).unwrap(), 1);
        assert_eq!(cursor(&store.conn(), store.org_id()), 3);
    }

    #[test]
    fn the_same_chunk_twice_adds_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let chunk = json!({ "from": 0, "taken": 1, "events": [ev("t1", "merged", T0)] });
        mirror(&mut store.conn(), store.org_id(), Some(&chunk)).unwrap();
        assert_eq!(mirror(&mut store.conn(), store.org_id(), Some(&chunk)).unwrap(), 0);
        assert_eq!(count(&store), 1);
    }

    #[test]
    fn a_file_replaced_on_the_machine_starts_again_and_keeps_what_the_mac_has() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        mirror(&mut store.conn(), store.org_id(), Some(&json!({ "from": 0, "taken": 3, "events": [ev("a", "merged", T0), ev("b", "merged", T0 + 1), ev("c", "merged", T0 + 2)] }))).unwrap();
        // The companion's log is shorter than the count it was given, so it began again at 0 with one event the Mac has.
        assert_eq!(mirror(&mut store.conn(), store.org_id(), Some(&json!({ "from": 0, "taken": 1, "events": [ev("a", "merged", T0)] }))).unwrap(), 0);
        assert_eq!(cursor(&store.conn(), store.org_id()), 1);
        assert_eq!(count(&store), 3, "nothing the Mac has is removed");
    }

    #[test]
    fn an_event_that_does_not_read_is_skipped_alone_and_still_counted_in_the_count() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let chunk = json!({ "from": 0, "taken": 7, "events": [
            ev("t1", "merged", T0),
            { "task": "t1", "project": "alpha", "event": "bogus", "at": T0 },
            { "task": "", "project": "alpha", "event": "merged", "at": T0 + 1 },
            { "task": "t1", "project": "alpha", "event": "merged", "at": 1.5 },
            { "task": "t1", "project": "alpha", "event": "merged", "at": 5 },
            { "task": "t1", "project": "alpha", "event": "merged", "at": T0 + 2, "value": 9 },
            "not an object",
        ] });
        assert_eq!(mirror(&mut store.conn(), store.org_id(), Some(&chunk)).unwrap(), 1);
        assert_eq!(cursor(&store.conn(), store.org_id()), 7);
    }

    #[test]
    fn only_tokens_carry_a_value_and_it_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let tokens = json!({ "task": "t1", "project": "alpha", "event": "tokens", "at": T0, "value": 150 });
        let bare = json!({ "task": "t1", "project": "alpha", "event": "tokens", "at": T0 + 1 });
        let negative = json!({ "task": "t1", "project": "alpha", "event": "tokens", "at": T0 + 2, "value": -1 });
        assert_eq!(mirror(&mut store.conn(), store.org_id(), Some(&json!({ "from": 0, "taken": 3, "events": [tokens, bare, negative] }))).unwrap(), 1);
        let value: i64 = store.conn().query_row("SELECT value FROM factory_events WHERE org_id = ?1", params![store.org_id()], |r| r.get(0)).unwrap();
        assert_eq!(value, 150);
    }

    #[test]
    fn a_task_or_project_past_its_cap_is_not_kept() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let long_task = json!({ "task": "t".repeat(129), "project": "alpha", "event": "merged", "at": T0 });
        let long_project = json!({ "task": "t1", "project": "p".repeat(101), "event": "merged", "at": T0 + 1 });
        let edge = json!({ "task": "t".repeat(128), "project": "p".repeat(100), "event": "merged", "at": T0 + 2 });
        assert_eq!(mirror(&mut store.conn(), store.org_id(), Some(&json!({ "from": 0, "taken": 3, "events": [long_task, long_project, edge] }))).unwrap(), 1);
    }

    #[test]
    fn something_that_is_not_a_chunk_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        for bad in [json!("x"), json!(null), json!({ "from": "0" }), json!({ "taken": 1 }), json!([])] {
            assert_eq!(mirror(&mut store.conn(), store.org_id(), Some(&bad)).unwrap(), 0);
        }
        assert_eq!(mirror(&mut store.conn(), store.org_id(), None).unwrap(), 0, "an older companion sends none");
        assert_eq!(cursor(&store.conn(), store.org_id()), 0);
        assert_eq!(count(&store), 0);
    }

    #[test]
    fn nothing_here_deletes_an_event() {
        let source = include_str!("factory.rs");
        let code = source.split("#[cfg(test)]").next().unwrap();
        assert!(!code.to_uppercase().contains("DELETE FROM"), "a factory event is a record: no DELETE in this module");
        assert!(!code.to_uppercase().contains("UPDATE FACTORY_EVENTS"), "and none is changed");
        assert!(!code.to_uppercase().contains("INSERT OR REPLACE"), "nor replaced");
    }
}
