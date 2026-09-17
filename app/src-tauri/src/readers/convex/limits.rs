//! Convex plan limits, pinned by hand because the usage API carries none (prd-convex-usage.md R6).
//!
//! **Source: <https://www.convex.dev/pricing>, read 2026-09-17.** A plan change makes this file silently wrong —
//! the percentages keep rendering, just against the wrong denominator — which is why the URL and the date live
//! here rather than in a commit message nobody will find.
//!
//! Only five metrics have a published allowance. The other four are figures, not gauges (R8): a gauge needs a
//! denominator, and inventing one would be a lie with a progress bar on it.

/// The plan a deployment is on — `convex_plan` in `settings` (R3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    Starter,
    Professional,
}

impl Tier {
    pub fn id(self) -> &'static str {
        match self {
            Tier::Starter => "starter",
            Tier::Professional => "professional",
        }
    }

    /// Anything unrecognised, empty or missing falls back to **Starter**, deliberately.
    ///
    /// Starter has the smaller allowances, so a percentage computed against it reads *higher* than the truth.
    /// For a usage gauge, erring toward "you are closer to the limit than you think" is the safe direction; the
    /// opposite would quietly under-report an overage.
    ///
    /// Settings values are stored as JSON, so the string arrives quoted (`"starter"`). The caller decodes it, but
    /// the quotes are trimmed here too: a tier that silently became Starter because of a stray quote would be a
    /// wrong denominator with no error anywhere.
    pub fn parse(value: &str) -> Tier {
        match value.trim().trim_matches('"') {
            "professional" => Tier::Professional,
            _ => Tier::Starter,
        }
    }
}

/// The monthly allowance for a gauged metric, or `None` when the plan publishes none.
///
/// Keyed by the metric name as it is stored in `provider_metrics` — so `actionCompute`, the R7 sum, not the three
/// API keys it is made of. Those are stored for attribution but are not gauged individually, because the plan's
/// allowance covers them together.
pub fn monthly_limit(tier: Tier, metric: &str) -> Option<f64> {
    let (starter, professional) = match metric {
        "functionCalls" => (1_000_000.0, 25_000_000.0),
        "actionCompute" => (20.0, 250.0),
        "databaseIoGb" => (1.0, 50.0),
        "dataEgressGb" => (1.0, 50.0),
        "searchQueryGb" => (3_000.0, 50_000.0),
        _ => return None,
    };
    Some(match tier {
        Tier::Starter => starter,
        Tier::Professional => professional,
    })
}

/// `100 * used / limit`, unrounded and **unclamped** (R6).
///
/// Over 100 % is kept, not capped: overage is real and billed, and hiding it is the one thing a usage gauge
/// exists to prevent. Every surface floors the value for display, as `readings.rs` already documents.
/// `None` when the metric has no allowance — that is how R8's dollar figure stays a figure.
pub fn used_pct(tier: Tier, metric: &str, used: f64) -> Option<f64> {
    monthly_limit(tier, metric).filter(|limit| *limit > 0.0).map(|limit| 100.0 * used / limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_two_percentages_the_spec_pins() {
        // prd-convex-usage.md §5: function calls on Starter at 1M is 100.0, at 250 000 is 25.0.
        assert_eq!(used_pct(Tier::Starter, "functionCalls", 1_000_000.0), Some(100.0));
        assert_eq!(used_pct(Tier::Starter, "functionCalls", 250_000.0), Some(25.0));
    }

    #[test]
    fn professional_has_its_own_denominators() {
        assert_eq!(monthly_limit(Tier::Professional, "functionCalls"), Some(25_000_000.0));
        assert_eq!(monthly_limit(Tier::Professional, "actionCompute"), Some(250.0));
        assert_eq!(monthly_limit(Tier::Professional, "searchQueryGb"), Some(50_000.0));
        assert_eq!(used_pct(Tier::Professional, "functionCalls", 25_000_000.0), Some(100.0));
    }

    #[test]
    fn overage_is_kept_not_clamped() {
        // A gauge that stops at 100 % would hide a bill that does not.
        assert_eq!(used_pct(Tier::Starter, "databaseIoGb", 3.0), Some(300.0));
    }

    #[test]
    fn a_metric_without_an_allowance_has_no_percentage() {
        // R8: the AI gateway cost is a number. So are the individual compute keys, which are gauged only as
        // their R7 sum.
        for metric in ["aiGatewayCostDollars", "queryMutationComputeGbHours", "actionComputeConvexGbHours", "actionComputeNodeJsGbHours", "actionComputeCpuGbHours", "nonsense"] {
            assert_eq!(monthly_limit(Tier::Starter, metric), None, "{metric} should have no allowance");
            assert_eq!(used_pct(Tier::Starter, metric, 5.0), None, "{metric} should have no percentage");
        }
    }

    #[test]
    fn an_unknown_tier_reads_as_starter_so_percentages_never_understate() {
        for value in ["starter", "\"starter\"", "", "  ", "enterprise", "Professional", "nonsense"] {
            assert_eq!(Tier::parse(value), Tier::Starter, "{value:?} should fall back to Starter");
        }
        // JSON-quoted, as the settings table stores it.
        assert_eq!(Tier::parse("\"professional\""), Tier::Professional);
        assert_eq!(Tier::parse("professional"), Tier::Professional);
        assert_eq!(Tier::Starter.id(), "starter");
        assert_eq!(Tier::Professional.id(), "professional");
    }
}
