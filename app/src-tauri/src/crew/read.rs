//! The crew's read side (build spec §11.2), under one guard the caller takes: the Crew page's snapshot. Words are
//! derived here, at read time, from the mirror's columns (§7) — never stored.

use crate::readers::crew::mirror::{stored_of, STORED_COLUMNS};
use crate::readers::crew::word::{word_of, word_without_gone};
use crate::readings::ReaderView;
use crate::redact::{Reader, DEAD_AFTER_MS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;

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

/// A worker row this old no longer shows its pane's button (§7 Worker: stale after 15 s).
const WORKER_FRESH_MS: i64 = 15_000;

/// The Crew page's reading. `installed`, `running` and `generated` are known outside the guard: whether the home's
/// snapshot script exists, whether Herdr's last view has the `firstmate` workspace, and the last good snapshot's time.
pub(crate) fn snapshot_view(conn: &Connection, org: &str, now: i64, installed: bool, running: bool, generated: Option<String>) -> rusqlite::Result<CrewSnapshot> {
    Ok(CrewSnapshot {
        now,
        generated,
        reader: reader(conn, org)?,
        page: match (installed, running) {
            (false, _) => "uninstalled",
            (true, false) => "installed",
            (true, true) => "running",
        },
        blocked: None,
        tasks: tasks(conn, org, now)?,
        decisions: decisions(conn, org, None)?,
        reconcile: Vec::new(),
        waiting: waiting(conn, org)?,
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

/// A task row's columns, with the newest event that is not an order and whether a fresh worker row exists (`?4` is
/// the freshness cut-off).
fn task_select() -> String {
    format!(
        "SELECT id, title, repo, project_name, kind, harness, pr_number, (SELECT e.at FROM crew_events e WHERE e.org_id = t.org_id
           AND e.task_id = t.id AND e.kind != 'order' ORDER BY e.at DESC, e.id DESC LIMIT 1), (SELECT e.text FROM crew_events e
           WHERE e.org_id = t.org_id AND e.task_id = t.id AND e.kind != 'order' ORDER BY e.at DESC, e.id DESC LIMIT 1),
           {STORED_COLUMNS},
           EXISTS (SELECT 1 FROM crew_workers w WHERE w.org_id = t.org_id AND w.task_id = t.id AND w.observed_at > ?4)
         FROM crew_tasks t"
    )
}

fn task_row(r: &rusqlite::Row) -> rusqlite::Result<TaskRow> {
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
        has_pane: r.get(24)?,
    })
}

/// Every task inside its retention, newest first; the board orders them itself.
fn tasks(conn: &Connection, org: &str, now: i64) -> rusqlite::Result<Vec<TaskRow>> {
    let sql = format!(
        "{} WHERE org_id = ?1 AND (gone_at IS NULL OR gone_at > ?2) AND (done_at IS NULL OR done_at > ?3) ORDER BY first_seen_at DESC, id",
        task_select()
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![org, now - GONE_SHOWN_MS, now - DONE_SHOWN_MS, now - WORKER_FRESH_MS], task_row)?;
    rows.collect()
}

#[derive(Debug, Serialize)]
pub struct CheckView {
    pub name: String,
    /// SUCCESS | FAILURE | PENDING | NEUTRAL | SKIPPED | …
    pub conclusion: String,
}

#[derive(Debug, Serialize)]
pub struct EventRow {
    pub at: i64,
    pub kind: String,
    pub text: String,
}

/// The right panel's task (build spec §4 Task detail): the card's row plus Firstmate's state line, the task's settings,
/// the ask as filed, the paths the panel opens, the PR's review and checks, and the timeline. Any task the mirror holds,
/// gone ones included — the panel says when it has left the snapshot.
#[derive(Debug, Serialize)]
pub struct CrewTaskDetail {
    pub task: TaskRow,
    /// Firstmate's `current_state` as it prints it: `state: working · source: pane · harness busy (fm-spawn)`.
    pub state_line: Option<String>,
    /// When Firstmate observed that state, as it wrote it (ISO 8601, UTC).
    pub state_observed_at: Option<String>,
    pub mode: Option<String>,
    pub yolo: bool,
    pub backend: Option<String>,
    pub excerpt: Option<String>,
    /// `<home>/data/<id>/brief.md` when it exists, filled by the command after the guard.
    pub brief_path: Option<String>,
    /// The scout's report, absolute, filled by the command.
    pub report_path: Option<String>,
    pub report_present: bool,
    /// The worktree as the sidebar shows paths (`~/…`), filled by the command.
    pub worktree_display: Option<String>,
    pub worktree_present: Option<bool>,
    pub pr_review: Option<String>,
    /// Filled by the command from the collector's memory: check names are not stored.
    pub checks: Vec<CheckView>,
    /// Oldest first, orders included.
    pub events: Vec<EventRow>,
    pub decisions: Vec<DecisionRow>,
    /// What the command needs and the webview does not see.
    #[serde(skip)]
    pub paths: DetailPaths,
}

/// The stored paths behind the detail's links, resolved by the command outside the guard.
#[derive(Debug, Default)]
pub struct DetailPaths {
    pub report: Option<String>,
    pub worktree: Option<String>,
    pub pr_url: Option<String>,
}

/// One task for the panel, or None when the mirror has never held it.
pub(crate) fn task_view(conn: &Connection, org: &str, id: &str, now: i64) -> rusqlite::Result<Option<CrewTaskDetail>> {
    // `?3` is the retention bound the board uses; one task is shown whatever its age.
    let sql = format!("{} WHERE org_id = ?1 AND id = ?2", task_select());
    let Some(task) = conn.query_row(&sql, params![org, id, 0, now - WORKER_FRESH_MS], task_row).optional()? else { return Ok(None) };
    let text = |r: &rusqlite::Row, i: usize| r.get::<_, Option<String>>(i);
    let (state, source, detail, observed_at, mode, backend, excerpt, report, worktree, pr_review, pr_url) = conn.query_row(
        "SELECT state, state_source, state_detail, state_observed_at, mode, backend, excerpt, report_path, worktree_path,
           pr_review, pr_url FROM crew_tasks WHERE org_id = ?1 AND id = ?2",
        params![org, id],
        |r| Ok((text(r, 0)?, text(r, 1)?, text(r, 2)?, text(r, 3)?, text(r, 4)?, text(r, 5)?, text(r, 6)?, text(r, 7)?, text(r, 8)?, text(r, 9)?, text(r, 10)?)),
    )?;
    let (yolo, report_present, worktree_present): (bool, bool, Option<bool>) = conn.query_row(
        "SELECT yolo, report_present, worktree_present FROM crew_tasks WHERE org_id = ?1 AND id = ?2",
        params![org, id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let mut stmt = conn.prepare("SELECT at, kind, text FROM crew_events WHERE org_id = ?1 AND task_id = ?2 ORDER BY at, id")?;
    let events = stmt.query_map(params![org, id], |r| Ok(EventRow { at: r.get(0)?, kind: r.get(1)?, text: r.get(2)? }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(CrewTaskDetail {
        task,
        state_line: state.map(|s| state_line(&s, source.as_deref(), detail.as_deref())),
        state_observed_at: observed_at,
        mode,
        yolo,
        backend,
        excerpt,
        brief_path: None,
        report_path: None,
        report_present,
        worktree_display: None,
        worktree_present,
        pr_review,
        checks: Vec::new(),
        events,
        decisions: decisions(conn, org, Some(id))?,
        paths: DetailPaths { report, worktree, pr_url },
    }))
}

/// `state: working · source: pane · harness busy (fm-spawn)`, the shape Firstmate prints as `current_state.raw`.
fn state_line(state: &str, source: Option<&str>, detail: Option<&str>) -> String {
    let mut line = format!("state: {state}");
    if let Some(source) = source {
        line.push_str(&format!(" · source: {source}"));
    }
    if let Some(detail) = detail {
        line.push_str(&format!(" · {detail}"));
    }
    line
}

/// The one waiting count (§6.12): open decision rows, copied or not. The Crew page, the sidebar, the Inbox and the menu
/// bar all show this number, and nothing else computes it.
pub(crate) fn waiting(conn: &Connection, org: &str) -> rusqlite::Result<u32> {
    conn.query_row("SELECT count(*) FROM crew_decisions WHERE org_id = ?1 AND closed_at IS NULL", params![org], |r| r.get(0))
}

/// The open decisions, newest first — every one, or one task's — with the task's title and repository.
fn decisions(conn: &Connection, org: &str, task: Option<&str>) -> rusqlite::Result<Vec<DecisionRow>> {
    let mut stmt = conn.prepare(
        "SELECT d.task_id, d.key, d.verb, d.summary, t.title, t.repo, d.opened_at, d.copied_at
         FROM crew_decisions d LEFT JOIN crew_tasks t ON t.org_id = d.org_id AND t.id = d.task_id
         WHERE d.org_id = ?1 AND d.closed_at IS NULL AND (?2 IS NULL OR d.task_id = ?2)
         ORDER BY d.opened_at DESC, d.task_id, d.key",
    )?;
    let rows = stmt.query_map(params![org, task], |r| {
        Ok(DecisionRow {
            task_id: r.get(0)?,
            key: r.get(1)?,
            verb: r.get(2)?,
            summary: r.get(3)?,
            task_title: r.get(4)?,
            repo: r.get(5)?,
            opened_at: r.get(6)?,
            copied_at: r.get(7)?,
        })
    })?;
    rows.collect()
}

/// A task's worker row while it is fresh: (session, workspace).
pub(crate) fn fresh_worker(conn: &Connection, org: &str, task: &str, now: i64) -> rusqlite::Result<Option<(String, Option<String>)>> {
    conn.query_row(
        "SELECT session, workspace_id FROM crew_workers WHERE org_id = ?1 AND task_id = ?2 AND observed_at > ?3",
        params![org, task, now - WORKER_FRESH_MS],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
}

/// Every worker's pane, for attributing an order (§6.10): the cache the collector rewrites each cycle.
pub(crate) fn worker_panes(conn: &Connection, org: &str) -> rusqlite::Result<Vec<crate::crew::orders::WorkerFacts>> {
    let mut stmt = conn.prepare("SELECT task_id, pane_id FROM crew_workers WHERE org_id = ?1")?;
    let rows = stmt.query_map(params![org], |r| Ok(crate::crew::orders::WorkerFacts { task_id: r.get(0)?, pane_id: r.get(1)? }))?;
    rows.collect()
}

/// Each worker's pane → its task's word and harness: the chrome's badge (§4 Work), kept in memory by the collector.
pub(crate) fn worker_words(conn: &Connection, org: &str) -> rusqlite::Result<HashMap<String, (&'static str, Option<String>)>> {
    let sql = format!("SELECT w.pane_id, t.harness, {STORED_COLUMNS} FROM crew_workers w JOIN crew_tasks t ON t.org_id = w.org_id AND t.id = w.task_id WHERE w.org_id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![org], |r| {
        let stored = stored_of(r, 2)?;
        Ok((r.get::<_, String>(0)?, (word_of(&stored.input()), r.get::<_, Option<String>>(1)?)))
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
        record(&mut store.conn(), store.org_id(), &fleet, &Default::default(), now).unwrap();
    }

    #[test]
    fn the_page_reads_the_mirror_inside_retention() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let view = snapshot_view(&store.conn(), store.org_id(), T0, false, false, None).unwrap();
        assert_eq!((view.page, view.tasks.len(), view.reader.state.as_str()), ("uninstalled", 0, "not_configured"));

        cycle(&store, "working", T0);
        let view = snapshot_view(&store.conn(), store.org_id(), T0 + 1, true, false, Some("g".into())).unwrap();
        assert_eq!((view.page, view.generated.as_deref(), view.reader.state.as_str()), ("installed", Some("g"), "ok"));
        let task = &view.tasks[0];
        assert_eq!((task.word, task.kind.as_str(), task.project_name.as_deref()), ("working", "ship", Some("shop-9c2e")));
        assert_eq!(task.title.as_deref(), Some("Add a health check to the shop 9c2e"));
        assert_eq!(task.last_event_text.as_deref(), Some("working"), "the newest event that is not an order");

        cycle(&store, "done", T0 + 10);
        let done = snapshot_view(&store.conn(), store.org_id(), T0 + 7 * DAY_MS, true, true, None).unwrap();
        assert_eq!(done.tasks[0].word, "done");
        assert_eq!(done.tasks[0].pr.as_ref().map(|p| p.number), Some(12));
        let later = snapshot_view(&store.conn(), store.org_id(), T0 + 10 + 7 * DAY_MS + 1, true, true, None).unwrap();
        assert!(later.tasks.is_empty(), "done is shown for 7 days");

        cycle(&store, "empty", T0 + 20);
        let gone = snapshot_view(&store.conn(), store.org_id(), T0 + 21, true, true, None).unwrap();
        assert_eq!((gone.tasks[0].word, gone.tasks[0].overnight_word), ("gone", "done"));
    }

    #[test]
    fn waiting_counts_open() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let conn = store.conn();
        let org = store.org_id();
        let add = |key: &str, closed: Option<i64>, copied: Option<i64>| {
            conn.execute(
                "INSERT INTO crew_decisions (org_id, task_id, key, verb, summary, opened_at, closed_at, copied_at) VALUES (?1, 't', ?2, 'needs-decision', 's', 1, ?3, ?4)",
                params![org, key, closed, copied],
            )
            .unwrap();
        };
        assert_eq!(waiting(&conn, org).unwrap(), 0);
        add("open", None, None);
        add("copied", None, Some(5));
        add("closed", Some(9), None);
        assert_eq!(waiting(&conn, org).unwrap(), 2, "a copied row still counts; a closed one does not");
        let open = decisions(&conn, org, None).unwrap();
        assert_eq!(open.iter().map(|d| d.key.as_str()).collect::<Vec<_>>(), ["copied", "open"]);
        assert_eq!(open[0].copied_at, Some(5));
    }

    #[test]
    fn a_task_for_the_panel() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        assert!(task_view(&store.conn(), store.org_id(), "shop-health-9c2e", T0).unwrap().is_none(), "never held → None");

        cycle(&store, "queued", T0);
        cycle(&store, "working", T0 + 60_000);
        let d = task_view(&store.conn(), store.org_id(), "shop-health-9c2e", T0 + 60_001).unwrap().unwrap();
        assert_eq!(d.task.word, "working");
        assert_eq!(d.state_line.as_deref(), Some("state: working · source: status-log · running the tests 9c2e"));
        assert_eq!(d.state_observed_at.as_deref(), Some("2026-09-24T09:00:00Z"));
        assert_eq!((d.mode.as_deref(), d.yolo, d.backend.as_deref()), (Some("direct-pr"), false, Some("herdr")));
        assert_eq!(d.excerpt.as_deref(), Some("Delivery: direct-pr 9c2e."));
        assert_eq!(d.worktree_present, Some(true));
        assert_eq!(d.paths.worktree.as_deref(), Some("__ROOT__/.treehouse/shop-9c2e-000000/1/shop-9c2e"));
        assert_eq!(d.paths.report.as_deref(), Some("__FM_HOME__/data/shop-health-9c2e/report.md"));
        assert!(!d.report_present);
        let kinds: Vec<&str> = d.events.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, ["word", "last_event", "state", "word"], "oldest first");

        cycle(&store, "empty", T0 + 120_000);
        let gone = task_view(&store.conn(), store.org_id(), "shop-health-9c2e", T0 + 30 * DAY_MS).unwrap().unwrap();
        assert_eq!(gone.task.word, "gone", "a task long gone still opens");
    }
}
