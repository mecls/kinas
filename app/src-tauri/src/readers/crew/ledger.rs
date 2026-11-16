//! The fleet ledger (Firstmate, current; ADR 0020; Firstmate's `docs/fleet-ledger.md` at the pin): `state/fleet-ledger.jsonl`,
//! read only while it exists, opened read-only as a regular file (`reader::access::open_regular`), from a cursor
//! `{dev, ino, offset}` that Kinas keeps in its own store, at most 4 MiB a cycle. Of its records Kinas keeps four events
//! — `task.dispatched`, `task.pr_ready`, `task.merged`, `task.cleaned_up` — with their own times and members; a
//! `task.status` record is parsed and dropped (its text can say anything), unknown events and members are ignored, and
//! a record whose `v` is not 1 stops the read before it. A partial last line waits for the next cycle.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub(crate) const LEDGER_FILE: &str = "state/fleet-ledger.jsonl";
/// The most one cycle reads; the rest waits for the next.
pub(crate) const READ_CAP: u64 = 4 * 1024 * 1024;

/// Where the last read stopped: the file's device and inode, and the byte after the last complete line consumed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Cursor {
    pub dev: u64,
    pub ino: u64,
    pub offset: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Via {
    Pr,
    Local,
}

impl Via {
    pub(crate) fn word(self) -> &'static str {
        match self {
            Via::Pr => "pr",
            Via::Local => "local",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LedgerKind {
    Dispatched { harness: Option<String> },
    PrReady { pr: String },
    Merged { via: Via, pr: Option<String> },
    CleanedUp,
}

impl LedgerKind {
    /// The event's name in `crew_ledger.event`.
    pub(crate) fn event(&self) -> &'static str {
        match self {
            LedgerKind::Dispatched { .. } => "dispatched",
            LedgerKind::PrReady { .. } => "pr_ready",
            LedgerKind::Merged { .. } => "merged",
            LedgerKind::CleanedUp => "cleaned_up",
        }
    }
}

/// One kept record: the task, Firstmate's own time in milliseconds, and what happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LedgerEvent {
    pub task: String,
    pub at: i64,
    pub kind: LedgerKind,
}

/// One cycle's read: the events kept, where it stopped, and why it stopped early, if it did.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LedgerRead {
    pub events: Vec<LedgerEvent>,
    pub cursor: Cursor,
    pub error: Option<String>,
}

/// The longest task id or PR URL kept; anything longer is not one Firstmate writes.
const FIELD_MAX: usize = 2048;

/// Complete lines only, in order. Stops before a record whose `v` is not 1 (`error` set, that line not consumed) and
/// before a partial last line. Returns the events kept and the bytes consumed. A line that is not JSON, not UTF-8 or
/// not an object is skipped as unparseable.
pub(crate) fn parse_lines(bytes: &[u8]) -> (Vec<LedgerEvent>, usize, Option<String>) {
    let mut events = Vec::new();
    let mut consumed = 0;
    while let Some(end) = bytes[consumed..].iter().position(|b| *b == b'\n') {
        let line = &bytes[consumed..consumed + end];
        if let Some(record) = std::str::from_utf8(line).ok().and_then(|s| serde_json::from_str::<Value>(s).ok()).filter(Value::is_object) {
            if let Some(v) = record.get("v").filter(|v| v.as_u64() != Some(1)) {
                let version = v.as_u64().map_or_else(|| "unknown".to_string(), |n| n.to_string());
                return (events, consumed, Some(format!("unsupported record version {version}")));
            }
            if let Some(event) = event_of(&record) {
                events.push(event);
            }
        }
        consumed += end + 1;
    }
    (events, consumed, None)
}

fn event_of(r: &Value) -> Option<LedgerEvent> {
    let text = |key: &str| r.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty() && s.len() <= FIELD_MAX && !s.chars().any(char::is_control)).map(str::to_string);
    let task = text("task")?;
    let at = r.get("ts").and_then(Value::as_i64).filter(|t| *t > 0)?.checked_mul(1000)?;
    let kind = match r.get("event").and_then(Value::as_str)? {
        "task.dispatched" => LedgerKind::Dispatched { harness: text("harness").filter(|h| h.len() <= 64) },
        "task.pr_ready" => LedgerKind::PrReady { pr: text("pr")? },
        "task.merged" => match r.get("via").and_then(Value::as_str)? {
            "pr" => LedgerKind::Merged { via: Via::Pr, pr: text("pr") },
            "local" => LedgerKind::Merged { via: Via::Local, pr: None },
            _ => return None,
        },
        "task.cleaned_up" => LedgerKind::CleanedUp,
        // task.status and anything later: nothing of it is kept.
        _ => return None,
    };
    Some(LedgerEvent { task, at, kind })
}

/// The ledger from `cursor`: None when the file is absent or not a regular file. A file that is another one now (its
/// device or inode changed) or shorter than the cursor (emptied) is read from 0 — the store's unique key makes a second
/// reading of a record harmless. At most `READ_CAP` bytes; the cursor moves past complete lines only.
pub(crate) fn read_ledger(path: &Path, cursor: Cursor) -> std::io::Result<Option<LedgerRead>> {
    read_ledger_capped(path, cursor, READ_CAP)
}

fn read_ledger_capped(path: &Path, cursor: Cursor, cap: u64) -> std::io::Result<Option<LedgerRead>> {
    use std::os::unix::fs::MetadataExt;
    let file = match crate::reader::access::open_regular(path) {
        Ok(Some(f)) => f,
        Ok(None) => return Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let meta = file.metadata()?;
    let same = meta.dev() == cursor.dev && meta.ino() == cursor.ino;
    let start = if same && meta.len() >= cursor.offset { cursor.offset } else { 0 };
    let mut file = file;
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.take(cap).read_to_end(&mut bytes)?;
    let (events, consumed, error) = parse_lines(&bytes);
    // A single line longer than the cap would never complete: skip past it, so the reading cannot stall for good.
    let consumed = if consumed == 0 && error.is_none() && bytes.len() as u64 >= cap { bytes.len() } else { consumed };
    Ok(Some(LedgerRead { events, cursor: Cursor { dev: meta.dev(), ino: meta.ino(), offset: start + consumed as u64 }, error }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        std::fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/crew-ledger.synthetic.jsonl")).unwrap()
    }

    #[test]
    fn parse_lines_cases() {
        let bytes = fixture();
        let (events, consumed, error) = parse_lines(&bytes);
        // Every v1 event before the v2 record, duplicates included (the store keeps each once), and nothing of task.status.
        let kinds: Vec<(&str, &str)> = events.iter().map(|e| (e.task.as_str(), e.kind.event())).collect();
        assert_eq!(
            kinds,
            [
                ("stock-webhook-9c2e", "dispatched"),
                ("harbor-review-9c2e", "dispatched"),
                ("stock-webhook-9c2e", "pr_ready"),
                ("stock-webhook-9c2e", "pr_ready"),
                ("harbor-review-9c2e", "merged"),
                ("harbor-review-9c2e", "cleaned_up"),
                ("harbor-review-9c2e", "cleaned_up"),
            ]
        );
        assert_eq!(events[0].kind, LedgerKind::Dispatched { harness: Some("claude".into()) });
        assert_eq!(events[0].at, 1_794_820_000_000, "Firstmate's seconds, in milliseconds");
        assert_eq!(events[4].kind, LedgerKind::Merged { via: Via::Pr, pr: Some("https://github.com/acme-9c2e/harbor-api-9c2e/pull/90".into()) });
        assert_eq!(error.as_deref(), Some("unsupported record version 2"));
        let v2 = bytes[consumed..].split(|b| *b == b'\n').next().unwrap();
        assert!(std::str::from_utf8(v2).unwrap().contains("\"v\":2"), "the cursor stays at the start of the v2 line");

        // A partial last line is not consumed; a non-UTF-8 line and junk are skipped; unknown events and members ignored.
        let mut more = b"{\"v\":1,\"ts\":5,\"event\":\"task.cleaned_up\",\"task\":\"a-9c2e\",\"later\":1}\n".to_vec();
        more.extend_from_slice(b"\xff\xfe not text\n");
        more.extend_from_slice(b"[1,2]\n{\"v\":1,\"ts\":6,\"event\":\"task.relaunched\",\"task\":\"a-9c2e\"}\n");
        more.extend_from_slice(b"{\"v\":1,\"ts\":7,\"event\":\"task.status\",\"task\":\"a-9c2e\",\"text\":\"secret 9c2e\"}\n");
        let whole = more.len();
        more.extend_from_slice(b"{\"v\":1,\"ts\":8,\"event\":\"task.cleaned_up\",\"task\":\"b-9c2e\"");
        let (events, consumed, error) = parse_lines(&more);
        assert_eq!(events.len(), 1);
        assert_eq!((events[0].task.as_str(), events[0].at), ("a-9c2e", 5_000));
        assert_eq!((consumed, error), (whole, None), "the partial line waits");
    }

    #[test]
    fn restarts_when_emptied_or_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fleet-ledger.jsonl");
        assert_eq!(read_ledger(&path, Cursor::default()).unwrap(), None, "absent: nothing to read");
        let one = b"{\"v\":1,\"ts\":1,\"event\":\"task.cleaned_up\",\"task\":\"a-9c2e\"}\n";
        std::fs::write(&path, one).unwrap();
        let first = read_ledger(&path, Cursor::default()).unwrap().unwrap();
        assert_eq!((first.events.len(), first.cursor.offset), (1, one.len() as u64));
        let again = read_ledger(&path, first.cursor).unwrap().unwrap();
        assert!(again.events.is_empty(), "nothing new, nothing read");

        // Emptied (`: > state/fleet-ledger.jsonl`), then one record: shorter than the cursor, so from 0.
        std::fs::write(&path, b"").unwrap();
        let emptied = read_ledger(&path, first.cursor).unwrap().unwrap();
        assert_eq!((emptied.events.len(), emptied.cursor.offset), (0, 0));
        std::fs::write(&path, b"{\"v\":1,\"ts\":2,\"event\":\"task.cleaned_up\",\"task\":\"b-9c2e\"}\n").unwrap();
        assert_eq!(read_ledger(&path, emptied.cursor).unwrap().unwrap().events[0].task, "b-9c2e");

        // Replaced by another file at the same path, longer than the cursor: another inode, so from 0.
        let other = dir.path().join("other.jsonl");
        std::fs::write(&other, [one.as_slice(), one.as_slice(), one.as_slice()].concat()).unwrap();
        std::fs::rename(&other, &path).unwrap();
        let replaced = read_ledger(&path, first.cursor).unwrap().unwrap();
        assert_eq!(replaced.events.len(), 3);

        // A FIFO is never opened.
        let fifo = dir.path().join("fifo.jsonl");
        assert!(std::process::Command::new("/usr/bin/mkfifo").arg(&fifo).status().unwrap().success());
        assert_eq!(read_ledger(&fifo, Cursor::default()).unwrap(), None);
    }

    /// AC-7: a half-written last line waits; once Firstmate finishes it, the next read keeps its event — once.
    #[test]
    fn a_half_line_is_kept_once_completed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fleet-ledger.jsonl");
        let line = "{\"v\":1,\"ts\":3,\"event\":\"task.cleaned_up\",\"task\":\"half-9c2e\"}\n";
        let (head, tail) = line.split_at(20);
        std::fs::write(&path, head).unwrap();
        let first = read_ledger(&path, Cursor::default()).unwrap().unwrap();
        assert_eq!((first.events.len(), first.cursor.offset), (0, 0), "a half line is not read");
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut f, tail.as_bytes()).unwrap();
        let second = read_ledger(&path, first.cursor).unwrap().unwrap();
        assert_eq!(second.events.iter().map(|e| e.task.as_str()).collect::<Vec<_>>(), ["half-9c2e"]);
        let third = read_ledger(&path, second.cursor).unwrap().unwrap();
        assert!(third.events.is_empty(), "kept once");
    }

    #[test]
    fn reads_at_most_four_mib() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fleet-ledger.jsonl");
        let line = format!("{{\"v\":1,\"ts\":1,\"event\":\"task.status\",\"task\":\"a-9c2e\",\"text\":\"{}\"}}\n", "x".repeat(900));
        let lines = (5 * 1024 * 1024) / line.len() + 1;
        let mut body = line.repeat(lines);
        body.push_str("{\"v\":1,\"ts\":9,\"event\":\"task.cleaned_up\",\"task\":\"last-9c2e\"}\n");
        std::fs::write(&path, &body).unwrap();
        let first = read_ledger(&path, Cursor::default()).unwrap().unwrap();
        assert!(first.cursor.offset <= READ_CAP, "at most 4 MiB a cycle");
        assert_eq!(first.cursor.offset % line.len() as u64, 0, "at a line boundary");
        assert!(first.events.is_empty());
        let rest = read_ledger(&path, first.cursor).unwrap().unwrap();
        assert_eq!(rest.cursor.offset, body.len() as u64, "the next cycle reads the rest");
        assert_eq!(rest.events.iter().map(|e| e.task.as_str()).collect::<Vec<_>>(), ["last-9c2e"]);

        // One line longer than the cap is skipped, never a reading stuck on it.
        let huge = dir.path().join("huge.jsonl");
        std::fs::write(&huge, format!("{}\n{{\"v\":1,\"ts\":9,\"event\":\"task.cleaned_up\",\"task\":\"after-9c2e\"}}\n", "y".repeat(100))).unwrap();
        let skipped = read_ledger_capped(&huge, Cursor::default(), 50).unwrap().unwrap();
        assert_eq!(skipped.cursor.offset, 50);
    }
}
