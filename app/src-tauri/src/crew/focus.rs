//! "The end of your last session" on the Mac (DESIGN.md 1.4; build spec §7 Window focus): the last time the window had
//! focus before a stretch of 60 minutes without it. Two settings keys hold it — `window_focus_last_at`, stamped on every
//! focus change and each minute while focused, and `window_session_end_at`, which takes the last stamp when focus
//! returns more than 60 minutes after it. Home's Overnight counts what happened since then, 24 hours at most.

use crate::system::{get_setting, put_setting};
use rusqlite::Connection;

pub(crate) const LAST_KEY: &str = "window_focus_last_at";
pub(crate) const END_KEY: &str = "window_session_end_at";
const SESSION_GAP_MS: i64 = 60 * 60_000;
const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Stamps {
    pub last: Option<i64>,
    pub session_end: Option<i64>,
}

/// The stamps after a focus change (`focused`) or the minute's tick while focused (`false`): the last one moves to now;
/// focus coming back more than 60 minutes after it ends the session there.
pub(crate) fn on_focus(prev: &Stamps, focused: bool, now: i64) -> Stamps {
    let session_end = match prev.last {
        Some(last) if focused && now - last > SESSION_GAP_MS => Some(last),
        _ => prev.session_end,
    };
    Stamps { last: Some(now), session_end }
}

/// When the night began: the end of the last session, 24 hours ago at most.
pub(crate) fn overnight_since(s: &Stamps, now: i64) -> i64 {
    s.session_end.unwrap_or(0).max(now - DAY_MS)
}

pub(crate) fn stamps(conn: &Connection, org: &str) -> Stamps {
    let at = |key| get_setting(conn, org, key).and_then(|v| v.as_i64());
    Stamps { last: at(LAST_KEY), session_end: at(END_KEY) }
}

/// Reads, moves and writes the stamps under the caller's one guard.
pub(crate) fn stamp(conn: &Connection, org: &str, focused: bool, now: i64) -> rusqlite::Result<()> {
    let next = on_focus(&stamps(conn, org), focused, now);
    if let Some(last) = next.last {
        put_setting(conn, org, LAST_KEY, &serde_json::json!(last))?;
    }
    if let Some(end) = next.session_end {
        put_setting(conn, org, END_KEY, &serde_json::json!(end))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;
    const NINE: i64 = 1_790_000_000_000;

    #[test]
    fn sixty_minutes_ends_a_session() {
        let at_nine = Stamps { last: Some(NINE), session_end: None };
        assert_eq!(on_focus(&at_nine, true, NINE + 61 * MIN), Stamps { last: Some(NINE + 61 * MIN), session_end: Some(NINE) });
        assert_eq!(on_focus(&at_nine, true, NINE + 59 * MIN), Stamps { last: Some(NINE + 59 * MIN), session_end: None }, "under an hour: the same session");
        assert_eq!(on_focus(&at_nine, false, NINE + 3 * 60 * MIN).session_end, None, "losing focus or the minute's tick never ends one");
        assert_eq!(on_focus(&Stamps::default(), true, NINE), Stamps { last: Some(NINE), session_end: None });

        let ended = Stamps { last: Some(NINE + 61 * MIN), session_end: Some(NINE) };
        assert_eq!(overnight_since(&ended, NINE + 2 * 60 * MIN), NINE);
        assert_eq!(overnight_since(&ended, NINE + 30 * 60 * MIN), NINE + 6 * 60 * MIN, "capped at 24 hours");
        assert_eq!(overnight_since(&Stamps::default(), NINE), NINE - DAY_MS);
    }

    #[test]
    fn the_stamps_round_trip_through_settings() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(dir.path()).unwrap();
        let conn = store.conn();
        stamp(&conn, store.org_id(), true, NINE).unwrap();
        stamp(&conn, store.org_id(), true, NINE + 90 * MIN).unwrap();
        assert_eq!(stamps(&conn, store.org_id()), Stamps { last: Some(NINE + 90 * MIN), session_end: Some(NINE) });
    }
}
