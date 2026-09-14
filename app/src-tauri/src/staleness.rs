//! PRD R12, in Rust for the window's reads and the menu bar. The CLI makes the same comparison in
//! `packages/store/src/staleness.ts`; both are held to `fixtures/staleness-cases.json`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReadingState {
    Fresh,
    Stale,
    Dead,
    Reset,
}

/// `updated_at` is when the reading was true (None if the reader never succeeded); the limits come
/// from the reader's `reader_status` row; `resets_at` applies to quota rows only.
pub fn reading_state(updated_at: Option<i64>, stale_after_ms: i64, dead_after_ms: i64, resets_at: Option<i64>, now: i64) -> ReadingState {
    let Some(updated_at) = updated_at else {
        return ReadingState::Dead;
    };
    // Reset outranks dead and stale: the stored number belongs to a window that has ended.
    if resets_at.is_some_and(|r| now >= r) {
        return ReadingState::Reset;
    }
    let age = now - updated_at;
    if age > dead_after_ms {
        ReadingState::Dead
    } else if age > stale_after_ms {
        ReadingState::Stale
    } else {
        ReadingState::Fresh
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Case {
        name: String,
        updated_at: Option<i64>,
        now: i64,
        stale_after_ms: i64,
        dead_after_ms: i64,
        resets_at: Option<i64>,
        expected: String,
    }

    #[test]
    fn matches_the_shared_cases() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/staleness-cases.json");
        let cases: Vec<Case> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert!(!cases.is_empty());
        for c in cases {
            let state = reading_state(c.updated_at, c.stale_after_ms, c.dead_after_ms, c.resets_at, c.now);
            assert_eq!(serde_json::to_value(state).unwrap(), serde_json::Value::String(c.expected.clone()), "{}", c.name);
        }
    }
}
