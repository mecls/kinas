//! An answer from the Inbox. Kinas builds one line — `On <task> (<key>): <answer>` — from the open decision row, never
//! from the caller's strings, and then, by place:
//!
//! - **This Mac** (ADR 0017, build spec §6.4): Firstmate takes a captain's call only in the first mate's own chat, so the
//!   line goes on the clipboard and `copied_at` is stamped; the captain pastes it into the first mate's pane.
//! - **A Linux machine** (slice 6.2; ADRs 0022, 0033): the line goes through the door to the companion, which writes it
//!   as a note in Firstmate's inbox while the question is still open there. `crew_answers` records what became of it —
//!   delivered, already, not open, unreachable — and, from the bundle, when the first mate read it and its reply.
//!
//! No Firstmate script runs on this Mac, no answer text is stored or logged, and only the fold ever closes a decision.

use super::CrewError;
use crate::remote::{Origin, Request, Unreachable};
use crate::store::Store;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

/// The line for an open decision, built from its row (never from the caller's strings), and when the row opened; or
/// `not_open`.
fn open_line(conn: &Connection, org: &str, task: &str, key: &str, kind: AnswerKind, typed: &str) -> Result<(String, i64), CrewError> {
    let row: Option<(String, String, i64)> = conn
        .query_row(
            "SELECT task_id, key, opened_at FROM crew_decisions WHERE org_id = ?1 AND task_id = ?2 AND key = ?3 AND closed_at IS NULL",
            params![org, task, key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| CrewError::internal(format!("could not read the decision: {e}")))?;
    let (task_id, key, opened_at) = row.ok_or_else(|| CrewError { code: "not_open", message: "That decision is no longer open".into() })?;
    Ok((line(&task_id, &key, &answer_text(kind, typed)?), opened_at))
}

/// The row read under one guard, the clipboard written with none held (it waits on the main thread, where a command
/// may be waiting for the store), then `copied_at` stamped under a fresh guard while the row is still open. Returns the
/// line it copied.
pub(crate) fn copy(store: &Store, task: &str, key: &str, kind: AnswerKind, typed: &str, now: i64, write: impl FnOnce(&str) -> Result<(), String>) -> Result<String, CrewError> {
    let org = store.org_id();
    let (line, _) = open_line(&store.conn(), org, task, key, kind, typed)?;
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

// ---- with the agents on a Linux machine: delivered as a note (slice 6.2; ADRs 0022, 0025, 0033) ----

/// What became of an answer that keeps a `crew_answers` row (migration 0008's outcomes; `expired` is the phone's).
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Delivered,
    Already,
    NotOpen,
    Unreachable,
}

impl Outcome {
    fn code(self) -> &'static str {
        match self {
            Outcome::Delivered => "delivered",
            Outcome::Already => "already",
            Outcome::NotOpen => "not_open",
            Outcome::Unreachable => "unreachable",
        }
    }
}

/// An answer that keeps a row, with what its toast needs: whether Firstmate woke the first mate (delivered), when the
/// question's first answer was delivered, on this Mac's clock (already), and why the door failed (unreachable).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Sent {
    pub outcome: Outcome,
    pub woken: bool,
    pub answered_at: Option<i64>,
    pub why: Option<String>,
}

/// A request that may have reached Firstmate without its reply reaching the Mac: the same question (its row's
/// opening) and the same words send it again under the same id, so Firstmate keeps one note (point 4). Memory only: the
/// words are never written down, and after a restart the companion's `already` covers a note that was saved.
#[derive(Default)]
pub(crate) struct Resends(std::sync::Mutex<HashMap<(String, String), Resend>>);

struct Resend {
    opened_at: i64,
    words: u64,
    request_id: String,
}

impl Resends {
    fn id_for(&self, task: &str, key: &str, opened_at: i64, words: u64) -> String {
        let mut map = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let slot = (task.to_string(), key.to_string());
        if let Some(r) = map.get(&slot).filter(|r| r.opened_at == opened_at && r.words == words) {
            return r.request_id.clone();
        }
        let request_id = uuid::Uuid::now_v7().to_string();
        map.insert(slot, Resend { opened_at, words, request_id: request_id.clone() });
        request_id
    }

    fn settle(&self, task: &str, key: &str) {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).remove(&(task.to_string(), key.to_string()));
    }
}

/// The companion's reply to `answer` (`cli/src/companion/answer.ts` `AnswerReply`).
#[derive(Deserialize)]
#[serde(untagged)]
enum Reply {
    Outcome {
        outcome: String,
        item: String,
        at: i64,
        #[serde(default)]
        woken: Option<bool>,
        #[serde(default)]
        answered_at: Option<i64>,
    },
    Refused {
        refused: String,
        why: String,
    },
}

/// The longest refusal the toast carries, in characters.
const MAX_WHY_CHARS: usize = 300;
/// An item as the companion names one: `<task>@<key>@<opened_at>`, well under this.
const MAX_ITEM_CHARS: usize = 400;

fn refusal_code(code: &str) -> &'static str {
    match code {
        "cannot-tell" => "cannot_tell",
        "gate" => "gate",
        "note-failed" => "note_failed",
        "note-unknown" => "note_unknown",
        "request-reused" => "request_reused",
        "busy" => "busy",
        _ => "refused",
    }
}

fn kind_code(kind: AnswerKind) -> &'static str {
    match kind {
        AnswerKind::Approve => "approve",
        AnswerKind::Deny => "deny",
        AnswerKind::Answer => "answer",
    }
}

fn words_hash(line: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    line.hash(&mut h);
    h.finish()
}

/// The reply read: an outcome for this question's item, a refusal, or nothing this Kinas reads.
fn read_reply(reply: serde_json::Value, task: &str, key: &str) -> Result<Reply, Unreachable> {
    let r: Reply = serde_json::from_value(reply).map_err(|_| Unreachable::BadReply)?;
    if let Reply::Outcome { outcome, item, .. } = &r {
        let ours = item.len() <= MAX_ITEM_CHARS && item.strip_prefix(&format!("{task}@{key}@")).is_some_and(|rest| !rest.is_empty());
        if !ours || !matches!(outcome.as_str(), "delivered" | "already" | "not_open") {
            return Err(Unreachable::BadReply);
        }
    }
    Ok(r)
}

/// The answer as a note in Firstmate's inbox on the Linux machine (flow E): the line built from the open row under one
/// guard; the door called with none held (it can take a minute); then the outcome's row under a fresh guard. A refusal
/// (the companion couldn't tell, its gate, the note not saved) keeps no row and is the `CrewError`, in the companion's
/// words. The words are never logged or stored.
#[allow(clippy::too_many_arguments)]
pub(crate) fn deliver(
    store: &Store,
    label: &str,
    task: &str,
    key: &str,
    kind: AnswerKind,
    typed: &str,
    resends: &Resends,
    clock: impl Fn() -> i64,
    call: impl FnOnce(&Request) -> Result<serde_json::Value, Unreachable>,
) -> Result<Sent, CrewError> {
    let (line, opened_at) = open_line(&store.conn(), store.org_id(), task, key, kind, typed)?;
    let request_id = resends.id_for(task, key, opened_at, words_hash(&line));
    let request = Request::Answer { task: task.into(), key: key.into(), words: line, request_id: request_id.clone(), from: Origin::Mac };
    let reply = call(&request).and_then(|v| read_reply(v, task, key));
    let now = clock();
    let (sent, item) = match reply {
        Ok(Reply::Refused { refused, why }) => {
            // The note may be saved when it timed out there: the same words again are the same request.
            if refused != "note-unknown" {
                resends.settle(task, key);
            }
            log::info!("crew: answer refused ({})", refusal_code(&refused));
            return Err(CrewError { code: refusal_code(&refused), message: why.chars().take(MAX_WHY_CHARS).collect() });
        }
        Ok(Reply::Outcome { outcome, item, at, woken, answered_at }) => {
            resends.settle(task, key);
            let delivered = match outcome.as_str() {
                "delivered" => Outcome::Delivered,
                "already" => Outcome::Already,
                _ => Outcome::NotOpen,
            };
            // The first answer's time there, as long before this reply as it was there.
            let answered_at = (delivered == Outcome::Already).then(|| now - (at - answered_at.unwrap_or(at)).max(0));
            (Sent { outcome: delivered, woken: delivered == Outcome::Delivered && woken.unwrap_or(true), answered_at, why: None }, item)
        }
        Err(why) => (Sent { outcome: Outcome::Unreachable, woken: false, answered_at: None, why: Some(why.words(label)) }, format!("{task}@{key}@unknown")),
    };
    let delivered_at = (sent.outcome == Outcome::Delivered).then_some(now);
    store
        .conn()
        .execute(
            "INSERT INTO crew_answers (org_id, request_id, task_id, item_key, kind, origin, outcome, delivered_at) VALUES (?1, ?2, ?3, ?4, ?5, 'mac', ?6, ?7)
             ON CONFLICT (org_id, request_id) DO UPDATE SET
               item_key = CASE WHEN crew_answers.outcome = 'delivered' THEN crew_answers.item_key ELSE excluded.item_key END,
               delivered_at = COALESCE(crew_answers.delivered_at, excluded.delivered_at),
               outcome = CASE WHEN crew_answers.outcome = 'delivered' THEN 'delivered' ELSE excluded.outcome END",
            params![store.org_id(), request_id, task, item, kind_code(kind), sent.outcome.code(), delivered_at],
        )
        .map_err(|e| CrewError::internal(format!("could not record the answer: {e}")))?;
    log::info!("crew: answer {}", sent.outcome.code());
    Ok(sent)
}

/// The first mate's reply, as far as Kinas keeps one (0008's `reply`).
pub(crate) const MAX_REPLY_CHARS: usize = 2_000;

/// One row of the bundle's `answers[]` (`cli/src/companion/answer.ts` `answersForBundle`), the fields the Mac takes.
#[derive(Deserialize)]
struct StateOut {
    request_id: String,
    item: String,
    state: String,
    at: i64,
    #[serde(default)]
    read_at: Option<i64>,
    #[serde(default)]
    reply: Option<String>,
}

/// What the companion learned since the answer left this Mac (flow A's `crew_answers` updates): a row this Mac sent
/// that the door lost (`unreachable`) takes the companion's outcome, and a delivered one its `read_at` and reply, each
/// once. The companion's times are moved onto this Mac's clock by `served_at`. A row this Mac never sent is skipped (the
/// phone's are slice 10's), and so is one that does not read; neither drops the rest. Returns the rows changed.
pub(crate) fn apply_states(conn: &Connection, org: &str, answers: Option<&serde_json::Value>, served_at: Option<i64>, now: i64) -> rusqlite::Result<usize> {
    let Some(list) = answers.and_then(serde_json::Value::as_array) else { return Ok(0) };
    let here = |t: i64| served_at.map_or(t, |served| now - (served - t).max(0));
    let mut changed = 0;
    for raw in list {
        let Ok(a) = serde_json::from_value::<StateOut>(raw.clone()) else { continue };
        let ours: Option<(String, String)> = conn
            .query_row("SELECT task_id, outcome FROM crew_answers WHERE org_id = ?1 AND request_id = ?2", params![org, a.request_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        let Some((task, outcome)) = ours else { continue };
        let mut n = 0;
        let theirs = matches!(a.state.as_str(), "delivered" | "already" | "not_open");
        let item_ok = a.item.len() <= MAX_ITEM_CHARS && a.item.starts_with(&format!("{task}@"));
        if outcome == "unreachable" && theirs && item_ok {
            let delivered_at = (a.state == "delivered").then(|| here(a.at));
            n += conn.execute(
                "UPDATE crew_answers SET outcome = ?3, item_key = ?4, delivered_at = ?5 WHERE org_id = ?1 AND request_id = ?2 AND outcome = 'unreachable'",
                params![org, a.request_id, a.state, a.item, delivered_at],
            )?;
        }
        if let Some(read_at) = a.read_at {
            n += conn.execute("UPDATE crew_answers SET read_at = ?3 WHERE org_id = ?1 AND request_id = ?2 AND read_at IS NULL", params![org, a.request_id, here(read_at)])?;
        }
        if let Some(reply) = a.reply.as_deref().map(str::trim).filter(|r| !r.is_empty()) {
            let reply: String = reply.chars().take(MAX_REPLY_CHARS).collect();
            n += conn.execute("UPDATE crew_answers SET reply = ?3 WHERE org_id = ?1 AND request_id = ?2 AND reply IS NULL", params![org, a.request_id, reply])?;
        }
        if n > 0 {
            changed += 1;
        }
    }
    Ok(changed)
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

    /// `fixtures/answer-lines.json`, which the companion's TypeScript (`packages/commands/src/answer-line.ts`) reads too: the
    /// line a phone's answer becomes there is the one this Mac builds for the same words.
    #[test]
    fn the_line_is_the_companions_for_every_case_in_the_shared_fixture() {
        let text = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/answer-lines.json")).unwrap();
        let cases: Vec<serde_json::Value> = serde_json::from_str(&text).unwrap();
        assert!(cases.len() >= 10);
        for c in cases {
            let s = |k: &str| c[k].as_str().unwrap().to_string();
            let kind = match s("kind").as_str() {
                "approve" => AnswerKind::Approve,
                "deny" => AnswerKind::Deny,
                _ => AnswerKind::Answer,
            };
            let got = answer_text(kind, &s("typed")).ok().map(|words| line(&s("task"), &s("key"), &words));
            assert_eq!(got.as_deref(), c["line"].as_str(), "{c}");
        }
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

    // ---- slice 6.2: an answer delivered through the door ----

    use serde_json::json;

    const MAC_NOW: i64 = 5_000_000;

    fn with_decision(key: &str, opened_at: i64) -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        store
            .conn()
            .execute(
                "INSERT INTO crew_decisions (org_id, task_id, key, verb, summary, opened_at) VALUES (?1, 't1', ?2, 'needs-decision', 's', ?3)",
                params![store.org_id(), key, opened_at],
            )
            .unwrap();
        (dir, store)
    }

    type Row = (String, String, String, String, String, Option<i64>);
    fn rows(store: &Store) -> Vec<Row> {
        let conn = store.conn();
        let mut stmt = conn.prepare("SELECT request_id, item_key, kind, origin, outcome, delivered_at FROM crew_answers ORDER BY rowid").unwrap();
        let out = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).unwrap().collect::<rusqlite::Result<Vec<Row>>>().unwrap();
        out
    }

    /// The request the door was handed, and a reply for it.
    fn answer_with(store: &Store, resends: &Resends, kind: AnswerKind, typed: &str, reply: Result<serde_json::Value, Unreachable>) -> (Result<Sent, CrewError>, Option<Request>) {
        let seen = RefCell::new(None);
        let out = deliver(store, "homelab", "t1", "api-shape", kind, typed, resends, || MAC_NOW, |req| {
            *seen.borrow_mut() = Some(req.clone());
            reply
        });
        (out, seen.into_inner())
    }

    fn sent_id(req: &Option<Request>) -> String {
        match req {
            Some(Request::Answer { request_id, .. }) => request_id.clone(),
            other => panic!("not an answer: {other:?}"),
        }
    }

    #[test]
    fn delivered_keeps_a_row_with_the_reply_s_item_and_the_mac_s_clock() {
        let (_d, store) = with_decision("api-shape", 100);
        let resends = Resends::default();
        let reply = json!({"v": 1, "outcome": "delivered", "item": "t1@api-shape@90", "at": 1_000_000, "woken": true, "replay": false});
        let (out, req) = answer_with(&store, &resends, AnswerKind::Approve, "", Ok(reply));
        assert_eq!(out.unwrap(), Sent { outcome: Outcome::Delivered, woken: true, answered_at: None, why: None });
        match req.as_ref().unwrap() {
            Request::Answer { task, key, words, request_id, from } => {
                assert_eq!((task.as_str(), key.as_str(), *from), ("t1", "api-shape", Origin::Mac));
                assert_eq!(words, "On t1 (api-shape): Approved — go ahead.", "the line from the row, as the copy path builds it");
                assert_eq!(uuid::Uuid::parse_str(request_id).unwrap().get_version_num(), 7);
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(rows(&store), vec![(sent_id(&req), "t1@api-shape@90".into(), "approve".into(), "mac".into(), "delivered".into(), Some(MAC_NOW))]);
        let copied: Option<i64> = store.conn().query_row("SELECT copied_at FROM crew_decisions", [], |r| r.get(0)).unwrap();
        assert_eq!(copied, None, "a delivered answer is not a copied one");
    }

    #[test]
    fn delivered_unwoken_says_so() {
        let (_d, store) = with_decision("api-shape", 100);
        let reply = json!({"v": 1, "outcome": "delivered", "item": "t1@api-shape@90", "at": 1_000_000, "woken": false, "replay": false});
        let (out, _) = answer_with(&store, &Resends::default(), AnswerKind::Answer, "REST", Ok(reply));
        assert!(!out.unwrap().woken);
    }

    #[test]
    fn already_keeps_a_row_and_says_when_on_the_mac_s_clock() {
        let (_d, store) = with_decision("api-shape", 100);
        let reply = json!({"v": 1, "outcome": "already", "item": "t1@api-shape@90", "at": 1_000_000, "answered_at": 999_000, "answered_from": "mac"});
        let (out, req) = answer_with(&store, &Resends::default(), AnswerKind::Deny, "no", Ok(reply));
        assert_eq!(out.unwrap(), Sent { outcome: Outcome::Already, woken: false, answered_at: Some(MAC_NOW - 1_000), why: None });
        assert_eq!(rows(&store), vec![(sent_id(&req), "t1@api-shape@90".into(), "deny".into(), "mac".into(), "already".into(), None)]);
    }

    #[test]
    fn not_open_keeps_a_row() {
        let (_d, store) = with_decision("api-shape", 100);
        let reply = json!({"v": 1, "outcome": "not_open", "item": "t1@api-shape@90", "at": 1_000_000});
        let (out, _) = answer_with(&store, &Resends::default(), AnswerKind::Approve, "", Ok(reply));
        assert_eq!(out.unwrap().outcome, Outcome::NotOpen);
        assert_eq!(rows(&store)[0].4, "not_open");
    }

    #[test]
    fn unreachable_keeps_a_row_and_a_resend_of_the_same_words_reuses_the_id() {
        let (_d, store) = with_decision("api-shape", 100);
        let resends = Resends::default();
        let (out, first) = answer_with(&store, &resends, AnswerKind::Answer, "REST", Err(Unreachable::TimedOut));
        assert_eq!(out.unwrap(), Sent { outcome: Outcome::Unreachable, woken: false, answered_at: None, why: Some("can't reach homelab: timed out".into()) });
        assert_eq!(rows(&store), vec![(sent_id(&first), "t1@api-shape@unknown".into(), "answer".into(), "mac".into(), "unreachable".into(), None)]);

        // Point 4: the note may be saved; the same words again are the same request, and Firstmate keeps one note.
        let reply = json!({"v": 1, "outcome": "delivered", "item": "t1@api-shape@90", "at": 1_000_000, "woken": true, "replay": true});
        let (out, again) = answer_with(&store, &resends, AnswerKind::Answer, "REST", Ok(reply));
        assert_eq!(out.unwrap().outcome, Outcome::Delivered);
        assert_eq!(sent_id(&again), sent_id(&first));
        assert_eq!(rows(&store), vec![(sent_id(&first), "t1@api-shape@90".into(), "answer".into(), "mac".into(), "delivered".into(), Some(MAC_NOW))], "one row, now delivered");

        // Settled: the next answer is a new request.
        let (_, next) = answer_with(&store, &resends, AnswerKind::Answer, "REST", Err(Unreachable::NotReachable));
        assert_ne!(sent_id(&next), sent_id(&first));
    }

    #[test]
    fn other_words_after_unreachable_are_a_new_request() {
        let (_d, store) = with_decision("api-shape", 100);
        let resends = Resends::default();
        let (_, first) = answer_with(&store, &resends, AnswerKind::Answer, "REST", Err(Unreachable::TimedOut));
        let (_, other) = answer_with(&store, &resends, AnswerKind::Answer, "GraphQL", Err(Unreachable::TimedOut));
        assert_ne!(sent_id(&other), sent_id(&first));
    }

    #[test]
    fn a_refusal_keeps_no_row_and_says_the_companion_s_words() {
        let (_d, store) = with_decision("api-shape", 100);
        let resends = Resends::default();
        for (code, ours) in [("cannot-tell", "cannot_tell"), ("gate", "gate"), ("note-failed", "note_failed"), ("busy", "busy"), ("request-reused", "request_reused"), ("note-unknown", "note_unknown"), ("new-one", "refused")] {
            let reply = json!({"v": 1, "refused": code, "why": format!("words for {code}")});
            let (out, _) = answer_with(&store, &resends, AnswerKind::Approve, "", Ok(reply));
            assert_eq!(out.unwrap_err(), CrewError { code: ours, message: format!("words for {code}") });
        }
        assert!(rows(&store).is_empty());
    }

    #[test]
    fn note_unknown_keeps_the_id_for_a_resend_and_busy_does_not() {
        let (_d, store) = with_decision("api-shape", 100);
        let resends = Resends::default();
        let unknown = json!({"v": 1, "refused": "note-unknown", "why": "w"});
        let (_, first) = answer_with(&store, &resends, AnswerKind::Approve, "", Ok(unknown));
        let busy = json!({"v": 1, "refused": "busy", "why": "w"});
        let (_, second) = answer_with(&store, &resends, AnswerKind::Approve, "", Ok(busy));
        assert_eq!(sent_id(&second), sent_id(&first), "the note may be saved");
        let (_, third) = answer_with(&store, &resends, AnswerKind::Approve, "", Err(Unreachable::TimedOut));
        assert_ne!(sent_id(&third), sent_id(&first), "busy wrote nothing there");
    }

    #[test]
    fn a_reply_for_another_item_is_not_read() {
        let (_d, store) = with_decision("api-shape", 100);
        let resends = Resends::default();
        for reply in [
            json!({"v": 1, "outcome": "delivered", "item": "t2@api-shape@90", "at": 1, "woken": true}),
            json!({"v": 1, "outcome": "sent", "item": "t1@api-shape@90", "at": 1}),
            json!({"v": 1, "error": "answer-failed"}),
        ] {
            let (out, _) = answer_with(&store, &resends, AnswerKind::Approve, "", Ok(reply));
            assert_eq!(out.unwrap(), Sent { outcome: Outcome::Unreachable, woken: false, answered_at: None, why: Some("can't reach homelab: the answer could not be read".into()) });
        }
        assert_eq!(rows(&store).len(), 1, "one request, resent with the same words");
    }

    fn state(store: &Store, id: &str) -> (String, String, Option<i64>, Option<i64>, Option<String>) {
        store
            .conn()
            .query_row("SELECT item_key, outcome, delivered_at, read_at, reply FROM crew_answers WHERE request_id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .unwrap()
    }

    fn apply(store: &Store, answers: serde_json::Value, served_at: Option<i64>) -> usize {
        apply_states(&store.conn(), store.org_id(), Some(&answers), served_at, MAC_NOW).unwrap()
    }

    #[test]
    fn the_bundle_delivers_an_unreachable_row_on_the_mac_s_clock() {
        let (_d, store) = with_decision("api-shape", 100);
        let resends = Resends::default();
        let (_, req) = answer_with(&store, &resends, AnswerKind::Approve, "", Err(Unreachable::TimedOut));
        let id = sent_id(&req);
        let row = json!({"request_id": id, "item": "t1@api-shape@90", "task": "t1", "key": "api-shape", "from": "mac", "at": 1_000_000, "state": "delivered", "woken": true, "replay": false, "answered_at": null, "answered_from": null, "read_at": null, "reply": null, "reply_at": null});
        assert_eq!(apply(&store, json!([row]), Some(1_010_000)), 1);
        assert_eq!(state(&store, &id), ("t1@api-shape@90".into(), "delivered".into(), Some(MAC_NOW - 10_000), None, None));

        // A resend whose reply is lost again never takes the delivery back.
        let (_, again) = answer_with(&store, &resends, AnswerKind::Approve, "", Ok(json!({"v": 1})));
        assert_eq!(sent_id(&again), id);
        assert_eq!(state(&store, &id).1, "delivered");
    }

    #[test]
    fn read_and_reply_are_kept_once() {
        let (_d, store) = with_decision("api-shape", 100);
        let ok = json!({"v": 1, "outcome": "delivered", "item": "t1@api-shape@90", "at": 1_000_000, "woken": true});
        let (_, req) = answer_with(&store, &Resends::default(), AnswerKind::Approve, "", Ok(ok));
        let id = sent_id(&req);
        let row = |read_at: i64, reply: &str| json!({"request_id": id, "item": "t1@api-shape@90", "state": "delivered", "at": 1_000_000, "read_at": read_at, "reply": reply, "reply_at": read_at});
        apply(&store, json!([row(1_005_000, "On it-9c2e")]), Some(1_010_000));
        assert_eq!(state(&store, &id), ("t1@api-shape@90".into(), "delivered".into(), Some(MAC_NOW), Some(MAC_NOW - 5_000), Some("On it-9c2e".into())));
        apply(&store, json!([row(1_009_000, "Changed")]), Some(1_010_000));
        assert_eq!(state(&store, &id).3, Some(MAC_NOW - 5_000), "read once");
        assert_eq!(state(&store, &id).4.as_deref(), Some("On it-9c2e"), "replied once");
    }

    #[test]
    fn a_reply_is_cut_at_two_thousand_characters_and_its_time_without_served_at_is_as_sent() {
        let (_d, store) = with_decision("api-shape", 100);
        let ok = json!({"v": 1, "outcome": "delivered", "item": "t1@api-shape@90", "at": 1_000_000, "woken": true});
        let (_, req) = answer_with(&store, &Resends::default(), AnswerKind::Approve, "", Ok(ok));
        let id = sent_id(&req);
        apply(&store, json!([{"request_id": id, "item": "t1@api-shape@90", "state": "delivered", "at": 1, "read_at": 42, "reply": "é".repeat(2_500)}]), None);
        let (_, _, _, read_at, reply) = state(&store, &id);
        assert_eq!(read_at, Some(42));
        assert_eq!(reply.unwrap().chars().count(), 2_000);
    }

    #[test]
    fn a_row_the_mac_never_sent_or_cannot_read_is_skipped() {
        let (_d, store) = with_decision("api-shape", 100);
        let ok = json!({"v": 1, "outcome": "delivered", "item": "t1@api-shape@90", "at": 1_000_000, "woken": true});
        let (_, req) = answer_with(&store, &Resends::default(), AnswerKind::Approve, "", Ok(ok));
        let id = sent_id(&req);
        let answers = json!([
            {"request_id": "phone-1", "item": "t1@api-shape@90", "state": "delivered", "at": 1, "read_at": 2},
            {"request_id": 7},
            "not a row",
            {"request_id": id, "item": "t1@api-shape@90", "state": "delivered", "at": 1, "read_at": 3}
        ]);
        assert_eq!(apply(&store, answers, None), 1);
        assert_eq!(rows(&store).len(), 1, "nothing inserted");
        assert_eq!(state(&store, &id).3, Some(3));
        assert_eq!(apply_states(&store.conn(), store.org_id(), Some(&json!({"no": "list"})), None, MAC_NOW).unwrap(), 0);
        assert_eq!(apply_states(&store.conn(), store.org_id(), None, None, MAC_NOW).unwrap(), 0);
    }

    #[test]
    fn a_closed_decision_never_reaches_the_door() {
        let (_d, store) = with_decision("api-shape", 100);
        store.conn().execute("UPDATE crew_decisions SET closed_at = 200", []).unwrap();
        let called = RefCell::new(false);
        let out = deliver(&store, "homelab", "t1", "api-shape", AnswerKind::Approve, "", &Resends::default(), || MAC_NOW, |_| {
            *called.borrow_mut() = true;
            Ok(json!({}))
        });
        assert_eq!(out.unwrap_err().code, "not_open");
        assert!(!*called.borrow());
        assert!(rows(&store).is_empty());
    }
}
