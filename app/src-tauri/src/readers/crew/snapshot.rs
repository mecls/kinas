//! The typed parse of Firstmate's fleet snapshot (`bin/fm-fleet-snapshot.sh --json`, schema `fm-fleet-snapshot.v1`,
//! read at the pin: `:1-118` for the schema, `:886-927` for a task row). Only the schema is checked; unknown fields are
//! ignored, so Firstmate may add to its contract without breaking the mirror (build spec §6.5).
//!
//! The task list is every structured backlog record, enriched by its `tasks[]` row when one exists (slice 0): queued
//! work and a finished scout exist only as backlog records, and a task row with no record still counts.

use serde_json::Value;

pub(crate) const FLEET_SCHEMA: &str = "fm-fleet-snapshot.v1";

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct TaskFacts {
    pub id: String,
    pub title: Option<String>,
    pub excerpt: Option<String>,
    /// Firstmate's own clone of the project, `<home>/projects/<name>` (slice 0): never a client folder.
    pub project: Option<String>,
    /// The clone's folder name, else the backlog record's `repo:` metadata — the project's name in Firstmate.
    pub project_name: Option<String>,
    pub kind: String,
    /// The backlog section: `in_flight`, `queued` or `done`; `None` for a task row with no record.
    pub backlog_state: Option<String>,
    pub state: Option<String>,
    pub state_source: Option<String>,
    pub state_detail: Option<String>,
    pub state_observed_at: Option<String>,
    pub mode: Option<String>,
    pub yolo: bool,
    pub harness: Option<String>,
    pub backend: Option<String>,
    pub endpoint_target: Option<String>,
    pub endpoint_exists: Option<bool>,
    pub endpoint_status: Option<String>,
    pub worktree_path: Option<String>,
    pub worktree_present: Option<bool>,
    pub report_path: Option<String>,
    pub report_present: bool,
    pub pr_url: Option<String>,
    pub pending_decision: bool,
    pub blocked_event: bool,
    pub captain_actionable: bool,
    pub hold_reason: Option<String>,
    /// `hints.open_decisions[]`: (key, verb, summary).
    pub open_decisions: Vec<(String, String, String)>,
    /// `paths.status_log.last_event`: (raw, `<state>: <note>`, age in seconds when Firstmate knows it).
    pub last_event: Option<(String, String, Option<i64>)>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Fleet {
    pub generated: String,
    pub tasks: Vec<TaskFacts>,
    /// `main_inventory.orphan_in_flight`: in flight in the backlog with no task record.
    pub orphans: Vec<String>,
}

impl Fleet {
    /// Open decisions plus captain holds: the count the log line carries (§6.13).
    pub fn decision_count(&self) -> usize {
        self.tasks.iter().map(|t| t.open_decisions.len() + usize::from(t.captain_actionable)).sum()
    }
}

pub(crate) fn parse_fleet(json: &str) -> Result<Fleet, String> {
    let root: Value = serde_json::from_str(json).map_err(|e| format!("the fleet snapshot is not JSON: {e}"))?;
    let schema = root.get("schema").and_then(Value::as_str);
    if schema != Some(FLEET_SCHEMA) {
        return Err(format!("unsupported snapshot contract {}, expected {FLEET_SCHEMA}", schema.unwrap_or("(none)")));
    }
    let generated = text(&root, &["generated"]).unwrap_or_default();
    let reports: Vec<(String, String)> = array(&root, &["scout_reports"])
        .iter()
        .filter_map(|r| Some((text(r, &["id"])?, text(r, &["path"])?)))
        .collect();

    let mut tasks: Vec<TaskFacts> = Vec::new();
    for record in array(&root, &["backlog", "records"]) {
        if record.get("structured").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let Some(id) = text(record, &["id"]) else { continue };
        if tasks.iter().any(|t| t.id == id) {
            continue;
        }
        let mut facts = TaskFacts { id, ..TaskFacts::default() };
        apply_record(&mut facts, record);
        tasks.push(facts);
    }
    for row in array(&root, &["tasks"]) {
        let Some(id) = text(row, &["id"]) else { continue };
        let index = match tasks.iter().position(|t| t.id == id) {
            Some(i) => i,
            None => {
                let mut facts = TaskFacts { id, ..TaskFacts::default() };
                if let Some(record) = row.get("backlog").filter(|b| b.is_object()) {
                    apply_record(&mut facts, record);
                }
                tasks.push(facts);
                tasks.len() - 1
            }
        };
        apply_row(&mut tasks[index], row);
    }
    for facts in &mut tasks {
        if facts.kind.is_empty() {
            facts.kind = "ship".into();
        }
        if facts.report_path.is_none() {
            if let Some((_, path)) = reports.iter().find(|(id, _)| *id == facts.id) {
                facts.report_path = Some(path.clone());
                facts.report_present = true;
            }
        }
        facts.project_name = facts.project.as_deref().and_then(last_component).or_else(|| facts.project_name.take());
    }
    let orphans = array(&root, &["main_inventory", "orphan_in_flight"])
        .iter()
        .filter_map(|o| o.as_str().map(str::to_string).or_else(|| text(o, &["id"])))
        .collect();
    Ok(Fleet { generated, tasks, orphans })
}

/// A backlog record's facts. Its `repo:` is free text naming the project in Firstmate, never a GitHub repository.
fn apply_record(f: &mut TaskFacts, r: &Value) {
    f.title = text(r, &["title"]);
    f.excerpt = text(r, &["body_excerpt"]);
    f.kind = text(r, &["kind"]).unwrap_or_default();
    f.backlog_state = text(r, &["state"]);
    f.captain_actionable = r.get("captain_actionable").and_then(Value::as_bool).unwrap_or(false);
    f.hold_reason = text(r, &["hold_reason"]);
    f.pr_url = text(r, &["pr_url"]);
    f.report_path = text(r, &["report_path"]);
    f.project_name = text(r, &["repo"]);
}

/// A `tasks[]` row's facts, over the record's where both speak.
fn apply_row(f: &mut TaskFacts, t: &Value) {
    if let Some(kind) = text(t, &["kind"]) {
        f.kind = kind;
    }
    f.project = text(t, &["project"]);
    f.harness = text(t, &["harness"]);
    f.mode = text(t, &["mode"]);
    f.yolo = matches!(text(t, &["yolo"]).as_deref(), Some("on" | "yes" | "true" | "1"));
    f.backend = text(t, &["backend"]);
    f.state = text(t, &["current_state", "state"]);
    f.state_source = text(t, &["current_state", "source"]);
    f.state_detail = text(t, &["current_state", "detail"]);
    f.state_observed_at = text(t, &["current_state", "observed_at"]);
    f.endpoint_target = text(t, &["endpoint", "target"]);
    f.endpoint_exists = at(t, &["endpoint", "exists"]).and_then(Value::as_bool);
    f.endpoint_status = text(t, &["endpoint", "status"]);
    f.worktree_path = text(t, &["paths", "worktree", "path"]);
    f.worktree_present = at(t, &["paths", "worktree", "present"]).and_then(Value::as_bool);
    if let Some(report) = text(t, &["paths", "report", "path"]) {
        f.report_path = Some(report);
        f.report_present = at(t, &["paths", "report", "present"]).and_then(Value::as_bool).unwrap_or(false);
    }
    if let Some(url) = text(t, &["pr", "url"]) {
        f.pr_url = Some(url);
    }
    f.pending_decision = at(t, &["hints", "pending_decision"]).and_then(Value::as_bool).unwrap_or(false);
    f.blocked_event = at(t, &["hints", "blocked_event"]).and_then(Value::as_bool).unwrap_or(false);
    f.open_decisions = array(t, &["hints", "open_decisions"])
        .iter()
        .filter_map(|d| Some((text(d, &["key"])?, text(d, &["verb"])?, text(d, &["summary"]).unwrap_or_default())))
        .collect();
    f.last_event = at(t, &["paths", "status_log", "last_event"]).and_then(|e| {
        let raw = text(e, &["raw"])?;
        let state = text(e, &["state"]).unwrap_or_default();
        let note = text(e, &["note"]).unwrap_or_default();
        let line = match (state.is_empty(), note.is_empty()) {
            (false, false) => format!("{state}: {note}"),
            (false, true) => state,
            (true, false) => note,
            (true, true) => raw.clone(),
        };
        Some((raw, line, e.get("age_seconds").and_then(Value::as_i64)))
    });
}

fn at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(v, |v, key| v.get(key))
}

/// A non-empty string at `path`; Firstmate writes `""` for "none" as often as `null`.
fn text(v: &Value, path: &[&str]) -> Option<String> {
    at(v, path).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn array<'a>(v: &'a Value, path: &[&str]) -> &'a [Value] {
    at(v, path).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn last_component(path: &str) -> Option<String> {
    path.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty()).map(str::to_string)
}

/// `endpoint.target` is `<session>:<pane>`, and a Herdr pane id holds a colon of its own (`w2:p2`), so the split is at
/// the FIRST colon (§6.8).
pub(crate) fn split_target(target: &str) -> Option<(&str, &str)> {
    let (session, pane) = target.split_once(':')?;
    (!session.is_empty() && !pane.is_empty()).then_some((session, pane))
}

/// `^https://github\.com/[^/]+/[^/]+/pull/\d+$` — the only PR URL `gh` is ever handed (§10).
#[allow(dead_code)]
pub(crate) fn pr_url_ok(url: &str) -> bool {
    pr_number(url).is_some()
}

pub(crate) fn pr_number(url: &str) -> Option<u32> {
    let rest = url.strip_prefix("https://github.com/")?;
    let parts: Vec<&str> = rest.split('/').collect();
    match parts.as_slice() {
        [owner, repo, "pull", number] if !owner.is_empty() && !repo.is_empty() && !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()) => {
            number.parse().ok()
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)).unwrap()
    }

    fn task<'a>(fleet: &'a Fleet, id: &str) -> &'a TaskFacts {
        fleet.tasks.iter().find(|t| t.id == id).unwrap_or_else(|| panic!("no task {id}"))
    }

    #[test]
    fn parses_the_synthetic_and_the_captures() {
        let old = parse_fleet(&fixture("firstmate-fleet-snapshot.synthetic.json")).unwrap();
        assert_eq!(old.tasks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t-101", "t-102", "t-103", "t-090"]);
        let t101 = task(&old, "t-101");
        assert_eq!(t101.title.as_deref(), Some("Add login rate limiting"));
        assert_eq!((t101.state.as_deref(), t101.backlog_state.as_deref()), (Some("working"), Some("in_flight")));
        assert_eq!(t101.endpoint_target.as_deref(), Some("w1:p1"));
        assert_eq!(t101.last_event.as_ref().map(|e| e.1.as_str()), Some("working: running tests"));
        assert!(task(&old, "t-102").captain_actionable);
        assert_eq!(task(&old, "t-103").backlog_state.as_deref(), Some("queued"));
        assert_eq!(old.decision_count(), 1);

        let working = parse_fleet(&fixture("firstmate-fleet-snapshot.working.captured.json")).unwrap();
        assert_eq!(working.generated, "2026-09-23T21:17:58Z");
        assert_eq!(working.tasks.len(), 2);
        let scout = task(&working, "scratch-count-files-c4");
        assert_eq!(scout.kind, "scout");
        assert_eq!(scout.title.as_deref(), Some("count the files in the scratch repository and report the number"));
        assert_eq!(scout.project_name.as_deref(), Some("scratch"));
        assert_eq!(scout.project.as_deref(), Some("__FM_HOME__/projects/scratch"));
        assert_eq!(scout.state.as_deref(), Some("working"));
        assert_eq!(scout.endpoint_target.as_deref(), Some("kinas-probe-0923:w2:p2"));
        assert_eq!((scout.endpoint_exists, scout.endpoint_status.as_deref()), (Some(true), Some("unknown")));
        assert_eq!(scout.last_event, None, "an empty raw is no event");

        let held = parse_fleet(&fixture("firstmate-fleet-snapshot.held.captured.json")).unwrap();
        let ship = task(&held, "scratch-readme-kinas-r8");
        assert!(ship.captain_actionable);
        assert_eq!((ship.state.as_deref(), ship.backlog_state.as_deref()), (Some("done"), Some("in_flight")));
        assert!(ship.hold_reason.as_deref().unwrap().starts_with("Approve landing branch"));
        assert_eq!(ship.last_event.as_ref().map(|e| e.0.as_str()), Some("done [at=1790198477]: ready in branch fm/scratch-readme-kinas-r8"));
        // A finished scout has left tasks[] and remains a done backlog record with its report.
        let scout = task(&held, "scratch-count-files-c4");
        assert_eq!((scout.backlog_state.as_deref(), scout.state.as_deref()), (Some("done"), None));
        assert_eq!(scout.project_name.as_deref(), Some("scratch"));
        assert_eq!(scout.report_path.as_deref(), Some("data/scratch-count-files-c4/report.md"));

        let done = parse_fleet(&fixture("firstmate-fleet-snapshot.done.captured.json")).unwrap();
        assert_eq!(done.tasks.len(), 2);
        assert!(done.tasks.iter().all(|t| t.backlog_state.as_deref() == Some("done")));
        assert_eq!(done.decision_count(), 0);

        let empty = parse_fleet(&fixture("firstmate-fleet-snapshot.empty.captured.json")).unwrap();
        assert!(empty.tasks.is_empty() && empty.orphans.is_empty());

        for name in ["empty", "queued", "working", "done"] {
            let fleet = parse_fleet(&fixture(&format!("crew-snapshot.{name}.synthetic.json"))).unwrap();
            assert!(fleet.tasks.iter().all(|t| t.id.contains("9c2e") && t.title.as_deref().is_some_and(|x| x.contains("9c2e"))), "{name}");
        }
    }

    #[test]
    fn a_task_row_without_a_record_still_counts() {
        let json = r#"{"schema":"fm-fleet-snapshot.v1","generated":"g","backlog":{"records":[]},
            "tasks":[{"id":"x-9c2e","kind":"scout","project":"/h/projects/p-9c2e","current_state":{"state":"working"}}]}"#;
        let fleet = parse_fleet(json).unwrap();
        assert_eq!(fleet.tasks.len(), 1);
        let t = &fleet.tasks[0];
        assert_eq!((t.kind.as_str(), t.backlog_state.as_deref(), t.project_name.as_deref()), ("scout", None, Some("p-9c2e")));
    }

    #[test]
    fn unstructured_records_and_unknown_fields_are_skipped() {
        let json = r#"{"schema":"fm-fleet-snapshot.v1","generated":"g","new_field":{"x":1},
            "backlog":{"records":[{"structured":false,"id":null,"raw":"- a note"},{"structured":true,"id":"a-9c2e","state":"queued","title":"T 9c2e","future":1}]},
            "main_inventory":{"orphan_in_flight":["b-9c2e"]}}"#;
        let fleet = parse_fleet(json).unwrap();
        assert_eq!(fleet.tasks.len(), 1);
        assert_eq!(fleet.tasks[0].kind, "ship", "a record without a kind is a ship");
        assert_eq!(fleet.orphans, ["b-9c2e"]);
    }

    #[test]
    fn refuses_another_schema() {
        let err = parse_fleet(r#"{"schema":"fm-fleet-snapshot.v2","tasks":[]}"#).unwrap_err();
        assert_eq!(err, "unsupported snapshot contract fm-fleet-snapshot.v2, expected fm-fleet-snapshot.v1");
        assert_eq!(parse_fleet(r#"{"tasks":[]}"#).unwrap_err(), "unsupported snapshot contract (none), expected fm-fleet-snapshot.v1");
        assert!(parse_fleet("not json").unwrap_err().starts_with("the fleet snapshot is not JSON"));
    }

    #[test]
    fn split_target_at_the_first_colon() {
        assert_eq!(split_target("default:w1:p2"), Some(("default", "w1:p2")));
        assert_eq!(split_target("kinas-probe-0923:w3:p2"), Some(("kinas-probe-0923", "w3:p2")));
        assert_eq!(split_target("w1p2"), None);
        assert_eq!(split_target(":w1:p2"), None);
        assert_eq!(split_target("default:"), None);
    }

    #[test]
    fn pr_url_ok_and_number() {
        assert!(pr_url_ok("https://github.com/o/r/pull/12"));
        assert_eq!(pr_number("https://github.com/o/r/pull/12"), Some(12));
        for bad in [
            "http://github.com/o/r/pull/12",
            "https://github.com/o/r/pull/12/files",
            "https://github.com/o/r/pull/",
            "https://github.com/o/r/pull/12a",
            "https://github.com/o/r/issues/12",
            "https://github.com//r/pull/12",
            "https://github.com/o/r/pull/12?x=1",
            "https://gitlab.com/o/r/pull/12",
        ] {
            assert!(!pr_url_ok(bad), "{bad}");
        }
    }
}
