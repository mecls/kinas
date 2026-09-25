//! The mirror's one write (build spec §6.7, §7): a cycle's fleet goes into the store in one transaction, beside its
//! `reader_status`. Tasks are upserted with Kinas's own stamps — when it first saw a task, first saw it working, saw it
//! done, saw it leave — and never deleted: a task the snapshot stops listing gains `gone_at`, cleared if it comes back.
//! Events append, deduplicated where Firstmate repeats itself. A failed cycle writes `reader_status` and nothing else.
//! What the cycle learned beside the fleet — Herdr's workers, each clone's repository, GitHub's PRs — arrives in
//! `Found`, all of it read before the guard was taken (§6.15).

use super::gh::{checks_text, PrFacts};
use super::snapshot::{pr_number, Fleet, TaskFacts};
use super::word::{word_of, word_without_gone, PrWordInput, WordInput};
use crate::redact::{write_reader_status, Outcome, Reader};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::{HashMap, HashSet};

/// The `age_seconds` bucket a `last_event` is deduplicated on: Firstmate reports the same event every cycle with a
/// growing age, and its emission time, `now − age`, jitters by a second or two between cycles.
const LAST_EVENT_BUCKET_S: i64 = 600;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Applied {
    pub tasks: usize,
    pub decisions: usize,
    pub events: usize,
}

/// What a cycle found beside the fleet, read with no guard held.
#[derive(Debug, Default)]
pub(crate) struct Found {
    pub workers: Vec<Worker>,
    /// Each task's repository by task id, from its clone (`crew::repo::clone_repo`): the `project` path, or for a task
    /// not yet spawned, `<home>/projects/<project name>`. None when the clone has no GitHub `origin`.
    pub repos: HashMap<String, Option<String>>,
    /// The PRs `gh` answered for this cycle; a PR it did not answer keeps its last values.
    pub prs: Vec<PrFacts>,
}

/// A cycle's outcome, written under the caller's one guard (§6.15): the fleet and a success, or an error and nothing
/// else — the mirror keeps its last good reading (ADR 0004).
pub(crate) fn record(conn: &mut Connection, org: &str, outcome: &Result<Fleet, String>, found: &Found, now: i64) -> rusqlite::Result<Option<Applied>> {
    let tx = conn.transaction()?;
    let applied = match outcome {
        Ok(fleet) => {
            let applied = apply(&tx, org, fleet, found, now)?;
            write_workers(&tx, org, &found.workers, now)?;
            write_reader_status(&tx, org, Reader::Crew, Outcome::Success, now)?;
            Some(applied)
        }
        Err(message) => {
            write_reader_status(&tx, org, Reader::Crew, Outcome::Error(message), now)?;
            None
        }
    };
    tx.commit()?;
    Ok(applied)
}

/// A worker's pane as Herdr shows it now: the pane behind a task's `endpoint.target`, in the session Kinas attaches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Worker {
    pub task_id: String,
    pub session: String,
    pub pane_id: String,
    pub workspace_id: Option<String>,
    pub tab_label: Option<String>,
}

/// The workers from the fleet and Herdr's view (§6.8): `endpoint.target` split at its first colon, only a target in
/// the attached session, only a pane Herdr has. Never matched by tab label or folder.
pub(crate) fn workers_of(fleet: &Fleet, view: Option<&crate::herdr::View>, session: Option<&str>) -> Vec<Worker> {
    let (Some(view), Some(session)) = (view, session) else { return Vec::new() };
    fleet
        .tasks
        .iter()
        .filter_map(|t| {
            let (s, pane) = super::snapshot::split_target(t.endpoint_target.as_deref()?)?;
            let found = view.pane(pane).filter(|_| s == session)?;
            Some(Worker { task_id: t.id.clone(), session: s.to_string(), pane_id: pane.to_string(), workspace_id: Some(found.workspace_id.clone()), tab_label: found.tab_label.clone() })
        })
        .collect()
}

/// `crew_workers` is a cache (§6.7): rewritten whole every cycle, and the one table that is.
fn write_workers(tx: &Transaction, org: &str, workers: &[Worker], now: i64) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM crew_workers WHERE org_id = ?1", params![org])?;
    for w in workers {
        tx.execute(
            "INSERT OR REPLACE INTO crew_workers (org_id, task_id, session, pane_id, workspace_id, tab_label, alive, foreground, observed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, NULL, ?7)",
            params![org, w.task_id, w.session, w.pane_id, w.workspace_id, w.tab_label, now],
        )?;
    }
    Ok(())
}

/// The columns a task's word is computed from, as the mirror holds them: the prior state before a cycle, and the
/// read side's word (`crew/read.rs`).
pub(crate) struct Stored {
    pub(crate) state: Option<String>,
    pub(crate) backlog_state: Option<String>,
    pub(crate) pending_decision: bool,
    pub(crate) captain_actionable: bool,
    pub(crate) blocked_event: bool,
    pub(crate) pr_url: Option<String>,
    pub(crate) pr_state: Option<String>,
    pub(crate) pr_draft: bool,
    pub(crate) pr_mergeable: Option<String>,
    pub(crate) pr_checks_total: Option<u32>,
    pub(crate) pr_checks_failed: Option<u32>,
    pub(crate) first_seen_at: i64,
    pub(crate) first_working_at: Option<i64>,
    pub(crate) done_at: Option<i64>,
    pub(crate) gone_at: Option<i64>,
}

impl Stored {
    pub(crate) fn input(&self) -> WordInput<'_> {
        WordInput {
            gone: self.gone_at.is_some(),
            done: self.done_at.is_some(),
            state: self.state.as_deref(),
            backlog_state: self.backlog_state.as_deref(),
            pending_decision: self.pending_decision,
            captain_actionable: self.captain_actionable,
            blocked_event: self.blocked_event,
            pr: self.pr_url.as_ref().map(|_| PrWordInput {
                state: self.pr_state.as_deref(),
                draft: self.pr_draft,
                mergeable: self.pr_mergeable.as_deref(),
                checks_total: self.pr_checks_total,
                checks_failed: self.pr_checks_failed,
            }),
        }
    }
}

/// Where a task's clone is: its `project`, or — for a task not yet spawned, which has only Firstmate's name for its
/// project — `<home>/projects/<name>`, when the name is one folder name. `repo::clone_repo` still checks the path.
pub(crate) fn clone_path(facts: &TaskFacts, home: &std::path::Path) -> Option<String> {
    if let Some(project) = &facts.project {
        return Some(project.clone());
    }
    let name = facts.project_name.as_deref()?;
    let one_folder = !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\0');
    one_folder.then(|| home.join("projects").join(name).display().to_string())
}

/// Done comes from the backlog: a worker whose own state is `done` may still be waiting for the captain to land it
/// (slice 0's held capture), so only a task with no backlog record is done on its state alone (§17).
pub(crate) fn done_now(facts: &TaskFacts) -> bool {
    facts.backlog_state.as_deref() == Some("done") || (facts.backlog_state.is_none() && facts.state.as_deref() == Some("done"))
}

pub(crate) fn apply(tx: &Transaction, org: &str, fleet: &Fleet, found: &Found, now: i64) -> rusqlite::Result<Applied> {
    let priors = priors(tx, org)?;
    let places = places(tx, org)?;
    let mut applied = Applied { tasks: fleet.tasks.len(), ..Applied::default() };
    let listed: HashSet<&str> = fleet.tasks.iter().map(|t| t.id.as_str()).collect();

    for facts in &fleet.tasks {
        let prior = priors.get(&facts.id);
        let working = facts.state.as_deref() == Some("working");
        let first_seen_at = prior.map_or(now, |p| p.first_seen_at);
        let first_working_at = prior.and_then(|p| p.first_working_at).or(working.then_some(now));
        let done_at = prior.and_then(|p| p.done_at).or(done_now(facts).then_some(now));
        upsert(tx, org, facts, &fleet.generated, first_seen_at, first_working_at, now, done_at)?;
        repository(tx, org, facts, places.get(&facts.id), found)?;
        applied.events += pull_request(tx, org, facts, prior, found, now)?;

        let after = priors_one(tx, org, &facts.id)?.expect("the row was just written");
        let word = word_of(&after.input());
        match prior {
            None => {
                if let Some(state) = facts.state.as_deref() {
                    applied.events += event(tx, org, &facts.id, now, "state", state, None)?;
                }
                applied.events += event(tx, org, &facts.id, now, "word", word, None)?;
            }
            Some(p) => {
                if p.gone_at.is_some() {
                    applied.events += event(tx, org, &facts.id, now, "returned", "back in the fleet snapshot", None)?;
                }
                if let Some(state) = facts.state.as_deref().filter(|s| p.state.as_deref() != Some(*s)) {
                    applied.events += event(tx, org, &facts.id, now, "state", state, None)?;
                }
                if word_without_gone(&p.input()) != word {
                    applied.events += event(tx, org, &facts.id, now, "word", word, None)?;
                }
            }
        }
        if let Some((raw, line, age)) = &facts.last_event {
            applied.events += last_event(tx, org, &facts.id, raw, line, *age, now)?;
        }
    }

    for (id, prior) in &priors {
        if prior.gone_at.is_none() && !listed.contains(id.as_str()) {
            tx.execute("UPDATE crew_tasks SET gone_at = ?3 WHERE org_id = ?1 AND id = ?2", params![org, id, now])?;
            applied.events += event(tx, org, id, now, "gone", "gone", None)?;
        }
    }
    Ok(applied)
}

/// A task's repository, from its clone (§7): written when its `project` moved to a new clone, or when none is known
/// yet and the clone names one — and kept when the snapshot stops naming the clone, so a finished task stays in its
/// lane.
fn repository(tx: &Transaction, org: &str, facts: &TaskFacts, place: Option<&Place>, found: &Found) -> rusqlite::Result<()> {
    let read = found.repos.get(&facts.id).cloned().flatten();
    let moved = facts.project.as_deref().is_some_and(|p| place.is_none_or(|(before, _)| before.as_deref() != Some(p)));
    let unknown = place.is_none_or(|(_, repo)| repo.is_none());
    if moved || (unknown && read.is_some()) {
        tx.execute("UPDATE crew_tasks SET repo = ?3 WHERE org_id = ?1 AND id = ?2", params![org, facts.id, read])?;
    }
    Ok(())
}

/// GitHub's word on a task's PR (§7): a new URL clears what `gh` said about the old one; `gh`'s answer this cycle sets
/// the state, mergeability, review and check counts. Events: `PR #123 opened` once per PR, and the checks line when it
/// changes. Returns how many events it added.
fn pull_request(tx: &Transaction, org: &str, facts: &TaskFacts, prior: Option<&Stored>, found: &Found, now: i64) -> rusqlite::Result<usize> {
    let Some(url) = facts.pr_url.as_deref() else { return Ok(0) };
    let mut added = 0;
    if prior.is_some_and(|p| p.pr_url.as_deref().is_some_and(|old| old != url)) {
        tx.execute(
            "UPDATE crew_tasks SET pr_state = NULL, pr_draft = NULL, pr_mergeable = NULL, pr_review = NULL, pr_checks_total = NULL,
               pr_checks_failed = NULL, pr_checked_at = NULL WHERE org_id = ?1 AND id = ?2",
            params![org, facts.id],
        )?;
    }
    if let Some(number) = pr_number(url) {
        added += event(tx, org, &facts.id, now, "pr", &format!("PR #{number} opened"), Some(url))?;
    }
    let Some(pr) = found.prs.iter().find(|p| p.url == url) else { return Ok(added) };
    let (total, failed) = (pr.checks_total(), pr.checks_failed());
    tx.execute(
        "UPDATE crew_tasks SET pr_state = ?3, pr_draft = ?4, pr_mergeable = ?5, pr_review = ?6, pr_checks_total = ?7,
           pr_checks_failed = ?8, pr_checked_at = ?9 WHERE org_id = ?1 AND id = ?2",
        params![org, facts.id, pr.state, pr.draft, pr.mergeable, pr.review, total, failed, now],
    )?;
    let before = prior
        .filter(|p| p.pr_url.as_deref() == Some(url))
        .and_then(|p| checks_text(p.pr_checks_total.unwrap_or(0), p.pr_checks_failed.unwrap_or(0)));
    if let Some(text) = checks_text(total, failed).filter(|t| before.as_ref() != Some(t)) {
        added += event(tx, org, &facts.id, now, "checks", &text, None)?;
    }
    Ok(added)
}

#[allow(clippy::too_many_arguments)]
fn upsert(
    tx: &Transaction,
    org: &str,
    f: &TaskFacts,
    generated: &str,
    first_seen_at: i64,
    first_working_at: Option<i64>,
    now: i64,
    done_at: Option<i64>,
) -> rusqlite::Result<()> {
    let pr_number = f.pr_url.as_deref().and_then(pr_number);
    tx.execute(
        "INSERT INTO crew_tasks (org_id, id, title, excerpt, project, project_name, kind, backlog_state, state, state_source,
           state_detail, state_observed_at, mode, yolo, harness, backend, endpoint_target, endpoint_exists, endpoint_status,
           worktree_path, worktree_present, report_path, report_present, pr_url, pr_number, pending_decision, blocked_event,
           captain_actionable, hold_reason, snapshot_generated, first_seen_at, first_working_at, last_seen_at, done_at, gone_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23,
           ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, NULL)
         ON CONFLICT (org_id, id) DO UPDATE SET
           title = excluded.title, excerpt = excluded.excerpt, project = excluded.project,
           project_name = excluded.project_name, kind = excluded.kind, backlog_state = excluded.backlog_state,
           state = excluded.state, state_source = excluded.state_source, state_detail = excluded.state_detail,
           state_observed_at = excluded.state_observed_at, mode = excluded.mode, yolo = excluded.yolo,
           harness = excluded.harness, backend = excluded.backend, endpoint_target = excluded.endpoint_target,
           endpoint_exists = excluded.endpoint_exists, endpoint_status = excluded.endpoint_status,
           worktree_path = excluded.worktree_path, worktree_present = excluded.worktree_present,
           report_path = excluded.report_path, report_present = excluded.report_present, pr_url = excluded.pr_url,
           pr_number = excluded.pr_number, pending_decision = excluded.pending_decision,
           blocked_event = excluded.blocked_event, captain_actionable = excluded.captain_actionable,
           hold_reason = excluded.hold_reason, snapshot_generated = excluded.snapshot_generated,
           first_working_at = excluded.first_working_at, last_seen_at = excluded.last_seen_at,
           done_at = excluded.done_at, gone_at = NULL",
        params![
            org,
            f.id,
            f.title,
            f.excerpt,
            f.project,
            f.project_name,
            f.kind,
            f.backlog_state,
            f.state,
            f.state_source,
            f.state_detail,
            f.state_observed_at,
            f.mode,
            f.yolo,
            f.harness,
            f.backend,
            f.endpoint_target,
            f.endpoint_exists,
            f.endpoint_status,
            f.worktree_path,
            f.worktree_present,
            f.report_path,
            f.report_present,
            f.pr_url,
            pr_number,
            f.pending_decision,
            f.blocked_event,
            f.captain_actionable,
            f.hold_reason,
            generated,
            first_seen_at,
            first_working_at,
            now,
            done_at,
        ],
    )?;
    Ok(())
}

/// One appended event; with a dedupe key, a repeat is ignored. Returns how many rows it added.
fn event(tx: &Transaction, org: &str, task: &str, at: i64, kind: &str, text: &str, dedupe_key: Option<&str>) -> rusqlite::Result<usize> {
    tx.execute(
        "INSERT OR IGNORE INTO crew_events (org_id, task_id, at, kind, text, dedupe_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![org, task, at, kind, text, dedupe_key],
    )
}

/// Firstmate's last event, once: the key is its raw line plus its emission time's bucket, and an event whose raw line
/// matches the task's newest one within a bucket either side is the same event seen again.
fn last_event(tx: &Transaction, org: &str, task: &str, raw: &str, line: &str, age: Option<i64>, now: i64) -> rusqlite::Result<usize> {
    let at = age.filter(|a| *a >= 0).map_or(now, |a| now - a * 1_000);
    let bucket = at.div_euclid(1_000 * LAST_EVENT_BUCKET_S);
    let newest: Option<String> = tx
        .query_row(
            "SELECT dedupe_key FROM crew_events WHERE org_id = ?1 AND task_id = ?2 AND kind = 'last_event' ORDER BY at DESC, id DESC LIMIT 1",
            params![org, task],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    if let Some((b, r)) = newest.as_deref().and_then(|k| k.split_once('|')) {
        if r == raw && b.parse::<i64>().is_ok_and(|b| (b - bucket).abs() <= 1) {
            return Ok(0);
        }
    }
    event(tx, org, task, at, "last_event", line, Some(&format!("{bucket}|{raw}")))
}

fn priors(conn: &Connection, org: &str) -> rusqlite::Result<HashMap<String, Stored>> {
    let mut stmt = conn.prepare(&format!("SELECT id, {STORED_COLUMNS} FROM crew_tasks WHERE org_id = ?1"))?;
    let rows = stmt.query_map(params![org], |r| Ok((r.get::<_, String>(0)?, stored_of(r, 1)?)))?;
    rows.collect()
}

/// A task's `project` and `repo` as the mirror holds them.
type Place = (Option<String>, Option<String>);

/// Each task's place before a cycle.
fn places(conn: &Connection, org: &str) -> rusqlite::Result<HashMap<String, Place>> {
    let mut stmt = conn.prepare("SELECT id, project, repo FROM crew_tasks WHERE org_id = ?1")?;
    let rows = stmt.query_map(params![org], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?;
    rows.collect()
}

fn priors_one(conn: &Connection, org: &str, id: &str) -> rusqlite::Result<Option<Stored>> {
    conn.query_row(&format!("SELECT {STORED_COLUMNS} FROM crew_tasks WHERE org_id = ?1 AND id = ?2"), params![org, id], |r| stored_of(r, 0))
        .optional()
}

pub(crate) const STORED_COLUMNS: &str = "state, backlog_state, pending_decision, captain_actionable, blocked_event, pr_url, pr_state, pr_draft,
    pr_mergeable, pr_checks_total, pr_checks_failed, first_seen_at, first_working_at, done_at, gone_at";

pub(crate) fn stored_of(r: &rusqlite::Row, at: usize) -> rusqlite::Result<Stored> {
    Ok(Stored {
        state: r.get(at)?,
        backlog_state: r.get(at + 1)?,
        pending_decision: r.get(at + 2)?,
        captain_actionable: r.get(at + 3)?,
        blocked_event: r.get(at + 4)?,
        pr_url: r.get(at + 5)?,
        pr_state: r.get(at + 6)?,
        pr_draft: r.get::<_, Option<bool>>(at + 7)?.unwrap_or(false),
        pr_mergeable: r.get(at + 8)?,
        pr_checks_total: r.get(at + 9)?,
        pr_checks_failed: r.get(at + 10)?,
        first_seen_at: r.get(at + 11)?,
        first_working_at: r.get(at + 12)?,
        done_at: r.get(at + 13)?,
        gone_at: r.get(at + 14)?,
    })
}

#[cfg(test)]
mod tests {
    use super::super::snapshot::parse_fleet;
    use super::*;
    use crate::store::Store;

    const MIN: i64 = 60_000;
    const T0: i64 = 1_790_000_000_000;
    const ID: &str = "shop-health-9c2e";

    fn fleet(name: &str) -> Fleet {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/crew-snapshot.{name}.synthetic.json"));
        parse_fleet(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn cycle(store: &Store, name: &str, now: i64) -> Applied {
        let mut conn = store.conn();
        record(&mut conn, store.org_id(), &Ok(fleet(name)), &Found::default(), now).unwrap().unwrap()
    }

    type Row = (Option<String>, Option<String>, i64, Option<i64>, i64, Option<i64>, Option<i64>);

    fn row(store: &Store) -> Row {
        store
            .conn()
            .query_row(
                "SELECT state, backlog_state, first_seen_at, first_working_at, last_seen_at, done_at, gone_at FROM crew_tasks WHERE id = ?1",
                params![ID],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .unwrap()
    }

    fn events(store: &Store) -> Vec<(i64, String, String)> {
        let conn = store.conn();
        let mut stmt = conn.prepare("SELECT at, kind, text FROM crew_events WHERE task_id = ?1 ORDER BY id").unwrap();
        let rows = stmt.query_map(params![ID], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        rows.collect::<Result<_, _>>().unwrap()
    }

    fn word(store: &Store) -> &'static str {
        let conn = store.conn();
        let p = priors_one(&conn, store.org_id(), ID).unwrap().unwrap();
        word_of(&p.input())
    }

    fn ev(at: i64, kind: &str, text: &str) -> (i64, String, String) {
        (at, kind.into(), text.into())
    }

    #[test]
    fn a_task_from_queued_to_gone() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();

        let t1 = T0;
        assert_eq!(cycle(&store, "queued", t1), Applied { tasks: 1, decisions: 0, events: 1 });
        assert_eq!(row(&store), (None, Some("queued".into()), t1, None, t1, None, None));
        assert_eq!(word(&store), "queued");

        let t2 = T0 + 5 * MIN;
        cycle(&store, "working", t2);
        assert_eq!(row(&store), (Some("working".into()), Some("in_flight".into()), t1, Some(t2), t2, None, None));
        assert_eq!(word(&store), "working");
        // The same working snapshot again, its last event 30 s older: nothing new.
        assert_eq!(cycle(&store, "working", t2 + 30_000).events, 0);

        let t3 = T0 + 40 * MIN;
        cycle(&store, "done", t3);
        assert_eq!(row(&store), (None, Some("done".into()), t1, Some(t2), t3, Some(t3), None));
        assert_eq!(word(&store), "done");

        let t4 = T0 + 50 * MIN;
        cycle(&store, "empty", t4);
        assert_eq!(row(&store).6, Some(t4), "absent from the snapshot → gone, never deleted");
        assert_eq!(word(&store), "gone");
        assert_eq!(cycle(&store, "empty", t4 + MIN).events, 0, "gone once");

        let expected = vec![
            ev(t1, "word", "queued"),
            ev(t2, "state", "working"),
            ev(t2, "word", "working"),
            ev(t2 - 30_000, "last_event", "working: running the tests 9c2e"),
            ev(t3, "pr", "PR #12 opened"),
            ev(t3, "word", "done"),
            ev(t4, "gone", "gone"),
        ];
        assert_eq!(events(&store), expected);

        // Dropped and reopened: the mirror is exactly as it was.
        let before = (row(&store), events(&store));
        drop(store);
        let store = Store::open(dir.path()).unwrap();
        assert_eq!((row(&store), events(&store)), before);

        // Back in the snapshot: gone is cleared on the same row, and it says so.
        let t5 = T0 + 60 * MIN;
        cycle(&store, "done", t5);
        let r = row(&store);
        assert_eq!((r.2, r.5, r.6), (t1, Some(t3), None));
        assert_eq!(word(&store), "done");
        assert_eq!(events(&store).last(), Some(&ev(t5, "returned", "back in the fleet snapshot")));
        assert_eq!(store.conn().query_row("SELECT count(*) FROM crew_tasks", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn a_held_worker_that_says_done_is_not_done() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/firstmate-fleet-snapshot.held.captured.json");
        let held = parse_fleet(&std::fs::read_to_string(path).unwrap()).unwrap();
        record(&mut store.conn(), store.org_id(), &Ok(held), &Found::default(), T0).unwrap();
        let conn = store.conn();
        let ship = priors_one(&conn, store.org_id(), "scratch-readme-kinas-r8").unwrap().unwrap();
        assert_eq!((ship.done_at, word_of(&ship.input())), (None, "needs decision"));
        let scout = priors_one(&conn, store.org_id(), "scratch-count-files-c4").unwrap().unwrap();
        assert_eq!((scout.done_at, word_of(&scout.input())), (Some(T0), "done"));
    }

    #[test]
    fn workers_are_the_targets_herdr_has_in_the_attached_session() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/herdr-api-snapshot.captured.json");
        let view = crate::herdr::parse_view(&std::fs::read_to_string(path).unwrap()).unwrap();
        let fleet = fleet("working");
        // The fixture's target is kinas-e2e-crew:w2:p2; the capture's pane w2:p2 carries the tab fm-scratch-count-files-c4.
        let workers = workers_of(&fleet, Some(&view), Some("kinas-e2e-crew"));
        assert_eq!(workers.len(), 1);
        assert_eq!((workers[0].pane_id.as_str(), workers[0].tab_label.as_deref()), ("w2:p2", Some("fm-scratch-count-files-c4")));
        assert!(workers_of(&fleet, Some(&view), Some("default")).is_empty(), "another session's pane has no button");
        assert!(workers_of(&fleet, None, Some("kinas-e2e-crew")).is_empty(), "no Herdr answer, no workers");

        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        record(&mut store.conn(), store.org_id(), &Ok(fleet.clone()), &Found { workers, ..Found::default() }, T0).unwrap();
        record(&mut store.conn(), store.org_id(), &Ok(fleet), &Found::default(), T0 + MIN).unwrap();
        let n: i64 = store.conn().query_row("SELECT count(*) FROM crew_workers", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "the cache is rewritten whole each cycle");
    }

    /// A synthetic snapshot with Firstmate's home at `home`, edited as a JSON value first.
    fn fleet_at(name: &str, home: &std::path::Path, edit: impl Fn(&mut serde_json::Value)) -> Fleet {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/crew-snapshot.{name}.synthetic.json"));
        let text = std::fs::read_to_string(path).unwrap().replace("__FM_HOME__", &home.display().to_string());
        let mut v: serde_json::Value = serde_json::from_str(&text).unwrap();
        edit(&mut v);
        parse_fleet(&v.to_string()).unwrap()
    }

    /// Each clone's repository, as the collector reads it before the guard.
    fn found(fleet: &Fleet, home: &std::path::Path, prs: Vec<PrFacts>) -> Found {
        let repos = fleet
            .tasks
            .iter()
            .filter_map(|t| Some((t.id.clone(), crate::crew::repo::clone_repo(home, &clone_path(t, home)?))))
            .collect();
        Found { repos, prs, ..Found::default() }
    }

    fn clone_with(dir: &std::path::Path, config: &str) {
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::write(dir.join(".git").join("config"), config).unwrap();
    }

    fn repo_of(store: &Store) -> Option<String> {
        store.conn().query_row("SELECT repo FROM crew_tasks WHERE id = ?1", params![ID], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_task_repository_from_its_clone() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let home = tempfile::tempdir().unwrap();
        clone_with(&home.path().join("projects").join("shop-9c2e"), "[remote \"origin\"]\n\turl = git@github.com:Acme-9c2e/shop-9c2e.git\n");
        let apply = |fleet: Fleet, now: i64| {
            let f = found(&fleet, home.path(), Vec::new());
            record(&mut store.conn(), store.org_id(), &Ok(fleet), &f, now).unwrap();
        };

        apply(fleet_at("queued", home.path(), |v| v["backlog"]["records"][0]["repo"] = "nowhere-9c2e".into()), T0);
        assert_eq!(repo_of(&store), None, "queued on a project Firstmate has no clone of");
        apply(fleet_at("queued", home.path(), |_| {}), T0 + MIN / 2);
        assert_eq!(repo_of(&store).as_deref(), Some("acme-9c2e/shop-9c2e"), "queued: its project's clone, by Firstmate's name for it");
        apply(fleet_at("working", home.path(), |_| {}), T0 + MIN);
        assert_eq!(repo_of(&store).as_deref(), Some("acme-9c2e/shop-9c2e"), "from the clone's origin");
        apply(fleet_at("done", home.path(), |_| {}), T0 + 2 * MIN);
        assert_eq!(repo_of(&store).as_deref(), Some("acme-9c2e/shop-9c2e"), "kept when the snapshot stops naming the clone");

        // A project outside the home's projects: never read, even though its config names a repository.
        let elsewhere = tempfile::tempdir().unwrap();
        clone_with(elsewhere.path(), "[remote \"origin\"]\n\turl = https://github.com/o/elsewhere-9c2e\n");
        let outside = elsewhere.path().display().to_string();
        apply(fleet_at("working", home.path(), |v| v["tasks"][0]["project"] = outside.clone().into()), T0 + 3 * MIN);
        assert_eq!(repo_of(&store), None, "a moved project is read again, and outside the home it is nothing");

        // A clone with no origin: the lane falls back to the project's folder name.
        let delta = home.path().join("projects").join("delta-9c2e");
        clone_with(&delta, "[core]\n\tbare = false\n");
        let delta = delta.display().to_string();
        apply(fleet_at("working", home.path(), |v| v["tasks"][0]["project"] = delta.clone().into()), T0 + 4 * MIN);
        assert_eq!(repo_of(&store), None);
        let name: Option<String> = store.conn().query_row("SELECT project_name FROM crew_tasks WHERE id = ?1", params![ID], |r| r.get(0)).unwrap();
        assert_eq!(name.as_deref(), Some("delta-9c2e"));
    }

    #[test]
    fn a_pr_its_checks_and_their_events() {
        const URL: &str = "https://github.com/acme-9c2e/shop-9c2e/pull/123";
        let gh = |n: u32| {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/crew-gh-{n}.json"));
            super::super::gh::parse(URL, &std::fs::read_to_string(path).unwrap()).unwrap()
        };
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let home = tempfile::tempdir().unwrap();
        let with_pr = || fleet_at("working", home.path(), |v| v["tasks"][0]["pr"]["url"] = URL.into());
        let cycle_with = |prs: Vec<PrFacts>, now: i64| {
            let fleet = with_pr();
            let f = found(&fleet, home.path(), prs);
            record(&mut store.conn(), store.org_id(), &Ok(fleet), &f, now).unwrap();
        };

        cycle(&store, "working", T0);
        cycle_with(Vec::new(), T0 + MIN);
        assert_eq!(word(&store), "PR open", "the URL alone, before gh answers");
        cycle_with(vec![gh(1)], T0 + 2 * MIN);
        assert_eq!(word(&store), "CI red");
        cycle_with(vec![gh(2)], T0 + 3 * MIN);
        assert_eq!(word(&store), "ready");
        cycle_with(Vec::new(), T0 + 4 * MIN);
        assert_eq!(word(&store), "ready", "gh not answering keeps the last values");
        cycle_with(vec![gh(2)], T0 + 5 * MIN);

        let kinds = |kind: &str| events(&store).into_iter().filter(|e| e.1 == kind).map(|e| e.2).collect::<Vec<_>>();
        assert_eq!(kinds("pr"), ["PR #123 opened"]);
        assert_eq!(kinds("checks"), ["checks 3/4 · 1 failing", "checks 4/4"]);
        let (review, checked): (Option<String>, Option<i64>) =
            store.conn().query_row("SELECT pr_review, pr_checked_at FROM crew_tasks WHERE id = ?1", params![ID], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((review.as_deref(), checked), (Some("APPROVED"), Some(T0 + 5 * MIN)));

        // Another PR: what gh said of the old one is gone until gh speaks of the new one.
        let other = "https://github.com/acme-9c2e/shop-9c2e/pull/124";
        let fleet = fleet_at("working", home.path(), |v| v["tasks"][0]["pr"]["url"] = other.into());
        record(&mut store.conn(), store.org_id(), &Ok(fleet), &Found::default(), T0 + 6 * MIN).unwrap();
        assert_eq!(word(&store), "PR open");
        assert_eq!(kinds("pr"), ["PR #123 opened", "PR #124 opened"]);
    }

    #[test]
    fn a_failed_cycle_writes_only_status() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        cycle(&store, "working", T0);
        let snapshot = |store: &Store| -> (Row, Vec<(i64, String, String)>, Option<i64>) {
            let success = store.conn().query_row("SELECT last_success_at FROM reader_status WHERE reader = 'crew'", [], |r| r.get(0)).unwrap();
            (row(store), events(store), success)
        };
        let before = snapshot(&store);
        assert_eq!(before.2, Some(T0));

        let refused = parse_fleet(r#"{"schema":"fm-fleet-snapshot.v2"}"#);
        let written = record(&mut store.conn(), store.org_id(), &refused, &Found::default(), T0 + MIN).unwrap();
        assert_eq!(written, None);
        assert_eq!(snapshot(&store), before, "every crew row as it was, and the last success kept");
        let (state, attempt, error): (String, i64, String) = store
            .conn()
            .query_row("SELECT state, last_attempt_at, last_error FROM reader_status WHERE reader = 'crew'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((state.as_str(), attempt), ("error", T0 + MIN));
        assert_eq!(error, "unsupported snapshot contract fm-fleet-snapshot.v2, expected fm-fleet-snapshot.v1");
    }
}
