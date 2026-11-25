//! The single writer of `kinas.sqlite` (PRD R7–R10).

use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

/// Every migration, in order. Forward-only: shipped entries are never edited (R10).
pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../../migrations/0001_init.sql")),
    (2, include_str!("../../../migrations/0002_usage_details.sql")),
    (3, include_str!("../../../migrations/0003_provider_metrics.sql")),
    (4, include_str!("../../../migrations/0004_hostinger.sql")),
    (5, include_str!("../../../migrations/0005_crew.sql")),
    (6, include_str!("../../../migrations/0006_crew_seen.sql")),
    (7, include_str!("../../../migrations/0007_crew_current.sql")),
    (8, include_str!("../../../migrations/0008_cloud_factory.sql")),
    (9, include_str!("../../../migrations/0009_crew_review.sql")),
];

pub const DB_FILE: &str = "kinas.sqlite";

/// Settings written with the org on first launch (PRD §3.1 step 2). Values are JSON.
const DEFAULT_SETTINGS: &[(&str, &str)] = &[
    ("menu_bar_quota", r#""claude-plan/session""#),
    ("global_hotkey", r#""Cmd+Shift+Space""#),
    ("launch_at_login", "true"),
];

pub struct Store {
    conn: Mutex<Connection>,
    org_id: String,
    path: PathBuf,
}

impl Store {
    /// Opens or creates the store in `dir`: WAL, busy timeout, persistent WAL files, migrations,
    /// and exactly one org row.
    pub fn open(dir: &Path) -> Result<Store, String> {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        let path = dir.join(DB_FILE);
        let mut conn = Connection::open(&path).map_err(|e| e.to_string())?;

        let mode: String = conn
            .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(format!("journal_mode is {mode}, expected wal"));
        }
        conn.busy_timeout(Duration::from_millis(2000))
            .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys=ON")
            .map_err(|e| e.to_string())?;
        persist_wal(&conn)?;

        migrate(&mut conn)?;
        let org_id = ensure_org(&mut conn)?;
        Ok(Store { conn: Mutex::new(conn), org_id, path })
    }

    pub fn org_id(&self) -> &str {
        &self.org_id
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Keeps `-wal` and `-shm` on disk after the last connection closes. Without them a read-only open
/// (the CLI) fails with "unable to open database file" while the app is quit — measured in task 1.7.
fn persist_wal(conn: &Connection) -> Result<(), String> {
    let mut on: std::ffi::c_int = 1;
    // SAFETY: the handle belongs to an open connection and `on` outlives the call.
    let rc = unsafe {
        rusqlite::ffi::sqlite3_file_control(
            conn.handle(),
            c"main".as_ptr(),
            rusqlite::ffi::SQLITE_FCNTL_PERSIST_WAL,
            (&mut on as *mut std::ffi::c_int).cast(),
        )
    };
    if rc == rusqlite::ffi::SQLITE_OK {
        Ok(())
    } else {
        Err(format!("SQLITE_FCNTL_PERSIST_WAL failed with code {rc}"))
    }
}

fn migrate(conn: &mut Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           applied_at INTEGER NOT NULL
         )",
    )
    .map_err(|e| e.to_string())?;
    let current: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let newest = MIGRATIONS.last().map(|(v, _)| *v).unwrap_or(0);
    if current > newest {
        return Err(format!(
            "the store's schema is version {current}, newer than this app (version {newest})"
        ));
    }
    for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v > current) {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(sql)
            .map_err(|e| format!("migration {version} failed: {e}"))?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![version, now_ms()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Returns the one org id, creating it (and the default settings) on first launch (R9).
fn ensure_org(conn: &mut Connection) -> Result<String, String> {
    let count: i64 = conn
        .query_row("SELECT count(*) FROM orgs", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count > 1 {
        return Err(format!("the store holds {count} orgs; Build 1 requires exactly one"));
    }
    let existing: Option<String> = conn
        .query_row("SELECT id FROM orgs LIMIT 1", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = uuid::Uuid::now_v7().to_string();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO orgs (id, name, created_at) VALUES (?1, 'default', ?2)",
        params![id, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    for (key, value) in DEFAULT_SETTINGS {
        tx.execute(
            "INSERT INTO settings (org_id, key, value) VALUES (?1, ?2, ?3)",
            params![id, key, value],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count(store: &Store, sql: &str) -> i64 {
        store.conn().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn fresh_store_has_one_org_wal_and_latest_schema() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(count(&store, "SELECT count(*) FROM orgs"), 1);
        assert_eq!(count(&store, "SELECT MAX(version) FROM schema_migrations"), MIGRATIONS.last().unwrap().0);
        let mode: String = store.conn().query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(mode, "wal");
        assert_eq!(count(&store, "SELECT count(*) FROM settings"), DEFAULT_SETTINGS.len() as i64);
    }

    #[test]
    fn reopening_keeps_one_org_and_applies_nothing_twice() {
        let dir = tempfile::tempdir().unwrap();
        let first_id = Store::open(dir.path()).unwrap().org_id().to_string();
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(store.org_id(), first_id);
        assert_eq!(count(&store, "SELECT count(*) FROM orgs"), 1);
        assert_eq!(count(&store, "SELECT count(*) FROM schema_migrations"), MIGRATIONS.len() as i64);
    }

    #[test]
    fn org_id_is_not_null_on_every_table_except_orgs_and_schema_migrations() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        // The exact query from PRD §5.2.
        let missing = count(
            &store,
            "SELECT count(*) FROM sqlite_master m
             WHERE m.type = 'table' AND m.name NOT IN ('orgs','schema_migrations','sqlite_sequence')
               AND NOT EXISTS (SELECT 1 FROM pragma_table_info(m.name) p WHERE p.name = 'org_id' AND p.\"notnull\" = 1)",
        );
        assert_eq!(missing, 0);
    }

    #[test]
    fn wal_files_survive_the_last_close() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        store.conn().execute("UPDATE orgs SET name = 'x'", []).unwrap();
        drop(store);
        assert!(dir.path().join("kinas.sqlite-wal").exists(), "-wal was deleted on close");
        assert!(dir.path().join("kinas.sqlite-shm").exists(), "-shm was deleted on close");
    }

    #[test]
    fn a_store_newer_than_the_app_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        store
            .conn()
            .execute("INSERT INTO schema_migrations (version, applied_at) VALUES (999, 0)", [])
            .unwrap();
        drop(store);
        let err = Store::open(dir.path()).err().expect("newer schema must be refused");
        assert!(err.contains("newer than this app"), "{err}");
    }

    #[test]
    fn every_migration_file_is_listed_in_order() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../migrations");
        let mut files: Vec<i64> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| n.ends_with(".sql"))
            .map(|n| n[..4].parse().unwrap())
            .collect();
        files.sort();
        let listed: Vec<i64> = MIGRATIONS.iter().map(|(v, _)| *v).collect();
        assert_eq!(files, listed);
    }

    /// hostinger R15: a store written by the previous build upgrades in place, keeps its rows, and only then
    /// accepts the new reader id.
    ///
    /// Both halves are load-bearing. An upgrade that dropped `reader_status` and recreated it empty would still
    /// let the final insert succeed, so the *surviving row* is what proves the rebuild copied rather than
    /// recreated — which is the one thing a create/INSERT…SELECT/drop/rename can get wrong silently.
    #[test]
    fn upgrading_from_v3_keeps_reader_status_rows_and_admits_hostinger() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DB_FILE);
        {
            let mut conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)")
                .unwrap();
            for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 3) {
                let tx = conn.transaction().unwrap();
                tx.execute_batch(sql).unwrap();
                tx.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 0)", params![version]).unwrap();
                tx.commit().unwrap();
            }
            conn.execute("INSERT INTO orgs (id, name, created_at) VALUES ('org-1', 'test', 0)", []).unwrap();
            conn.execute(
                "INSERT INTO reader_status (org_id, reader, state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms)
                 VALUES ('org-1', 'convex', 'ok', 11, 22, NULL, 600000, 43200000)",
                [],
            )
            .unwrap();
            // The CHECK is precisely what 0004 widens: at v3 this id must be refused, or the migration is pointless.
            let refused = conn.execute(
                "INSERT INTO reader_status (org_id, reader, state, stale_after_ms, dead_after_ms)
                 VALUES ('org-1', 'hostinger', 'ok', 600000, 43200000)",
                [],
            );
            assert!(refused.is_err(), "v3 accepted 'hostinger' — then 0004 is not testing what it claims");
        }

        let store = Store::open(dir.path()).unwrap();
        assert_eq!(count(&store, "SELECT MAX(version) FROM schema_migrations"), MIGRATIONS.last().unwrap().0);
        assert_eq!(count(&store, "SELECT count(*) FROM orgs"), 1, "the upgrade must not mint a second org");

        let (state, last_success): (String, i64) = store
            .conn()
            .query_row("SELECT state, last_success_at FROM reader_status WHERE reader = 'convex'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((state.as_str(), last_success), ("ok", 22), "the rebuild lost or altered the existing row");

        store
            .conn()
            .execute(
                "INSERT INTO reader_status (org_id, reader, state, stale_after_ms, dead_after_ms)
                 VALUES ('org-1', 'hostinger', 'ok', 600000, 43200000)",
                [],
            )
            .expect("v4 must accept the reader id 'hostinger'");
    }

    /// The first mate (build spec §11.2): a store written by the previous build upgrades in place — its rows kept,
    /// `reader_status` rebuilt by copy — and only then admits the reader id 'crew' and the four mirror tables. The
    /// same two halves as the v3 test above, for the same reason.
    #[test]
    fn upgrading_from_v4_keeps_rows_and_admits_crew() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DB_FILE);
        {
            let mut conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)")
                .unwrap();
            for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 4) {
                let tx = conn.transaction().unwrap();
                tx.execute_batch(sql).unwrap();
                tx.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 0)", params![version]).unwrap();
                tx.commit().unwrap();
            }
            conn.execute("INSERT INTO orgs (id, name, created_at) VALUES ('org-1', 'test', 0)", []).unwrap();
            conn.execute("INSERT INTO settings (org_id, key, value) VALUES ('org-1', 'appearance', '\"dark\"')", []).unwrap();
            conn.execute(
                "INSERT INTO reader_status (org_id, reader, state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms)
                 VALUES ('org-1', 'hostinger', 'error', 33, 22, 'HTTP 401', 600000, 43200000)",
                [],
            )
            .unwrap();
            let refused = conn.execute(
                "INSERT INTO reader_status (org_id, reader, state, stale_after_ms, dead_after_ms) VALUES ('org-1', 'crew', 'ok', 60000, 43200000)",
                [],
            );
            assert!(refused.is_err(), "v4 accepted 'crew' — then 0005's rebuild is not testing what it claims");
        }

        let store = Store::open(dir.path()).unwrap();
        assert_eq!(count(&store, "SELECT MAX(version) FROM schema_migrations"), MIGRATIONS.last().unwrap().0);
        assert_eq!(count(&store, "SELECT count(*) FROM orgs"), 1, "the upgrade must not mint a second org");
        assert_eq!(count(&store, "SELECT count(*) FROM settings WHERE key = 'appearance'"), 1);
        let row: (String, i64, i64, String) = store
            .conn()
            .query_row("SELECT state, last_attempt_at, last_success_at, last_error FROM reader_status WHERE reader = 'hostinger'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!(row, ("error".into(), 33, 22, "HTTP 401".into()), "the rebuild lost or altered the existing row");
        store
            .conn()
            .execute("INSERT INTO reader_status (org_id, reader, state, stale_after_ms, dead_after_ms) VALUES ('org-1', 'crew', 'ok', 60000, 43200000)", [])
            .expect("v5 must accept the reader id 'crew'");
        for table in ["crew_tasks", "crew_workers", "crew_events", "crew_decisions"] {
            assert_eq!(count(&store, &format!("SELECT count(*) FROM {table}")), 0, "{table}");
        }
    }

    /// Done work clears (build spec §11.2): the captain's store is at v5 with a mirror full of tasks; it upgrades in
    /// place, every row kept, and no task starts out seen.
    #[test]
    fn upgrading_from_v5_keeps_the_crew_and_stamps_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DB_FILE);
        {
            let mut conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)")
                .unwrap();
            for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 5) {
                let tx = conn.transaction().unwrap();
                tx.execute_batch(sql).unwrap();
                tx.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 0)", params![version]).unwrap();
                tx.commit().unwrap();
            }
            conn.execute("INSERT INTO orgs (id, name, created_at) VALUES ('org-1', 'test', 0)", []).unwrap();
            conn.execute(
                "INSERT INTO crew_tasks (org_id, id, kind, backlog_state, snapshot_generated, first_seen_at, last_seen_at, done_at)
                 VALUES ('org-1', 'done-9c2e', 'ship', 'done', 'g', 1, 1, 5)",
                [],
            )
            .unwrap();
        }

        let store = Store::open(dir.path()).unwrap();
        assert_eq!(count(&store, "SELECT MAX(version) FROM schema_migrations"), MIGRATIONS.last().unwrap().0);
        assert_eq!(count(&store, "SELECT count(*) FROM crew_tasks WHERE done_at = 5"), 1, "the row kept");
        assert_eq!(count(&store, "SELECT count(*) FROM crew_tasks WHERE board_seen_at IS NULL AND overnight_seen_at IS NULL"), 1, "seen by no page yet");
    }

    /// Firstmate, current (build spec §6.9, §11.4): 0007 only adds — no word in it drops, renames, deletes or
    /// rewrites — and a store at v6 with rows in every crew table migrates to v7 with every row of every table kept.
    #[test]
    fn migration_0009_only_adds_three_columns() {
        let sql = MIGRATIONS.iter().find(|(v, _)| *v == 9).expect("0009 listed").1;
        let statements: Vec<&str> = sql.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("--")).collect();
        assert_eq!(
            statements,
            [
                "ALTER TABLE crew_tasks ADD COLUMN pr_touches TEXT;",
                "ALTER TABLE crew_tasks ADD COLUMN branch_touches TEXT;",
                "ALTER TABLE crew_tasks ADD COLUMN branch_checked_at INTEGER;",
            ]
        );
    }

    #[test]
    fn migration_0007_only_adds() {
        let sql = MIGRATIONS.iter().find(|(v, _)| *v == 7).expect("0007 listed").1;
        let words: Vec<String> = sql
            .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
            .map(|w| w.to_ascii_uppercase())
            .collect();
        for forbidden in ["DROP", "RENAME", "DELETE", "UPDATE", "REPLACE"] {
            assert!(!words.iter().any(|w| w == forbidden), "0007 contains {forbidden}");
        }
        for line in sql.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("--")) {
            let statement_start = line.starts_with("ALTER TABLE crew_tasks ADD COLUMN ")
                || line.starts_with("CREATE TABLE crew_ledger (")
                || line.starts_with("CREATE INDEX crew_ledger_task ");
            let inside_create = !line.contains(';') || line == ");";
            assert!(statement_start || inside_create, "0007 has a statement that is not an ADD COLUMN or a CREATE: {line}");
        }

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DB_FILE);
        let tables = |conn: &Connection| -> Vec<(String, i64)> {
            let names: Vec<String> = conn
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            names
                .into_iter()
                .map(|n| {
                    let c = conn.query_row(&format!("SELECT count(*) FROM \"{n}\""), [], |r| r.get(0)).unwrap();
                    (n, c)
                })
                .collect()
        };
        let before = {
            let mut conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)")
                .unwrap();
            for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 6) {
                let tx = conn.transaction().unwrap();
                tx.execute_batch(sql).unwrap();
                tx.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 0)", params![version]).unwrap();
                tx.commit().unwrap();
            }
            conn.execute_batch(
                "INSERT INTO orgs (id, name, created_at) VALUES ('org-1', 'test', 0);
                 INSERT INTO settings (org_id, key, value) VALUES ('org-1', 'appearance', '\"dark\"');
                 INSERT INTO reader_status (org_id, reader, state, stale_after_ms, dead_after_ms) VALUES ('org-1', 'crew', 'ok', 60000, 43200000);
                 INSERT INTO crew_tasks (org_id, id, kind, backlog_state, snapshot_generated, first_seen_at, last_seen_at, done_at, board_seen_at)
                   VALUES ('org-1', 'done-9c2e', 'ship', 'done', 'g', 1, 1, 5, 6);
                 INSERT INTO crew_tasks (org_id, id, kind, snapshot_generated, first_seen_at, last_seen_at) VALUES ('org-1', 'live-9c2e', 'scout', 'g', 2, 3);
                 INSERT INTO crew_workers (org_id, task_id, session, pane_id, alive, observed_at) VALUES ('org-1', 'live-9c2e', 's', 'w1:p1', 1, 3);
                 INSERT INTO crew_events (org_id, task_id, at, kind, text) VALUES ('org-1', 'live-9c2e', 2, 'word', 'working');
                 INSERT INTO crew_decisions (org_id, task_id, key, verb, summary, opened_at) VALUES ('org-1', 'live-9c2e', 'k', 'needs-decision', 'q', 2);",
            )
            .unwrap();
            tables(&conn)
        };
        assert!(before.iter().filter(|(_, c)| *c > 0).count() >= 7, "the v6 store has rows in the tables it must keep: {before:?}");

        let store = Store::open(dir.path()).unwrap();
        // Amended 2026-11-18 (the factory in the cloud): the store opens at the latest migration, as the 0006 test
        // above already reads it, so schema_migrations gains one row per migration after 6.
        assert_eq!(count(&store, "SELECT MAX(version) FROM schema_migrations"), MIGRATIONS.last().unwrap().0);
        let after = tables(&store.conn());
        let added = MIGRATIONS.iter().filter(|(v, _)| *v > 6).count() as i64;
        for (name, rows) in &before {
            let kept = after.iter().find(|(n, _)| n == name).map(|(_, c)| *c);
            let expected = if name == "schema_migrations" { rows + added } else { *rows };
            assert_eq!(kept, Some(expected), "{name}: rows before {rows}, after {kept:?}");
        }
        assert_eq!(after.iter().find(|(n, _)| n == "crew_ledger").map(|(_, c)| *c), Some(0), "crew_ledger is new and empty");
        let row: (i64, Option<i64>, Option<String>, Option<String>) = store
            .conn()
            .query_row("SELECT done_at, board_seen_at, branch, merged_via FROM crew_tasks WHERE id = 'done-9c2e'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!(row, (5, Some(6), None, None), "the row kept, its new columns empty");
        let bad = store.conn().execute("INSERT INTO crew_ledger (org_id, task_id, event, at) VALUES ('org-1', 'x', 'status', 1)", []);
        assert!(bad.is_err(), "crew_ledger keeps only the four events");
    }

    /// The factory in the cloud (build spec §6, §17 2026-11-18): 0008 only adds — CREATE TABLE and CREATE INDEX, no
    /// word that drops, renames, deletes, updates or replaces — and a store at v7 with rows in its tables migrates to v8
    /// with every row of every table kept and the four new tables empty.
    #[test]
    fn migration_0008_only_adds() {
        let sql = MIGRATIONS.iter().find(|(v, _)| *v == 8).expect("0008 listed").1;
        let code: String = sql.lines().filter(|l| !l.trim_start().starts_with("--")).collect::<Vec<_>>().join("\n");
        let words: Vec<String> = code.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').map(|w| w.to_ascii_uppercase()).collect();
        for forbidden in ["DROP", "RENAME", "DELETE", "UPDATE", "REPLACE", "ALTER", "INSERT"] {
            assert!(!words.iter().any(|w| w == forbidden), "0008 contains {forbidden}");
        }
        for line in code.lines().map(str::trim).filter(|l| !l.is_empty()) {
            let statement_start = line.starts_with("CREATE TABLE ") || line.starts_with("CREATE INDEX ");
            let inside_create = !line.contains(';') || line == ");";
            assert!(statement_start || inside_create, "0008 has a statement that is not a CREATE: {line}");
        }

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DB_FILE);
        let tables = |conn: &Connection| -> Vec<(String, i64)> {
            let names: Vec<String> = conn
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            names.into_iter().map(|n| { let c = conn.query_row(&format!("SELECT count(*) FROM \"{n}\""), [], |r| r.get(0)).unwrap(); (n, c) }).collect()
        };
        let before = {
            let mut conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)").unwrap();
            for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 7) {
                let tx = conn.transaction().unwrap();
                tx.execute_batch(sql).unwrap();
                tx.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 0)", params![version]).unwrap();
                tx.commit().unwrap();
            }
            conn.execute_batch(
                "INSERT INTO orgs (id, name, created_at) VALUES ('org-1', 'test', 0);
                 INSERT INTO settings (org_id, key, value) VALUES ('org-1', 'appearance', '\"dark\"');
                 INSERT INTO reader_status (org_id, reader, state, stale_after_ms, dead_after_ms) VALUES ('org-1', 'crew', 'ok', 60000, 43200000);
                 INSERT INTO crew_tasks (org_id, id, kind, snapshot_generated, first_seen_at, last_seen_at) VALUES ('org-1', 'live-9c2e', 'scout', 'g', 2, 3);
                 INSERT INTO crew_ledger (org_id, task_id, event, at, pr_url) VALUES ('org-1', 'live-9c2e', 'dispatched', 1, '');",
            )
            .unwrap();
            tables(&conn)
        };
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(count(&store, "SELECT MAX(version) FROM schema_migrations"), MIGRATIONS.last().unwrap().0);
        let after = tables(&store.conn());
        let added = MIGRATIONS.iter().filter(|(v, _)| *v > 7).count() as i64;
        for (name, rows) in &before {
            let kept = after.iter().find(|(n, _)| n == name).map(|(_, c)| *c);
            let expected = if name == "schema_migrations" { rows + added } else { *rows };
            assert_eq!(kept, Some(expected), "{name}: rows before {rows}, after {kept:?}");
        }
        for new in ["vps_reachability", "crew_answers", "factory_events", "focus_spans"] {
            assert_eq!(after.iter().find(|(n, _)| n == new).map(|(_, c)| *c), Some(0), "{new} is new and empty");
        }
        let conn = store.conn();
        assert!(conn.execute("INSERT INTO factory_events (org_id, task_id, project, event, at) VALUES ('org-1', 't', 'p', 'status', 1)", []).is_err(), "only the factory's events");
        assert!(conn.execute("INSERT INTO crew_answers (org_id, request_id, task_id, item_key, kind, origin, outcome) VALUES ('org-1', 'r', 't', 'k', 'approve', 'mac', 'queued')", []).is_err(), "only the five outcomes");
    }
}
