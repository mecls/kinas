//! Convex usage from `GET https://<deployment>.convex.cloud/api/v1/get_current_usage` (prd-convex-usage.md).
//!
//! Watch-only, and for once the credential agrees: a deploy key minted with only `deployment:usage:view` cannot
//! deploy, cannot read or write data, cannot run functions and cannot read environment variables. Hostinger and
//! Vercel will hold tokens that *can* write, so the GET-only habit starts here, where it is cheap (R1).
//!
//! Two things about this endpoint are easy to get wrong and both are pinned by tests below:
//!
//! 1. **The auth scheme is `Convex`, not `Bearer`.** Every other API in this app uses Bearer.
//! 2. **The plan's action-compute allowance covers three keys, not four.** `queryMutationComputeGbHours` is
//!    metered separately; folding it into the sum would understate usage against the limit (R7).
//!
//! The endpoint is documented as beta, so a payload change is expected rather than surprising. R12 is what makes
//! that survivable: every failure keeps the previous numbers and changes only `reader_status`.

pub mod limits;

use crate::redact::{write_reader_status, Outcome, Reader};
use self::limits::Tier;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::time::Duration;

pub const SOURCE: &str = "convex.cloud/api/v1/get_current_usage";
pub const PROVIDER: &str = "convex";
const TIMEOUT: Duration = Duration::from_secs(10);

/// The nine metric keys the response carries (R4), in the order the Usage page lists them.
pub const METRIC_KEYS: [&str; 9] = [
    "functionCalls",
    "databaseIoGb",
    "dataEgressGb",
    "searchQueryGb",
    "queryMutationComputeGbHours",
    "actionComputeConvexGbHours",
    "actionComputeNodeJsGbHours",
    "actionComputeCpuGbHours",
    "aiGatewayCostDollars",
];

/// The three keys the plan's single action-compute allowance covers (R7).
///
/// `queryMutationComputeGbHours` is deliberately **not** here. It is metered separately, and including it would
/// inflate the sum and so understate how much of the allowance is left — the failure mode that matters.
const ACTION_COMPUTE_KEYS: [&str; 3] = ["actionComputeConvexGbHours", "actionComputeNodeJsGbHours", "actionComputeCpuGbHours"];

/// The derived metric the allowance is gauged against.
pub const ACTION_COMPUTE: &str = "actionCompute";

/// Calendar-aligned **UTC** windows, which is not Europe/Lisbon — so `day` is "today (UTC)" and every surface
/// must say so rather than quietly implying it lines up with the chart's Lisbon days (R4).
pub const WINDOWS: [&str; 2] = ["day", "month"];

pub struct HttpResponse {
    pub status: u16,
    pub retry_after_s: Option<u64>,
    pub body: String,
}

/// The one request this module makes, behind a trait so tests never reach the network.
pub trait UsageClient: Send + Sync {
    fn get_usage(&self, deployment_url: &str, deploy_key: &str) -> Result<HttpResponse, String>;
}

pub struct ReqwestClient(reqwest::blocking::Client);

impl ReqwestClient {
    pub fn new() -> Result<Self, String> {
        reqwest::blocking::Client::builder().timeout(TIMEOUT).build().map(ReqwestClient).map_err(|e| e.to_string())
    }
}

impl UsageClient for ReqwestClient {
    fn get_usage(&self, deployment_url: &str, deploy_key: &str) -> Result<HttpResponse, String> {
        let response = self
            .0
            .get(format!("{}/api/v1/get_current_usage", deployment_url.trim_end_matches('/')))
            // `Convex`, not `Bearer` (R1). Set by hand because reqwest's `bearer_auth` would write the wrong
            // scheme and the endpoint would answer 401 with nothing to explain it.
            .header(reqwest::header::AUTHORIZATION, format!("Convex {deploy_key}"))
            .send()
            // The error can carry the URL but never the Authorization header.
            .map_err(|e| if e.is_timeout() { "timed out after 10 s".to_string() } else { format!("request failed: {e}") })?;
        let status = response.status().as_u16();
        let retry_after_s = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse().ok());
        let body = response.text().unwrap_or_default();
        Ok(HttpResponse { status, retry_after_s, body })
    }
}

/// The deployment URL from Settings, or `KINAS_CONVEX_BASE_URL` in debug builds.
///
/// The override is the seam the e2e's stub server uses; `e2e/run.ts` points it at an unreachable address by
/// default so no spec can accidentally reach a real deployment.
pub fn base_url(configured: &str) -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("KINAS_CONVEX_BASE_URL") {
        if !url.is_empty() {
            return url;
        }
    }
    configured.trim().trim_matches('"').to_string()
}

/// R3: a deployment URL is `https://` and a host, and nothing else.
///
/// The path matters more than it looks: the reader appends `/api/v1/get_current_usage`, so a URL carrying a path
/// would request `…/foo/api/v1/get_current_usage` and 404 forever, with nothing on screen to say why. An empty
/// value is accepted and means "no deployment" — that is how Miguel disconnects one (R3's zero requests).
pub fn check_deployment_url(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    if value.is_empty() {
        return Ok(String::new());
    }
    let Some(host) = value.strip_prefix("https://") else {
        return Err("the deployment URL must start with https://".into());
    };
    if host.is_empty() || host.contains('/') || host.contains('?') || host.contains('#') || host.contains(char::is_whitespace) {
        return Err("the deployment URL must be https:// and a host, with no path".into());
    }
    Ok(value.to_string())
}

/// R3: the tier is one of two strings. `Tier::parse` is deliberately lenient for *reading* a stored value, but a
/// setter refuses junk rather than storing something that would silently be read back as Starter.
///
/// It validates into the `Tier` and serialises back out of it, rather than matching on string literals of its
/// own: that way the accepted spellings and the stored spellings are the same list, and cannot drift apart.
pub fn check_plan(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let tier = match trimmed {
        "starter" => Tier::Starter,
        "professional" => Tier::Professional,
        other => return Err(format!("unknown Convex plan {other}")),
    };
    Ok(tier.id().to_string())
}

#[derive(Debug, Clone, PartialEq)]
pub struct Metric {
    pub metric: String,
    pub unit: Option<String>,
    pub day: f64,
    pub month: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Usage {
    /// The raw value, kept so the note can say which of `pending`/`partial`/`failed` it was.
    pub seed_status: String,
    pub metrics: Vec<Metric>,
}

impl Usage {
    /// R5: only a `complete` seed may be shown. Under the others the totals **understate** actual usage, and a
    /// gauge that falls because the backend is still seeding reads as good news, which is worse than no gauge.
    pub fn seed_complete(&self) -> bool {
        self.seed_status == "complete"
    }
}

/// Parses the documented shape: `{ metrics: { <key>: { unit, usage: { current_day, current_month } } }, seedStatus }`.
///
/// An unrecognised metric key is ignored rather than failing the reading (R4) — the endpoint is beta and a new
/// dimension must not blank the page. A key we know but whose numbers are missing is skipped the same way, as
/// `ollama_cloud`'s malformed model entries are. Only a response with *no* usable metric is an error, and it
/// names the keys it saw without ever quoting a value.
pub fn parse_usage(body: &str) -> Result<Usage, String> {
    let j: Value = serde_json::from_str(body).map_err(|_| "unrecognized response shape: not JSON".to_string())?;
    let seed_status = j["seedStatus"].as_str().unwrap_or_default().to_string();
    let names = |value: &Value| value.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>().join(", ")).unwrap_or_default();

    let mut metrics = Vec::new();
    for key in METRIC_KEYS {
        let entry = &j["metrics"][key];
        let (Some(day), Some(month)) = (entry["usage"]["current_day"].as_f64(), entry["usage"]["current_month"].as_f64()) else {
            continue;
        };
        metrics.push(Metric { metric: key.to_string(), unit: entry["unit"].as_str().map(str::to_string), day, month });
    }
    if metrics.is_empty() {
        let seen = if j["metrics"].is_object() { names(&j["metrics"]) } else { names(&j) };
        return Err(format!("unrecognized response shape: {seen}"));
    }

    // R7's sum, appended as its own metric. The parts stay in the list so a spike can be attributed.
    let parts: Vec<&Metric> = metrics.iter().filter(|m| ACTION_COMPUTE_KEYS.contains(&m.metric.as_str())).collect();
    if !parts.is_empty() {
        let unit = parts.iter().find_map(|m| m.unit.clone());
        let (day, month) = parts.iter().fold((0.0, 0.0), |(d, m), part| (d + part.day, m + part.month));
        metrics.push(Metric { metric: ACTION_COMPUTE.to_string(), unit, day, month });
    }
    Ok(Usage { seed_status, metrics })
}

#[derive(Debug, PartialEq)]
pub enum PollResult {
    NotConfigured,
    Applied(usize),
    /// A 200 whose `seedStatus` was not `complete`: nothing was written, so the last complete reading stands
    /// and ages into `Stale` on its own (R5).
    Seeding(String),
    RateLimited {
        retry_after_s: Option<u64>,
    },
    Failed(String),
}

/// The request itself, kept apart from `record_poll` so the runtime makes it without holding the store's lock.
pub fn fetch(client: &dyn UsageClient, deployment_url: &str, deploy_key: &str) -> Result<HttpResponse, String> {
    client.get_usage(deployment_url, deploy_key)
}

/// One poll: `fetch`, then `record_poll`. No key or no deployment URL means no request at all (R3).
#[cfg(test)]
pub fn poll(conn: &mut Connection, org_id: &str, deploy_key: Option<&str>, url: &str, tier: Tier, client: &dyn UsageClient, now: i64) -> PollResult {
    let configured = !url.trim().is_empty();
    let fetched = deploy_key.filter(|k| !k.is_empty()).filter(|_| configured).map(|k| fetch(client, url, k));
    record_poll(conn, org_id, fetched, configured, tier, now)
}

/// Records what a poll found. `None` means no request was made; `configured` distinguishes "no deploy key" from
/// "no deployment URL" so the message tells Miguel which one to fix. Values change only on a 200 that parses
/// and whose seed is complete; every outcome is recorded (R12).
pub fn record_poll(conn: &mut Connection, org_id: &str, fetched: Option<Result<HttpResponse, String>>, configured: bool, tier: Tier, now: i64) -> PollResult {
    let record = |conn: &Connection, outcome: Outcome<'_>| {
        if let Err(e) = write_reader_status(conn, org_id, Reader::Convex, outcome, now) {
            log::error!("convex: could not record status: {e}");
        }
    };
    let Some(fetched) = fetched else {
        let message = if configured { "no deploy key — add one in Settings" } else { "no deployment — add one in Settings" };
        record(conn, Outcome::NotConfigured(message));
        return PollResult::NotConfigured;
    };
    let response = match fetched {
        Ok(r) => r,
        Err(message) => {
            record(conn, Outcome::Error(&message));
            return PollResult::Failed(message);
        }
    };
    match response.status {
        200 => match parse_usage(&response.body) {
            Ok(usage) if !usage.seed_complete() => {
                // Nothing is written: the previous row keeps its older `updated_at` and so reads Stale, which is
                // the honest rendering of "these totals are still being assembled" (R5).
                let note = format!("still seeding ({}) — showing the last complete reading", if usage.seed_status.is_empty() { "unknown" } else { &usage.seed_status });
                record(conn, Outcome::Partial(&note));
                PollResult::Seeding(note)
            }
            Ok(usage) => match upsert(conn, org_id, tier, &usage, now) {
                Ok(n) => {
                    record(conn, Outcome::Success);
                    PollResult::Applied(n)
                }
                Err(message) => {
                    record(conn, Outcome::Error(&message));
                    PollResult::Failed(message)
                }
            },
            Err(message) => {
                record(conn, Outcome::Error(&message));
                PollResult::Failed(message)
            }
        },
        401 => {
            // The stored key is not deleted: Miguel decides that in Settings (R2).
            record(conn, Outcome::Error("deploy key rejected"));
            PollResult::Failed("deploy key rejected".into())
        }
        429 => {
            record(conn, Outcome::Error("rate limited (HTTP 429)"));
            PollResult::RateLimited { retry_after_s: response.retry_after_s }
        }
        status => {
            let message = format!("HTTP {status}");
            record(conn, Outcome::Error(&message));
            PollResult::Failed(message)
        }
    }
}

/// One row per metric per window, in a single transaction.
///
/// Only the **month** window carries a limit and a percentage: the published allowances are monthly (R6), so a
/// day figure has no honest denominator and keeps NULLs rather than being measured against a monthly number.
/// `detail` stays NULL for Convex — attribution comes from the raw metric rows themselves.
fn upsert(conn: &mut Connection, org_id: &str, tier: Tier, usage: &Usage, now: i64) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut written = 0;
    for metric in &usage.metrics {
        for window in WINDOWS {
            let (used, limit, pct) = match window {
                "month" => (metric.month, limits::monthly_limit(tier, &metric.metric), limits::used_pct(tier, &metric.metric, metric.month)),
                _ => (metric.day, None, None),
            };
            tx.execute(
                "INSERT INTO provider_metrics (org_id, provider, metric, \"window\", used, limit_value, unit, used_pct, detail, source, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)
                 ON CONFLICT (org_id, provider, metric, \"window\") DO UPDATE SET
                   used = excluded.used, limit_value = excluded.limit_value, unit = excluded.unit,
                   used_pct = excluded.used_pct, source = excluded.source, updated_at = excluded.updated_at",
                params![org_id, PROVIDER, metric.metric, window, used, limit, metric.unit, pct, SOURCE, now],
            )
            .map_err(|e| e.to_string())?;
            written += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const KEY: &str = "convex-FAKE-deploy-key";
    const URL: &str = "https://example-deployment.convex.cloud";

    struct Stub {
        status: u16,
        body: String,
        retry_after_s: Option<u64>,
        calls: AtomicUsize,
    }

    impl Stub {
        fn new(status: u16, body: &str) -> Self {
            Stub { status, body: body.into(), retry_after_s: None, calls: AtomicUsize::new(0) }
        }
    }

    impl UsageClient for Stub {
        fn get_usage(&self, url: &str, key: &str) -> Result<HttpResponse, String> {
            assert_eq!(key, KEY, "the reader must send the configured deploy key");
            assert_eq!(url, URL);
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(HttpResponse { status: self.status, retry_after_s: self.retry_after_s, body: self.body.clone() })
        }
    }

    fn fixture() -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/convex-usage.synthetic.json")).unwrap()
    }

    fn rows(store: &Store, window: &str) -> Vec<(String, f64, Option<f64>, Option<f64>)> {
        let conn = store.conn();
        let mut stmt = conn
            .prepare("SELECT metric, used, limit_value, used_pct FROM provider_metrics WHERE provider = 'convex' AND \"window\" = ?1 ORDER BY metric")
            .unwrap();
        stmt.query_map(params![window], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn one(store: &Store, metric: &str, window: &str) -> (f64, Option<f64>, Option<f64>, Option<String>) {
        store
            .conn()
            .query_row(
                "SELECT used, limit_value, used_pct, unit FROM provider_metrics WHERE provider = 'convex' AND metric = ?1 AND \"window\" = ?2",
                params![metric, window],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap()
    }

    fn reader_row(store: &Store) -> (String, Option<String>) {
        store.conn().query_row("SELECT state, last_error FROM reader_status WHERE reader = 'convex'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
    }

    #[test]
    fn the_action_compute_sum_is_three_keys_not_four() {
        // The fixture's three action keys are 1, 2 and 3 GB-hours with queryMutationComputeGbHours at 10.
        // 6, not 16: folding the query/mutation figure in would understate the allowance's headroom (R7).
        let usage = parse_usage(&fixture()).unwrap();
        let sum = usage.metrics.iter().find(|m| m.metric == ACTION_COMPUTE).expect("actionCompute is derived");
        assert_eq!(sum.month, 6.0);
        assert_eq!(sum.day, 3.0);
        assert_eq!(sum.unit.as_deref(), Some("GB-hours"));
    }

    #[test]
    fn a_200_stores_every_metric_for_both_windows() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let stub = Stub::new(200, &fixture());
        // Ten rows per window: R4's nine API keys, plus R7's derived sum. §5's "nine metrics" counts the keys
        // the API reports; `actionCompute` is additional and required by R7.
        assert_eq!(poll(&mut store.conn(), store.org_id(), Some(KEY), URL, Tier::Starter, &stub, 1_000), PollResult::Applied(20));
        assert_eq!(rows(&store, "month").len(), 10);
        assert_eq!(rows(&store, "day").len(), 10);
        assert_eq!(reader_row(&store), ("ok".into(), None));

        // §5's pinned percentage: 250 000 of Starter's 1M.
        assert_eq!(one(&store, "functionCalls", "month"), (250_000.0, Some(1_000_000.0), Some(25.0), Some("calls".into())));
        // A day figure has no monthly denominator, so it keeps NULLs rather than a misleading percentage.
        assert_eq!(one(&store, "functionCalls", "day"), (12_000.0, None, None, Some("calls".into())));
        // R8: a cost has no allowance anywhere, so it is a number in both windows.
        assert_eq!(one(&store, "aiGatewayCostDollars", "month"), (4.2, None, None, Some("USD".into())));
    }

    #[test]
    fn the_units_the_first_response_reported_are_pinned() {
        // PRD §7 Q3: a unit that silently differs from the pricing page's would skew a percentage. Pinning them
        // means a change in the beta payload fails here rather than quietly.
        let usage = parse_usage(&fixture()).unwrap();
        let unit = |name: &str| usage.metrics.iter().find(|m| m.metric == name).and_then(|m| m.unit.clone());
        assert_eq!(unit("functionCalls").as_deref(), Some("calls"));
        assert_eq!(unit("databaseIoGb").as_deref(), Some("GB"));
        assert_eq!(unit("dataEgressGb").as_deref(), Some("GB"));
        assert_eq!(unit("searchQueryGb").as_deref(), Some("query-GB"));
        assert_eq!(unit("aiGatewayCostDollars").as_deref(), Some("USD"));
    }

    #[test]
    fn a_partial_seed_keeps_the_previous_values_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        poll(&mut store.conn(), store.org_id(), Some(KEY), URL, Tier::Starter, &Stub::new(200, &fixture()), 1_000);
        let before = rows(&store, "month");

        let seeding = fixture().replace("\"complete\"", "\"partial\"");
        let result = poll(&mut store.conn(), store.org_id(), Some(KEY), URL, Tier::Starter, &Stub::new(200, &seeding), 2_000);
        assert!(matches!(result, PollResult::Seeding(_)), "a partial seed must not count as applied");
        // The numbers stand, and their `updated_at` stays at 1 000 — so the reading ages into Stale on its own
        // rather than dropping to a smaller, cheerful-looking figure.
        assert_eq!(rows(&store, "month"), before);
        let updated: i64 = store
            .conn()
            .query_row("SELECT updated_at FROM provider_metrics WHERE provider='convex' AND metric='functionCalls' AND \"window\"='month'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(updated, 1_000);
        let (state, note) = reader_row(&store);
        assert_eq!(state, "ok");
        assert!(note.unwrap().contains("still seeding (partial)"));
    }

    #[test]
    fn no_key_and_no_deployment_each_make_no_request_and_say_which_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let stub = Stub::new(200, &fixture());

        assert_eq!(poll(&mut store.conn(), store.org_id(), None, URL, Tier::Starter, &stub, 1), PollResult::NotConfigured);
        assert_eq!(reader_row(&store).1.unwrap(), "no deploy key — add one in Settings");

        assert_eq!(poll(&mut store.conn(), store.org_id(), Some(KEY), "   ", Tier::Starter, &stub, 2), PollResult::NotConfigured);
        assert_eq!(reader_row(&store).1.unwrap(), "no deployment — add one in Settings");

        assert_eq!(stub.calls.load(Ordering::SeqCst), 0, "an unconfigured reader must make no request at all");
    }

    #[test]
    fn failures_keep_the_previous_values() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        poll(&mut store.conn(), store.org_id(), Some(KEY), URL, Tier::Starter, &Stub::new(200, &fixture()), 1_000);
        let before = rows(&store, "month");

        assert_eq!(
            poll(&mut store.conn(), store.org_id(), Some(KEY), URL, Tier::Starter, &Stub::new(401, ""), 2_000),
            PollResult::Failed("deploy key rejected".into())
        );
        assert_eq!(reader_row(&store), ("error".into(), Some("deploy key rejected".into())));

        let mut limited = Stub::new(429, "");
        limited.retry_after_s = Some(120);
        assert_eq!(
            poll(&mut store.conn(), store.org_id(), Some(KEY), URL, Tier::Starter, &limited, 3_000),
            PollResult::RateLimited { retry_after_s: Some(120) }
        );

        assert_eq!(poll(&mut store.conn(), store.org_id(), Some(KEY), URL, Tier::Starter, &Stub::new(500, "boom"), 4_000), PollResult::Failed("HTTP 500".into()));
        assert!(matches!(poll(&mut store.conn(), store.org_id(), Some(KEY), URL, Tier::Starter, &Stub::new(200, "{\"nope\":1}"), 5_000), PollResult::Failed(_)));

        assert_eq!(rows(&store, "month"), before);
    }

    #[test]
    fn unknown_shapes_name_their_keys_and_never_their_values() {
        assert_eq!(parse_usage("not json").unwrap_err(), "unrecognized response shape: not JSON");
        // serde_json keeps object keys sorted.
        assert_eq!(parse_usage(r#"{"plan":"pro","teamId":"t_123"}"#).unwrap_err(), "unrecognized response shape: plan, teamId");
        let err = parse_usage(r#"{"metrics":{"newDimensionGb":{"unit":"GB","usage":{"current_day":1,"current_month":2}}}}"#).unwrap_err();
        assert_eq!(err, "unrecognized response shape: newDimensionGb");
        assert!(!err.contains('2'), "an error may name a key but never quote a value");
    }

    #[test]
    fn a_new_dimension_alongside_known_ones_is_ignored_rather_than_fatal() {
        // The endpoint is beta (R15). A tenth metric must not blank the page.
        let body = fixture().replace("\"metrics\": {", "\"metrics\": {\n    \"newDimensionGb\": { \"unit\": \"GB\", \"usage\": { \"current_day\": 1, \"current_month\": 2 } },");
        let usage = parse_usage(&body).unwrap();
        assert!(usage.metrics.iter().all(|m| m.metric != "newDimensionGb"));
        assert_eq!(usage.metrics.len(), 10);
    }

    #[test]
    fn a_known_key_with_missing_numbers_is_skipped_not_fatal() {
        let body = fixture().replace(r#""unit": "USD",
      "usage": { "current_day": 0.3, "current_month": 4.2 }"#, r#""unit": "USD""#);
        let usage = parse_usage(&body).unwrap();
        assert!(usage.metrics.iter().all(|m| m.metric != "aiGatewayCostDollars"));
        assert_eq!(usage.metrics.len(), 9);
    }

    #[test]
    fn a_deployment_url_is_https_and_a_host_and_nothing_else() {
        assert_eq!(check_deployment_url("https://happy-otter-123.convex.cloud").unwrap(), "https://happy-otter-123.convex.cloud");
        // A trailing slash is tidied rather than refused; the reader trims one anyway.
        assert_eq!(check_deployment_url("  https://happy-otter-123.convex.cloud/  ").unwrap(), "https://happy-otter-123.convex.cloud");
        // Empty means "no deployment", which is a valid state, not an error.
        assert_eq!(check_deployment_url("   ").unwrap(), "");

        assert!(check_deployment_url("http://happy-otter-123.convex.cloud").is_err(), "plain http must be refused");
        assert!(check_deployment_url("happy-otter-123.convex.cloud").is_err(), "a bare host has no scheme");
        // The one that would otherwise 404 forever: the reader appends its own path.
        assert!(check_deployment_url("https://happy-otter-123.convex.cloud/api/v1").is_err());
        assert!(check_deployment_url("https://x.convex.cloud?token=abc").is_err());
        assert!(check_deployment_url("https://x.convex.cloud#frag").is_err());
        assert!(check_deployment_url("https://").is_err());
    }

    #[test]
    fn a_plan_setter_refuses_what_the_reader_would_silently_read_as_starter() {
        assert_eq!(check_plan("starter").unwrap(), "starter");
        assert_eq!(check_plan(" professional ").unwrap(), "professional");
        for bad in ["", "enterprise", "Starter", "pro"] {
            assert!(check_plan(bad).is_err(), "{bad:?} should be refused");
            // The asymmetry is deliberate: reading is lenient so a bad stored value still gauges (high, not low).
            assert_eq!(Tier::parse(bad), Tier::Starter);
        }
    }

    #[test]
    fn this_module_makes_no_request_other_than_a_get() {
        // R1's guard. The needles are assembled from parts on purpose: written literally, each would appear in
        // this file and match itself, and the test could never fail.
        let source = include_str!("mod.rs");
        for verb in ["post", "put", "patch", "delete", "head"] {
            let needle = format!(".{verb}(");
            assert!(!source.contains(&needle), "{needle} has no business in a watch-only reader");
        }
        assert!(source.contains(&format!(".{}(", "get")), "the guard is worthless if it cannot see the one call there is");
    }
}
