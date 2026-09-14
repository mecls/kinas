//! The single writer of `kinas.sqlite` (PRD R7–R10).

use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

/// Every migration, in order. Forward-only: shipped entries are never edited (R10).
pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../../migrations/0001_init.sql")),
    (2, include_str!("../../../migrations/0002_usage_details.sql")),
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
}
