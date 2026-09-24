//! The crew's read side (build spec §11.2), under one guard the caller takes: the Crew page's snapshot. Words are
//! derived here, at read time, from the mirror's columns (§7) — never stored.

use crate::readers::crew::mirror::{stored_of, STORED_COLUMNS};
use crate::readers::crew::word::{word_of, word_without_gone};
use crate::readings::ReaderView;
use crate::redact::{Reader, DEAD_AFTER_MS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

const DAY_MS: i64 = 86_400_000;
/// Done tasks stay on the board for 7 days after `done_at`, gone ones for 24 h after `gone_at` (§7). Rows stay forever.
const DONE_SHOWN_MS: i64 = 7 * DAY_MS;
const GONE_SHOWN_MS: i64 = DAY_MS;

#[derive(Debug, Serialize)]
pub struct CrewSnapshot {
    pub now: i64,
    pub generated: Option<String>,
    pub reader: ReaderView,
    /// "uninstalled" | "installed" | "running".
    pub page: &'static str,
    /// "<tool> isn't installed — run kinas crew setup" (from slice 2).
    pub blocked: Option<String>,
    pub tasks: Vec<TaskRow>,
    pub decisions: Vec<DecisionRow>,
    pub reconcile: Vec<String>,
    pub waiting: u32,
    pub overnight_since: i64,
}

#[derive(Debug, Serialize)]
pub struct TaskRow {
    pub id: String,
    pub title: Option<String>,
    pub repo: Option<String>,
    pub project_name: Option<String>,
    pub kind: String,
    pub word: &'static str,
    pub overnight_word: &'static str,
    pub harness: Option<String>,
    pub first_seen_at: i64,
    pub first_working_at: Option<i64>,
    pub done_at: Option<i64>,
    pub gone_at: Option<i64>,
    pub last_event_at: Option<i64>,
    pub last_event_text: Option<String>,
    pub pr: Option<PrView>,
    pub has_pane: bool,
}

#[derive(Debug, Serialize)]
pub struct PrView {
    pub number: u32,
    pub state: Option<String>,
    pub draft: bool,
    pub mergeable: Option<String>,
    pub checks_total: Option<u32>,
    pub checks_failed: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct DecisionRow {
    pub task_id: String,
    pub key: String,
    pub verb: String,
    pub summary: String,
    pub task_title: Option<String>,
    pub repo: Option<String>,
    pub opened_at: i64,
    pub copied_at: Option<i64>,
}

/// The Crew page's reading. `installed` and `generated` are known outside the guard: whether the home's snapshot
/// script exists, and the last good snapshot's time. Until the launcher lands (slice 3), an installed crew reads as
/// running.
pub(crate) fn snapshot_view(conn: &Connection, org: &str, now: i64, installed: bool, generated: Option<String>) -> rusqlite::Result<CrewSnapshot> {
    Ok(CrewSnapshot {
        now,
        generated,
        reader: reader(conn, org)?,
        page: if installed { "running" } else { "uninstalled" },
        blocked: None,
        tasks: tasks(conn, org, now)?,
        decisions: Vec::new(),
        reconcile: Vec::new(),
        waiting: 0,
        overnight_since: now - DAY_MS,
    })
}

fn reader(conn: &Connection, org: &str) -> rusqlite::Result<ReaderView> {
    let found = conn
        .query_row(
            "SELECT state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms FROM reader_status WHERE org_id = ?1 AND reader = 'crew'",
            params![org],
            |r| {
                Ok(ReaderView {
                    reader: "crew".into(),
                    state: r.get(0)?,
                    last_attempt_at: r.get(1)?,
                    last_success_at: r.get(2)?,
                    last_error: r.get(3)?,
                    stale_after_ms: r.get(4)?,
                    dead_after_ms: r.get(5)?,
                })
            },
        )
        .optional()?;
    Ok(found.unwrap_or_else(|| ReaderView {
        reader: "crew".into(),
        state: "not_configured".into(),
        last_attempt_at: None,
        last_success_at: None,
        last_error: None,
        stale_after_ms: Reader::Crew.stale_after_ms(),
        dead_after_ms: DEAD_AFTER_MS,
    }))
}

/// Every task inside its retention, newest first; the board orders them itself.
fn tasks(conn: &Connection, org: &str, now: i64) -> rusqlite::Result<Vec<TaskRow>> {
    let sql = format!(
        "SELECT id, title, repo, project_name, kind, harness, pr_number, (SELECT e.at FROM crew_events e WHERE e.org_id = t.org_id
           AND e.task_id = t.id AND e.kind != 'order' ORDER BY e.at DESC, e.id DESC LIMIT 1), (SELECT e.text FROM crew_events e
           WHERE e.org_id = t.org_id AND e.task_id = t.id AND e.kind != 'order' ORDER BY e.at DESC, e.id DESC LIMIT 1),
           {STORED_COLUMNS}
         FROM crew_tasks t
         WHERE org_id = ?1 AND (gone_at IS NULL OR gone_at > ?2) AND (done_at IS NULL OR done_at > ?3)
         ORDER BY first_seen_at DESC, id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![org, now - GONE_SHOWN_MS, now - DONE_SHOWN_MS], |r| {
        let stored = stored_of(r, 9)?;
        let input = stored.input();
        let pr_number: Option<u32> = r.get(6)?;
        Ok(TaskRow {
            id: r.get(0)?,
            title: r.get(1)?,
            repo: r.get(2)?,
            project_name: r.get(3)?,
            kind: r.get(4)?,
            word: word_of(&input),
            overnight_word: word_without_gone(&input),
            harness: r.get(5)?,
            first_seen_at: stored.first_seen_at,
            first_working_at: stored.first_working_at,
            done_at: stored.done_at,
            gone_at: stored.gone_at,
            last_event_at: r.get(7)?,
            last_event_text: r.get(8)?,
            pr: pr_number.map(|number| PrView {
                number,
                state: stored.pr_state.clone(),
                draft: stored.pr_draft,
                mergeable: stored.pr_mergeable.clone(),
                checks_total: stored.pr_checks_total,
                checks_failed: stored.pr_checks_failed,
            }),
            has_pane: false,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::readers::crew::mirror::record;
    use crate::readers::crew::snapshot::parse_fleet;
    use crate::store::Store;

    const T0: i64 = 1_790_000_000_000;

    fn cycle(store: &Store, name: &str, now: i64) {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/crew-snapshot.{name}.synthetic.json"));
        let fleet = parse_fleet(&std::fs::read_to_string(path).unwrap());
        record(&mut store.conn(), store.org_id(), &fleet, now).unwrap();
    }

    #[test]
    fn the_page_reads_the_mirror_inside_retention() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let view = snapshot_view(&store.conn(), store.org_id(), T0, false, None).unwrap();
        assert_eq!((view.page, view.tasks.len(), view.reader.state.as_str()), ("uninstalled", 0, "not_configured"));

        cycle(&store, "working", T0);
        let view = snapshot_view(&store.conn(), store.org_id(), T0 + 1, true, Some("g".into())).unwrap();
        assert_eq!((view.page, view.generated.as_deref(), view.reader.state.as_str()), ("running", Some("g"), "ok"));
        let task = &view.tasks[0];
        assert_eq!((task.word, task.kind.as_str(), task.project_name.as_deref()), ("working", "ship", Some("shop-9c2e")));
        assert_eq!(task.title.as_deref(), Some("Add a health check to the shop 9c2e"));
        assert_eq!(task.last_event_text.as_deref(), Some("working"), "the newest event that is not an order");

        cycle(&store, "done", T0 + 10);
        let done = snapshot_view(&store.conn(), store.org_id(), T0 + 7 * DAY_MS, true, None).unwrap();
        assert_eq!(done.tasks[0].word, "done");
        assert_eq!(done.tasks[0].pr.as_ref().map(|p| p.number), Some(12));
        let later = snapshot_view(&store.conn(), store.org_id(), T0 + 10 + 7 * DAY_MS + 1, true, None).unwrap();
        assert!(later.tasks.is_empty(), "done is shown for 7 days");

        cycle(&store, "empty", T0 + 20);
        let gone = snapshot_view(&store.conn(), store.org_id(), T0 + 21, true, None).unwrap();
        assert_eq!((gone.tasks[0].word, gone.tasks[0].overnight_word), ("gone", "done"));
    }
}
