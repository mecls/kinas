//! A task's pull request as GitHub reports it (build spec §6.9, §10): `gh pr view <url> --json …`, run as the captain
//! with the login `PATH`, 10 s, handed only a URL that passed `snapshot::pr_url_ok`. Nothing but the state, the draft
//! flag, mergeability, the review decision and each check's name and conclusion is kept; titles and bodies are never
//! asked for.

use super::snapshot::pr_url_ok;
use crate::crew::tools::which;
use crate::login_path::login_path;
use crate::proc::{self, Exit, Run};
use serde_json::Value;
use std::time::Duration;

const GH_LIMIT: Duration = Duration::from_secs(10);
const FIELDS: &str = "number,state,isDraft,mergeable,reviewDecision,statusCheckRollup";

/// Conclusions that fail a check, as GitHub's own checks list counts them.
const FAILING: [&str; 5] = ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PrFacts {
    pub url: String,
    pub number: u32,
    /// OPEN | CLOSED | MERGED.
    pub state: String,
    pub draft: bool,
    /// MERGEABLE | CONFLICTING | UNKNOWN.
    pub mergeable: String,
    /// APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED, or None when GitHub has none.
    pub review: Option<String>,
    /// (name, conclusion): SUCCESS, FAILURE, PENDING, NEUTRAL, SKIPPED, … — a running check is PENDING.
    pub checks: Vec<(String, String)>,
}

impl PrFacts {
    pub(crate) fn checks_failed(&self) -> u32 {
        self.checks.iter().filter(|(_, c)| FAILING.contains(&c.as_str())).count() as u32
    }

    pub(crate) fn checks_total(&self) -> u32 {
        self.checks.len() as u32
    }
}

/// `checks 3/4 · 1 failing`, the `checks` event's text and the card's PR line after the number (`crew/board.ts`
/// `prLine` says the same). None before GitHub reports a check.
pub(crate) fn checks_text(total: u32, failed: u32) -> Option<String> {
    if total == 0 {
        return None;
    }
    let passed = total.saturating_sub(failed);
    Some(if failed > 0 { format!("checks {passed}/{total} · {failed} failing") } else { format!("checks {passed}/{total}") })
}

/// `gh pr view <url>`: the facts, or why not — for the caller to keep the last good values (ADR 0004), never for the
/// log.
pub(crate) fn pr_view(url: &str) -> Result<PrFacts, String> {
    if !pr_url_ok(url) {
        return Err("not a GitHub pull request URL".into());
    }
    let path = login_path();
    let gh = which("gh", path).ok_or("gh isn't installed")?;
    let ran = proc::run(&Run { program: &gh, args: &["pr", "view", url, "--json", FIELDS], cwd: None, set: &[("PATH", path)], limit: GH_LIMIT })?;
    match ran.exit {
        Exit::Code(0) => parse(url, &ran.stdout),
        Exit::Code(code) => Err(format!("gh exited {code}")),
        Exit::Signal => Err("gh was stopped by a signal".into()),
        Exit::TimedOut => Err("gh did not answer within 10 s".into()),
    }
}

pub(crate) fn parse(url: &str, json: &str) -> Result<PrFacts, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("gh's answer is not JSON: {e}"))?;
    let text = |key: &str| v.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_uppercase);
    let number = v.get("number").and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok()).ok_or("gh's answer has no number")?;
    let checks = v
        .get("statusCheckRollup")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(check)
        .collect();
    Ok(PrFacts {
        url: url.to_string(),
        number,
        state: text("state").unwrap_or_else(|| "UNKNOWN".into()),
        draft: v.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        mergeable: text("mergeable").unwrap_or_else(|| "UNKNOWN".into()),
        review: text("reviewDecision"),
        checks,
    })
}

/// One entry of `statusCheckRollup`: a check run (`name`, `status`, `conclusion`) or a commit status (`context`,
/// `state`).
fn check(c: &Value) -> Option<(String, String)> {
    let s = |key: &str| c.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_uppercase);
    if let Some(name) = c.get("name").and_then(Value::as_str).filter(|n| !n.is_empty()) {
        let conclusion = match (s("status").as_deref(), s("conclusion")) {
            (Some("COMPLETED"), Some(c)) => c,
            _ => "PENDING".into(),
        };
        return Some((name.to_string(), conclusion));
    }
    let name = c.get("context").and_then(Value::as_str).filter(|n| !n.is_empty())?;
    let conclusion = match s("state").as_deref() {
        Some("SUCCESS") => "SUCCESS",
        Some("FAILURE" | "ERROR") => "FAILURE",
        _ => "PENDING",
    };
    Some((name.to_string(), conclusion.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://github.com/o/shop-9c2e/pull/123";

    fn fixture(n: u32) -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/crew-gh-{n}.json"))).unwrap()
    }

    #[test]
    fn parses_checks_runs_and_statuses() {
        let red = parse(URL, &fixture(1)).unwrap();
        assert_eq!((red.number, red.state.as_str(), red.draft, red.mergeable.as_str()), (123, "OPEN", false, "MERGEABLE"));
        assert_eq!(red.review.as_deref(), Some("REVIEW_REQUIRED"));
        assert_eq!((red.checks_total(), red.checks_failed()), (4, 1));
        assert_eq!(checks_text(red.checks_total(), red.checks_failed()).as_deref(), Some("checks 3/4 · 1 failing"));
        assert!(red.checks.contains(&("ci/circleci".into(), "SUCCESS".into())), "a commit status by its context");

        let green = parse(URL, &fixture(2)).unwrap();
        assert_eq!((green.checks_total(), green.checks_failed()), (4, 0));
        assert_eq!(checks_text(4, 0).as_deref(), Some("checks 4/4"));
        assert_eq!(green.review.as_deref(), Some("APPROVED"));
    }

    #[test]
    fn a_running_check_is_pending_and_an_empty_answer_has_no_checks() {
        let json = r#"{"number":7,"state":"OPEN","isDraft":true,"mergeable":"UNKNOWN","reviewDecision":"","statusCheckRollup":[
            {"__typename":"CheckRun","name":"build","status":"IN_PROGRESS","conclusion":""},
            {"__typename":"StatusContext","context":"deploy","state":"ERROR"}]}"#;
        let pr = parse(URL, json).unwrap();
        assert_eq!(pr.checks, vec![("build".into(), "PENDING".into()), ("deploy".into(), "FAILURE".into())]);
        assert_eq!((pr.draft, pr.review), (true, None));
        assert_eq!(checks_text(0, 0), None);
        assert!(parse(URL, r#"{"state":"OPEN"}"#).is_err(), "no number, no PR");
        assert!(parse(URL, "gh: not logged in").is_err());
    }

    #[test]
    fn only_a_pull_request_url_reaches_gh() {
        for bad in ["https://github.com/o/r/pull/1;rm -rf", "--help", "https://evil.example/o/r/pull/1"] {
            assert_eq!(pr_view(bad).unwrap_err(), "not a GitHub pull request URL", "{bad}");
        }
    }
}
