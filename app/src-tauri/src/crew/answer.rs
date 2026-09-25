//! An answer from the Inbox (ADR 0017, build spec §6.4): Firstmate takes a captain's call only in the first mate's own
//! chat, so Kinas answers nothing itself. It builds one line — `On <task> (<key>): <answer>` — from the open decision
//! row, puts it on the clipboard, and stamps `copied_at`; the captain pastes it into the first mate's pane. No Firstmate
//! script runs, no answer text is stored or logged, and only the fold ever closes a decision.

use super::CrewError;
use crate::store::Store;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

/// The most an answer may be, in UTF-8 bytes, after the NULs are gone.
pub(crate) const MAX_ANSWER_BYTES: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnswerKind {
    Approve,
    Deny,
    Answer,
}

/// The answer's words: Approve says `Approved — go ahead.` whatever was typed; Deny says `Denied — <why>`, or
/// `Denied.` with nothing typed; Answer is what was typed, and nothing typed is refused.
pub(crate) fn answer_text(kind: AnswerKind, typed: &str) -> Result<String, CrewError> {
    let typed: String = typed.chars().filter(|c| *c != '\0').collect();
    let typed = typed.trim();
    if typed.len() > MAX_ANSWER_BYTES {
        return Err(CrewError { code: "too_long", message: format!("The answer is over {MAX_ANSWER_BYTES} bytes") });
    }
    match kind {
        AnswerKind::Approve => Ok("Approved — go ahead.".into()),
        AnswerKind::Deny if typed.is_empty() => Ok("Denied.".into()),
        AnswerKind::Deny => Ok(format!("Denied — {typed}")),
        AnswerKind::Answer if typed.is_empty() => Err(CrewError { code: "empty", message: "Type an answer first".into() }),
        AnswerKind::Answer => Ok(typed.to_string()),
    }
}

/// `On <task> (<key>): <answer>`; a held task's decision is keyed by the task itself, so it reads `On <task>: <answer>`.
pub(crate) fn line(task_id: &str, key: &str, answer: &str) -> String {
    if key == task_id {
        format!("On {task_id}: {answer}")
    } else {
        format!("On {task_id} ({key}): {answer}")
    }
}

/// The line for an open decision, built from its row (never from the caller's strings), or `not_open`.
fn open_line(conn: &Connection, org: &str, task: &str, key: &str, kind: AnswerKind, typed: &str) -> Result<String, CrewError> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT task_id, key FROM crew_decisions WHERE org_id = ?1 AND task_id = ?2 AND key = ?3 AND closed_at IS NULL",
            params![org, task, key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| CrewError::internal(format!("could not read the decision: {e}")))?;
    let (task_id, key) = row.ok_or_else(|| CrewError { code: "not_open", message: "That decision is no longer open".into() })?;
    Ok(line(&task_id, &key, &answer_text(kind, typed)?))
}

/// The row read under one guard, the clipboard written with none held (it waits on the main thread, where a command
/// may be waiting for the store), then `copied_at` stamped under a fresh guard while the row is still open. Returns the
/// line it copied.
pub(crate) fn copy(store: &Store, task: &str, key: &str, kind: AnswerKind, typed: &str, now: i64, write: impl FnOnce(&str) -> Result<(), String>) -> Result<String, CrewError> {
    let org = store.org_id();
    let line = open_line(&store.conn(), org, task, key, kind, typed)?;
    write(&line).map_err(|e| CrewError { code: "clipboard", message: format!("Could not put the answer on the clipboard: {e}") })?;
    store
        .conn()
        .execute(
            "UPDATE crew_decisions SET copied_at = ?4 WHERE org_id = ?1 AND task_id = ?2 AND key = ?3 AND closed_at IS NULL",
            params![org, task, key, now],
        )
        .map_err(|e| CrewError::internal(format!("could not mark the decision copied: {e}")))?;
    Ok(line)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn answer_text_says_what_was_meant() {
        assert_eq!(answer_text(AnswerKind::Approve, "ignored").unwrap(), "Approved — go ahead.");
        assert_eq!(answer_text(AnswerKind::Deny, "").unwrap(), "Denied.");
        assert_eq!(answer_text(AnswerKind::Deny, " not before Monday-9c2e ").unwrap(), "Denied — not before Monday-9c2e");
        assert_eq!(answer_text(AnswerKind::Answer, "REST\u{0}-9c2e").unwrap(), "REST-9c2e", "NUL stripped");
        assert_eq!(answer_text(AnswerKind::Answer, "  ").unwrap_err().code, "empty");
        assert_eq!(answer_text(AnswerKind::Answer, &"x".repeat(4_097)).unwrap_err().code, "too_long");
        assert!(answer_text(AnswerKind::Answer, &"x".repeat(4_096)).is_ok());
    }

    #[test]
    fn line_names_the_task_and_its_key() {
        assert_eq!(line("t1", "api-shape", "Approved — go ahead."), "On t1 (api-shape): Approved — go ahead.");
        assert_eq!(line("t1", "t1", "ok-9c2e"), "On t1: ok-9c2e", "a held task's key is itself");
    }

    #[test]
    fn copy_uses_the_row_not_the_caller() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let add = |key: &str, closed: Option<i64>| {
            store
                .conn()
                .execute(
                    "INSERT INTO crew_decisions (org_id, task_id, key, verb, summary, opened_at, closed_at) VALUES (?1, 't1-9c2e', ?2, 'needs-decision', 's', 1, ?3)",
                    params![store.org_id(), key, closed],
                )
                .unwrap();
        };
        add("api-shape-9c2e", None);
        add("closed-9c2e", Some(2));
        let copied = RefCell::new(Vec::new());
        let write = |text: &str| {
            copied.borrow_mut().push(text.to_string());
            Ok(())
        };

        let line = copy(&store, "t1-9c2e", "api-shape-9c2e", AnswerKind::Approve, "", 50, write).unwrap();
        assert_eq!(line, "On t1-9c2e (api-shape-9c2e): Approved — go ahead.");
        assert_eq!(*copied.borrow(), vec![line.clone()]);
        let conn = store.conn();
        let stamp: Option<i64> = conn.query_row("SELECT copied_at FROM crew_decisions WHERE key = 'api-shape-9c2e'", [], |r| r.get(0)).unwrap();
        assert_eq!(stamp, Some(50));
        assert_eq!(crate::crew::read::waiting(&conn, store.org_id()).unwrap(), 1, "a copied decision still waits");
        drop(conn);

        let refused = copy(&store, "t1-9c2e", "closed-9c2e", AnswerKind::Approve, "", 60, write).unwrap_err();
        assert_eq!(refused.code, "not_open");
        let missing = copy(&store, "t1-9c2e", "never-9c2e", AnswerKind::Deny, "x", 60, write).unwrap_err();
        assert_eq!(missing.code, "not_open");
        let empty = copy(&store, "t1-9c2e", "api-shape-9c2e", AnswerKind::Answer, "", 60, write).unwrap_err();
        assert_eq!(empty.code, "empty");
        assert_eq!(copied.borrow().len(), 1, "nothing refused reaches the clipboard");

        let failed = copy(&store, "t1-9c2e", "api-shape-9c2e", AnswerKind::Approve, "", 70, |_| Err("no pasteboard".into())).unwrap_err();
        assert_eq!(failed.code, "clipboard");
        let stamp: Option<i64> = store.conn().query_row("SELECT copied_at FROM crew_decisions WHERE key = 'api-shape-9c2e'", [], |r| r.get(0)).unwrap();
        assert_eq!(stamp, Some(50), "a failed write stamps nothing");
    }
}
