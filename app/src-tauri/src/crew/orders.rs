//! The order log (build spec §6.10, AC-8): what the captain types at a worker's pane is recorded as an `order` event on
//! that worker's task. The line is rebuilt in the webview from the terminal's own bytes (`terminal/orderLine.ts`); here
//! it is cleaned and attributed, in Rust, against a fresh Herdr view — only when the focused pane is a worker's, else it
//! is dropped with no row and no log line. Recording never touches the keystrokes: they reached the PTY already.

use crate::redact::redact;

/// The most an order keeps, in characters.
pub(crate) const ORDER_CAP: usize = 2_000;

/// A worker's pane, as `crew_workers` holds it.
pub(crate) struct WorkerFacts {
    pub task_id: String,
    pub pane_id: String,
}

/// Redacted (`Bearer …`, `sk-ant-…`, GitHub's tokens), NUL-stripped, trimmed, capped at 2,000 characters; None when
/// nothing is left.
pub(crate) fn clean(text: &str) -> Option<String> {
    let text: String = text.chars().filter(|c| *c != '\0').collect();
    let text = redact(text.trim());
    let text: String = text.chars().take(ORDER_CAP).collect();
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// The task whose worker's pane is the focused one — by pane id, never a tab label or a folder (§6.8).
pub(crate) fn attribute(focused_pane: Option<&str>, workers: &[WorkerFacts]) -> Option<String> {
    let focused = focused_pane?;
    workers.iter().find(|w| w.pane_id == focused).map(|w| w.task_id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_redacts_caps_and_strips() {
        assert_eq!(clean("token Bearer abc123").as_deref(), Some("token [redacted]"));
        assert_eq!(clean("use ghp_FAKEabc123 here").as_deref(), Some("use [redacted] here"));
        assert_eq!(clean("dep\0loy").as_deref(), Some("deploy"));
        assert_eq!(clean("  \0 ").as_deref(), None);
        assert_eq!(clean(&"é".repeat(2_001)).map(|t| t.chars().count()), Some(2_000));
    }

    #[test]
    fn attribute_only_worker_panes() {
        let workers = [WorkerFacts { task_id: "shop-9c2e".into(), pane_id: "w2:p2".into() }];
        assert_eq!(attribute(Some("w2:p2"), &workers).as_deref(), Some("shop-9c2e"));
        assert_eq!(attribute(Some("w1:p1"), &workers), None, "the first mate's pane, or any other");
        assert_eq!(attribute(None, &workers), None);
        assert_eq!(attribute(Some("w2:p2"), &[]), None);
    }
}
