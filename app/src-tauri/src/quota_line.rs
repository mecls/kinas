//! One quota line and the menu bar title, in Rust for the menu bar (PRD R39). The CLI formats the same line
//! in `packages/store/src/quota-line.ts`; both are held to `fixtures/quota-line-cases.json`. Left is always
//! floored (build spec invariant 6).

use crate::staleness::ReadingState;

const LABEL_WIDTH: usize = 19;

pub struct QuotaLineInput<'a> {
    pub provider: &'a str,
    pub window: &'a str,
    pub used_pct: f64,
    pub resets_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub state: ReadingState,
    pub reason: Option<&'a str>,
}

pub fn provider_label(provider: &str) -> &str {
    match provider {
        "claude-plan" => "Claude",
        "ollama-cloud" => "Ollama",
        other => other,
    }
}

fn window_label(window: &str) -> &str {
    match window {
        "month_credits" => "credits",
        other => other,
    }
}

pub fn left_pct(used_pct: f64) -> i64 {
    (100.0 - used_pct).floor() as i64
}

fn lisbon(ms: i64) -> Option<(String, String)> {
    let zoned = jiff::Timestamp::from_millisecond(ms).ok()?.in_tz("Europe/Lisbon").ok()?;
    Some((zoned.strftime("%Y-%m-%d").to_string(), zoned.strftime("%H:%M").to_string()))
}

/// HH:MM on the same Lisbon day as `now`, otherwise YYYY-MM-DD HH:MM.
pub fn lisbon_clock(ms: i64, now: i64) -> String {
    match (lisbon(ms), lisbon(now)) {
        (Some((date, time)), Some((today, _))) if date == today => time,
        (Some((date, time)), _) => format!("{date} {time}"),
        _ => "—".into(),
    }
}

pub fn format_quota_line(q: &QuotaLineInput<'_>, now: i64) -> String {
    let label = format!("{} · {}", provider_label(q.provider), window_label(q.window));
    let width = LABEL_WIDTH.max(label.chars().count() + 1);
    let head = format!("{label}{}", " ".repeat(width - label.chars().count()));
    let as_of = q.updated_at.map(|at| format!("as of {}", lisbon_clock(at, now)));

    match q.state {
        ReadingState::Reset => {
            let at = q.resets_at.map(|r| format!(" at {}", lisbon_clock(r, now))).unwrap_or_default();
            format!("{head}— · reset{at} · waiting for a new reading")
        }
        ReadingState::Dead => {
            let mut parts = vec![format!("{head}—"), q.reason.unwrap_or("no reading").to_string()];
            parts.extend(as_of);
            parts.join(" · ")
        }
        ReadingState::Fresh | ReadingState::Stale => {
            let resets = q.resets_at.map_or_else(|| "resets: not reported".to_string(), |r| format!("resets {}", lisbon_clock(r, now)));
            let mut parts = vec![format!("{head}{}% left", left_pct(q.used_pct)), resets];
            parts.extend(as_of);
            let line = parts.join(" · ");
            if q.state == ReadingState::Stale {
                format!("{line} (stale)")
            } else {
                line
            }
        }
    }
}

/// The menu bar title (R39): `58%` fresh, `58%?` stale, `—` dead, reset or no reading.
pub fn menu_title(reading: Option<(f64, ReadingState)>) -> String {
    match reading {
        Some((used, ReadingState::Fresh)) => format!("{}%", left_pct(used)),
        Some((used, ReadingState::Stale)) => format!("{}%?", left_pct(used)),
        _ => "—".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Input {
        provider: String,
        window: String,
        used_pct: f64,
        resets_at: Option<i64>,
        updated_at: Option<i64>,
        state: String,
        reason: Option<String>,
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        input: Input,
        expected: String,
    }

    #[derive(Deserialize)]
    struct Fixture {
        now: i64,
        cases: Vec<Case>,
    }

    fn state(s: &str) -> ReadingState {
        match s {
            "fresh" => ReadingState::Fresh,
            "stale" => ReadingState::Stale,
            "dead" => ReadingState::Dead,
            "reset" => ReadingState::Reset,
            other => panic!("unknown state {other}"),
        }
    }

    #[test]
    fn matches_the_shared_cases() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/quota-line-cases.json");
        let fixture: Fixture = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for c in &fixture.cases {
            let q = QuotaLineInput {
                provider: &c.input.provider,
                window: &c.input.window,
                used_pct: c.input.used_pct,
                resets_at: c.input.resets_at,
                updated_at: c.input.updated_at,
                state: state(&c.input.state),
                reason: c.input.reason.as_deref(),
            };
            assert_eq!(format_quota_line(&q, fixture.now), c.expected, "{}", c.name);
        }
    }

    #[test]
    fn menu_titles() {
        assert_eq!(menu_title(Some((42.0, ReadingState::Fresh))), "58%");
        assert_eq!(menu_title(Some((2.5, ReadingState::Stale))), "97%?");
        assert_eq!(menu_title(Some((42.0, ReadingState::Dead))), "—");
        assert_eq!(menu_title(Some((42.0, ReadingState::Reset))), "—");
        assert_eq!(menu_title(None), "—");
    }
}
