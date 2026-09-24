//! A task's one word (build spec §7): derived at read time from the mirror's columns, never stored, first match wins.
//! `fixtures/crew-words.json` holds the cases, and the CLI's `crew-words.ts` reads the same file, so the Crew page and
//! `kinas crew status` never disagree about what a task is doing.

/// What the word rule needs of a task's PR; present only when the task has a PR URL.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct PrWordInput<'a> {
    pub state: Option<&'a str>,
    pub draft: bool,
    pub mergeable: Option<&'a str>,
    pub checks_total: Option<u32>,
    pub checks_failed: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct WordInput<'a> {
    pub gone: bool,
    pub done: bool,
    /// Firstmate's `current_state.state` (`fm-crew-state.sh`'s word).
    pub state: Option<&'a str>,
    /// The backlog record's section: `in_flight`, `queued` or `done`.
    pub backlog_state: Option<&'a str>,
    pub pending_decision: bool,
    pub captain_actionable: bool,
    pub blocked_event: bool,
    pub pr: Option<PrWordInput<'a>>,
}

pub(crate) fn word_of(w: &WordInput) -> &'static str {
    let state = w.state.unwrap_or("");
    if w.gone {
        "gone"
    } else if w.done {
        "done"
    } else if state == "failed" {
        "failed"
    } else if w.pending_decision || state == "parked" || w.captain_actionable {
        "needs decision"
    } else if w.blocked_event || state == "blocked" {
        "blocked"
    } else if state == "paused" {
        "paused"
    } else if let Some(pr) = w.pr {
        let failed = pr.checks_failed.unwrap_or(0);
        if pr.state == Some("OPEN") && !pr.draft && pr.mergeable == Some("MERGEABLE") && pr.checks_total.unwrap_or(0) > 0 && failed == 0 {
            "ready"
        } else if failed > 0 {
            "CI red"
        } else {
            "PR open"
        }
    } else if state == "working" {
        "working"
    } else if w.backlog_state == Some("queued") {
        "queued"
    } else {
        "unknown"
    }
}

/// The word without the gone rule: a task that finished overnight and was then torn down still counts as done.
pub(crate) fn word_without_gone(w: &WordInput) -> &'static str {
    word_of(&WordInput { gone: false, ..*w })
}

/// Home's overnight buckets (§7): done; working; wait (on the captain); fail. Home reads them from slice 7.
#[allow(dead_code)]
pub(crate) fn overnight_bucket(word_without_gone: &str) -> &'static str {
    match word_without_gone {
        "done" => "done",
        "needs decision" | "ready" => "wait",
        "failed" | "blocked" | "CI red" => "fail",
        _ => "working",
    }
}

/// In flight = any word but queued, done and gone (§17, settled by default). The lanes' counts use it from slice 4.
#[allow(dead_code)]
pub(crate) fn in_flight(word: &str) -> bool {
    !matches!(word, "queued" | "done" | "gone")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
        v.get(key).and_then(Value::as_str)
    }

    fn flag(v: &Value, key: &str) -> bool {
        v.get(key).and_then(Value::as_bool).expect(key)
    }

    fn count(v: &Value, key: &str) -> Option<u32> {
        v.get(key).and_then(Value::as_u64).map(|n| n as u32)
    }

    #[test]
    fn every_case_in_the_shared_fixture() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/crew-words.json");
        let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let cases = fixture["cases"].as_array().unwrap();
        assert!(cases.len() >= 12, "one case per row of §7's table at least");
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let i = &case["input"];
            let pr = i.get("pr").filter(|p| !p.is_null()).map(|p| PrWordInput {
                state: text(p, "state"),
                draft: flag(p, "draft"),
                mergeable: text(p, "mergeable"),
                checks_total: count(p, "checks_total"),
                checks_failed: count(p, "checks_failed"),
            });
            let input = WordInput {
                gone: flag(i, "gone"),
                done: flag(i, "done"),
                state: text(i, "state"),
                backlog_state: text(i, "backlog_state"),
                pending_decision: flag(i, "pending_decision"),
                captain_actionable: flag(i, "captain_actionable"),
                blocked_event: flag(i, "blocked_event"),
                pr,
            };
            assert_eq!(word_of(&input), case["word"].as_str().unwrap(), "{name}");
            assert_eq!(overnight_bucket(word_without_gone(&input)), case["overnight"].as_str().unwrap(), "{name}: overnight");
        }
        // Every word the table names is reached by some case.
        let words: std::collections::HashSet<&str> = cases.iter().map(|c| c["word"].as_str().unwrap()).collect();
        for word in ["gone", "done", "failed", "needs decision", "blocked", "paused", "ready", "CI red", "PR open", "working", "queued", "unknown"] {
            assert!(words.contains(word), "no case says {word}");
        }
    }

    #[test]
    fn in_flight_is_every_word_but_queued_done_and_gone() {
        for word in ["working", "needs decision", "blocked", "CI red", "PR open", "ready", "failed", "paused", "unknown"] {
            assert!(in_flight(word), "{word}");
        }
        for word in ["queued", "done", "gone"] {
            assert!(!in_flight(word), "{word}");
        }
    }
}
