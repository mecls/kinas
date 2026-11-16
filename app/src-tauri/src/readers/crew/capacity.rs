//! Free lanes (Firstmate, current; build spec §11.2): the typed parse of `bin/fm-capacity.sh --json`, schema
//! `fm-lane-capacity.v1` (read at the pin: the header's `--json` paragraph and the document at `:1328-1348`). Only the
//! schema is checked; of the document Kinas keeps the cap, the lane count and the verdict, and drops the host's figures,
//! paths and quota. The script runs only behind `crew::config::lane_config`'s gate (no `quota-provider`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const CAPACITY_SCHEMA: &str = "fm-lane-capacity.v1";
/// Verdict reasons are shown in Firstmate's own words, at most this many, each at most `REASON_CHARS` long.
const REASONS: usize = 4;
const REASON_CHARS: usize = 120;

/// The last good lane reading, kept in `settings` as `crew_capacity`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Lanes {
    /// `cap.status`: ok | none | invalid.
    pub status: String,
    /// `cap.target` when the status is ok.
    pub cap: Option<u32>,
    /// `cap.mode == "auto"`: a measured budget instead of a fixed cap.
    pub auto: bool,
    /// `lanes.count`: the lanes running now.
    pub count: u32,
    /// `verdict.free_lanes` when Firstmate gives a number.
    pub free: Option<u32>,
    /// `verdict.admit`: false while Firstmate holds dispatch.
    pub admit: bool,
    pub reasons: Vec<String>,
    /// Kinas's clock when the reading was taken.
    pub at: i64,
}

/// The document as Lanes, or why not: another schema, not JSON, or a field of the wrong kind.
pub(crate) fn parse_capacity(json: &str, now: i64) -> Result<Lanes, String> {
    let root: Value = serde_json::from_str(json).map_err(|_| "the lane capacity is not JSON".to_string())?;
    let schema = root.get("schema").and_then(Value::as_str);
    if schema != Some(CAPACITY_SCHEMA) {
        return Err(format!("unsupported contract {}", schema.filter(|s| plain(s)).unwrap_or("(none)")));
    }
    let status = root.pointer("/cap/status").and_then(Value::as_str).filter(|s| matches!(*s, "ok" | "none" | "invalid")).ok_or("the lane capacity has no cap status")?;
    let count = |p: &str| root.pointer(p).and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok());
    let reasons = root
        .pointer("/verdict/reasons")
        .and_then(Value::as_array)
        .map(|r| r.iter().filter_map(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).take(REASONS).map(|s| s.chars().filter(|c| !c.is_control()).take(REASON_CHARS).collect()).collect())
        .unwrap_or_default();
    Ok(Lanes {
        status: status.to_string(),
        cap: if status == "ok" { count("/cap/target") } else { None },
        auto: root.pointer("/cap/mode").and_then(Value::as_str) == Some("auto"),
        count: count("/lanes/count").unwrap_or(0),
        free: count("/verdict/free_lanes"),
        admit: root.pointer("/verdict/admit").and_then(Value::as_bool).unwrap_or(false),
        reasons,
        at: now,
    })
}

/// A schema name safe to say in a status line: short, and letters, digits, `.`, `-` and `_` only.
fn plain(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(format!("crew-capacity.{name}.synthetic.json"))).unwrap()
    }

    #[test]
    fn reads_cap_auto_and_held() {
        let cap4 = parse_capacity(&fixture("cap4"), 7).unwrap();
        assert_eq!(cap4, Lanes { status: "ok".into(), cap: Some(4), auto: false, count: 2, free: Some(2), admit: true, reasons: vec![], at: 7 });
        let auto = parse_capacity(&fixture("auto"), 7).unwrap();
        assert_eq!((auto.status.as_str(), auto.cap, auto.auto, auto.free, auto.admit), ("none", None, true, Some(3), true));
        let held = parse_capacity(&fixture("held"), 7).unwrap();
        assert_eq!((held.cap, held.free, held.admit), (Some(4), Some(0), false));
        assert_eq!(held.reasons.len(), 4, "at most four reasons");
        assert!(held.reasons.iter().all(|r| r.chars().count() <= 120), "each at most 120 characters");
        assert_eq!(held.reasons[0], "memory: 8% free");
        assert_eq!(held.reasons[3].chars().count(), 120, "a long reason is cut at 120");
    }

    #[test]
    fn refuses_another_schema() {
        assert_eq!(parse_capacity(&fixture("v2"), 7).unwrap_err(), "unsupported contract fm-lane-capacity.v2");
        assert_eq!(parse_capacity(r#"{"schema":"a b\nc"}"#, 7).unwrap_err(), "unsupported contract (none)", "a schema is said only when it is plain");
        assert_eq!(parse_capacity("nope", 7).unwrap_err(), "the lane capacity is not JSON");
    }
}
