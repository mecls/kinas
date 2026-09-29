//! What a page showed finished (done work clears, `tasks/crew-done-clears/prd.md` rules 4–6): the Crew page's board and
//! Home's Overnight each stamp, once, the moment they first showed a task finished, and leave it out from their next
//! load. Kinas's own stamps, as `copied_at` is (`answer.rs`); the row is never deleted, and an unfinished task is never
//! stamped, whatever the page sends.

use super::CrewError;
use crate::readers::crew::mirror::priors_one;
use crate::readers::crew::word::finished;
use rusqlite::{params, Connection};
use serde::Deserialize;

/// The two pages that clear what they have shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Surface {
    Board,
    Overnight,
}

impl Surface {
    fn column(self) -> &'static str {
        match self {
            Surface::Board => "board_seen_at",
            Surface::Overnight => "overnight_seen_at",
        }
    }
}

/// At most this many ids in one call: a page shows a few dozen cards.
pub const SEEN_MAX: usize = 500;

/// Refuses a call naming more than `SEEN_MAX` tasks, before the store is touched.
pub(crate) fn within_limit(ids: &[String]) -> Result<(), CrewError> {
    if ids.len() > SEEN_MAX {
        return Err(CrewError { code: "too_many", message: format!("At most {SEEN_MAX} tasks at a time") });
    }
    Ok(())
}

/// Stamps `<surface>_seen_at = now` on each named task still finished and not stamped for that surface yet; an id the
/// store does not hold is skipped. Answers how many it stamped.
pub(crate) fn seen(conn: &Connection, org: &str, surface: Surface, ids: &[String], now: i64) -> rusqlite::Result<usize> {
    let column = surface.column();
    let mut stamped = 0;
    for id in ids {
        if !priors_one(conn, org, id)?.is_some_and(|row| finished(&row.input())) {
            continue;
        }
        stamped += conn.execute(&format!("UPDATE crew_tasks SET {column} = ?3 WHERE org_id = ?1 AND id = ?2 AND {column} IS NULL"), params![org, id, now])?;
    }
    Ok(stamped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    /// A task row as the mirror would hold it: its backlog state, done, gone, and its PR's last reading.
    fn task(store: &Store, id: &str, backlog: &str, done: bool, gone: bool, pr_state: Option<&str>) {
        store
            .conn()
            .execute(
                "INSERT INTO crew_tasks (org_id, id, kind, backlog_state, state, snapshot_generated, first_seen_at, last_seen_at, done_at, gone_at,
                   pr_url, pr_number, pr_state)
                 VALUES (?1, ?2, 'ship', ?3, ?3, 'g', 1, 1, ?4, ?5, ?6, ?7, ?8)",
                params![
                    store.org_id(),
                    id,
                    backlog,
                    done.then_some(10_i64),
                    gone.then_some(20_i64),
                    pr_state.map(|_| "https://github.com/o/shop-9c2e/pull/7"),
                    pr_state.map(|_| 7),
                    pr_state,
                ],
            )
            .unwrap();
    }

    fn stamps(store: &Store, id: &str) -> (Option<i64>, Option<i64>) {
        store.conn().query_row("SELECT board_seen_at, overnight_seen_at FROM crew_tasks WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn seen_stamps_finished_tasks_once_per_surface() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        task(&store, "done-9c2e", "done", true, false, None);
        task(&store, "gone-9c2e", "in_flight", false, true, None);
        task(&store, "merged-9c2e", "done", true, false, Some("MERGED"));
        let org = store.org_id();

        assert_eq!(seen(&store.conn(), org, Surface::Board, &ids(&["done-9c2e", "gone-9c2e", "merged-9c2e"]), 100).unwrap(), 3);
        assert_eq!(stamps(&store, "done-9c2e"), (Some(100), None), "the board's stamp, not Overnight's");
        assert_eq!(stamps(&store, "gone-9c2e"), (Some(100), None));
        // Once: a second showing leaves the first moment.
        assert_eq!(seen(&store.conn(), org, Surface::Board, &ids(&["done-9c2e"]), 200).unwrap(), 0);
        assert_eq!(stamps(&store, "done-9c2e"), (Some(100), None));
        // Overnight stamps apart.
        assert_eq!(seen(&store.conn(), org, Surface::Overnight, &ids(&["done-9c2e"]), 300).unwrap(), 1);
        assert_eq!(stamps(&store, "done-9c2e"), (Some(100), Some(300)));
    }

    #[test]
    fn seen_never_stamps_an_unfinished_task() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        task(&store, "working-9c2e", "in_flight", false, false, None);
        task(&store, "open-9c2e", "done", true, false, Some("OPEN"));
        let asked = ids(&["working-9c2e", "open-9c2e"]);
        assert_eq!(seen(&store.conn(), store.org_id(), Surface::Board, &asked, 100).unwrap(), 0);
        assert_eq!(seen(&store.conn(), store.org_id(), Surface::Overnight, &asked, 100).unwrap(), 0);
        assert_eq!(stamps(&store, "working-9c2e"), (None, None));
        assert_eq!(stamps(&store, "open-9c2e"), (None, None), "done, but its PR is open: not finished, never stamped");
    }

    #[test]
    fn seen_skips_unknown_ids_and_refuses_too_many() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        task(&store, "done-9c2e", "done", true, false, None);
        assert_eq!(seen(&store.conn(), store.org_id(), Surface::Board, &ids(&["never-9c2e", "done-9c2e"]), 100).unwrap(), 1);
        assert!(within_limit(&vec!["x".to_string(); SEEN_MAX]).is_ok());
        assert_eq!(within_limit(&vec!["x".to_string(); SEEN_MAX + 1]).unwrap_err().code, "too_many");
    }
}
