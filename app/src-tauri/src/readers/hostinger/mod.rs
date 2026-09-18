//! Hostinger VPS usage from `GET /api/vps/v1/virtual-machines` and `.../{id}/metrics`
//! (prd-hostinger-usage.md).
//!
//! Watch-only — and unlike Convex, the credential does not agree. Hostinger's own docs say "tokens will have
//! same permissions as the owning user", and the endpoints that would recreate this machine, reset its root
//! password or buy another VPS sit in the *same URL namespace* as the two we read, differing only by verb and
//! suffix. So watch-only is a property of this file, held by the two guard tests at the foot of it (R1).
//!
//! Three things here are easy to get wrong, and each is pinned by a test:
//!
//! 1. **Usage is in bytes; allowances are in MiB.** `ram_usage` is bytes while `memory` is 8192 for an 8 GB box,
//!    so a naive ratio is out by 1 048 576×. Worse, reading the documented "megabytes" as 10⁶ instead of 2²⁰
//!    gives 6.7649 % where the truth is 6.4515 % — plausible, and therefore invisible. The conversion lives in
//!    `pct_of_mib` alone and the tests assert the exact figure (R7).
//! 2. **`date_from` and `date_to` are required.** There is no "current period" default, so a 422 from the
//!    metrics endpoint means *we* built the window wrong, not that the user did something wrong (R5).
//! 3. **Every metric is nullable.** A missing metric is omitted, never stored as zero — a zero renders as
//!    "0 % used", which reads as good news (R6).
//!
//! Bandwidth is deliberately **not** gauged yet: whether each traffic sample is an interval delta or a
//! cumulative counter is unanswered (PRD §7 Q1), and getting it backwards is wrong by orders of magnitude. Until
//! a probe settles it the month figure is stored with a NULL limit, which `provider_metrics` already renders as
//! a number rather than a bar.

use crate::redact::{write_reader_status, Outcome, Reader};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::time::Duration;

pub const SOURCE: &str = "developers.hostinger.com/api/vps/v1/virtual-machines";
pub const PROVIDER: &str = "hostinger";
pub const DEFAULT_BASE_URL: &str = "https://developers.hostinger.com";
const TIMEOUT: Duration = Duration::from_secs(10);

/// Bytes in a MiB. The list endpoint's "megabytes" are 1024-based: `memory` is 8192 for a box the panel calls
/// 8 GB, and `disk` is 51200 for 50 GB. Written once, used everywhere (R7).
pub const MIB: f64 = 1024.0 * 1024.0;

/// Instantaneous machine state (R11); the tile's window.
pub const WINDOW_NOW: &str = "now";
/// The month-to-date traffic total; the only thing that could ever be a gauge here.
pub const WINDOW_MONTH: &str = "month";

pub const METRIC_CPU: &str = "cpu";
pub const METRIC_RAM: &str = "ram";
pub const METRIC_DISK: &str = "disk";
pub const METRIC_UPTIME: &str = "uptime";
pub const METRIC_BANDWIDTH: &str = "bandwidth";

/// A percentage this far outside the plausible range is a unit disagreement, not a reading (R9).
///
/// Generous on purpose: real overage above 100 % must survive, because hiding overage is the one thing a usage
/// gauge exists to prevent. A 1 048 576× unit error cannot survive.
pub const PCT_MAX: f64 = 1000.0;

pub struct HttpResponse {
    pub status: u16,
    pub retry_after_s: Option<u64>,
    pub body: String,
}

/// The two requests this module makes, behind a trait so tests never reach the network.
///
/// There is no third. `GET /api/vps/v1/virtual-machines/{id}` returns a schema identical to one element of the
/// list, verified field by field against the OpenAPI spec, so calling it would re-fetch bytes we already hold.
pub trait MetricsClient: Send + Sync {
    fn list_vms(&self, base_url: &str, token: &str) -> Result<HttpResponse, String>;
    fn metrics(&self, base_url: &str, token: &str, vm_id: i64, date_from: &str, date_to: &str) -> Result<HttpResponse, String>;
}

pub struct ReqwestClient(reqwest::blocking::Client);

impl ReqwestClient {
    pub fn new() -> Result<Self, String> {
        reqwest::blocking::Client::builder().timeout(TIMEOUT).build().map(ReqwestClient).map_err(|e| e.to_string())
    }

    fn send(&self, url: String, token: &str) -> Result<HttpResponse, String> {
        let response = self
            .0
            .get(url)
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
            .send()
            // The error may carry the URL but never the Authorization header.
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

impl MetricsClient for ReqwestClient {
    fn list_vms(&self, base_url: &str, token: &str) -> Result<HttpResponse, String> {
        self.send(format!("{}/api/vps/v1/virtual-machines", base_url.trim_end_matches('/')), token)
    }

    fn metrics(&self, base_url: &str, token: &str, vm_id: i64, date_from: &str, date_to: &str) -> Result<HttpResponse, String> {
        self.send(
            format!(
                "{}/api/vps/v1/virtual-machines/{vm_id}/metrics?date_from={date_from}&date_to={date_to}",
                base_url.trim_end_matches('/')
            ),
            token,
        )
    }
}

/// The API's base URL, or `KINAS_HOSTINGER_BASE_URL` in debug builds.
///
/// The override decides **where** a request goes and never **whether** one happens — `configured` is judged on
/// the stored VPS id alone (R4). The Convex reader shipped the other way round once, and any build with the
/// override set then polled with nothing configured, quietly breaking its zero-request guarantee.
pub fn base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("KINAS_HOSTINGER_BASE_URL") {
        if !url.is_empty() {
            return url;
        }
    }
    DEFAULT_BASE_URL.to_string()
}

/// One virtual machine as the list reports it; the denominators live here rather than in a pinned table (R8).
#[derive(Debug, Clone, PartialEq)]
pub struct Vm {
    pub id: i64,
    pub hostname: String,
    pub plan: String,
    pub state: String,
    pub cpus: i64,
    pub memory_mib: f64,
    pub disk_mib: f64,
    pub bandwidth_mib: f64,
}

impl Vm {
    /// What the tile labels itself with, kept in `detail` so no surface needs a second lookup.
    pub fn detail(&self) -> String {
        format!("{} · {} · {}", self.hostname, self.plan, self.state)
    }
}

/// Parses the list response. An entry missing `id` is skipped; an unknown `state` is kept as a string rather
/// than rejected, since the documented enum already has 16 values and may gain more.
pub fn parse_vms(body: &str) -> Result<Vec<Vm>, String> {
    let j: Value = serde_json::from_str(body).map_err(|_| "unrecognized response shape: not JSON".to_string())?;
    let Some(entries) = j.as_array() else {
        return Err("unrecognized response shape: expected an array of virtual machines".to_string());
    };
    let vms: Vec<Vm> = entries
        .iter()
        .filter_map(|e| {
            Some(Vm {
                id: e["id"].as_i64()?,
                hostname: e["hostname"].as_str().unwrap_or_default().to_string(),
                plan: e["plan"].as_str().unwrap_or_default().to_string(),
                state: e["state"].as_str().unwrap_or_default().to_string(),
                cpus: e["cpus"].as_i64().unwrap_or_default(),
                memory_mib: e["memory"].as_f64().unwrap_or_default(),
                disk_mib: e["disk"].as_f64().unwrap_or_default(),
                bandwidth_mib: e["bandwidth"].as_f64().unwrap_or_default(),
            })
        })
        .collect();
    if vms.is_empty() {
        return Err("unrecognized response shape: no virtual machine carried an id".to_string());
    }
    Ok(vms)
}

/// One metric's series, reduced to the two things any surface needs.
#[derive(Debug, Clone, PartialEq)]
pub struct Series {
    pub unit: Option<String>,
    /// The newest sample, by numeric timestamp — not by map order, which JSON does not guarantee.
    pub latest: f64,
    /// Every sample added together, for the traffic totals.
    pub sum: f64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Metrics {
    pub cpu: Option<Series>,
    pub ram: Option<Series>,
    pub disk: Option<Series>,
    pub outgoing: Option<Series>,
    pub incoming: Option<Series>,
    pub uptime: Option<Series>,
}

/// Reads one `{ unit, usage: { "<epoch-seconds>": number } }` object.
///
/// `null` and a missing key both give `None`, which callers must omit rather than store as zero (R6). Keys are
/// compared numerically: they are strings in JSON, so "9" would sort after "10" lexically.
fn series(node: &Value) -> Option<Series> {
    let usage = node["usage"].as_object()?;
    let mut newest: Option<(i64, f64)> = None;
    let mut sum = 0.0;
    let mut any = false;
    for (key, value) in usage {
        let Some(v) = value.as_f64() else { continue };
        any = true;
        sum += v;
        let stamp = key.parse::<i64>().unwrap_or(i64::MIN);
        if newest.is_none_or(|(s, _)| stamp >= s) {
            newest = Some((stamp, v));
        }
    }
    if !any {
        return None;
    }
    Some(Series { unit: node["unit"].as_str().map(str::to_string), latest: newest.map(|(_, v)| v).unwrap_or_default(), sum })
}

/// Parses the metrics response. A response where every metric is null is an error naming the keys it saw, never
/// a row of zeroes.
pub fn parse_metrics(body: &str) -> Result<Metrics, String> {
    let j: Value = serde_json::from_str(body).map_err(|_| "unrecognized response shape: not JSON".to_string())?;
    let m = Metrics {
        cpu: series(&j["cpu_usage"]),
        ram: series(&j["ram_usage"]),
        disk: series(&j["disk_space"]),
        outgoing: series(&j["outgoing_traffic"]),
        incoming: series(&j["incoming_traffic"]),
        uptime: series(&j["uptime"]),
    };
    if m == Metrics::default() {
        let seen = j.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>().join(", ")).unwrap_or_default();
        return Err(format!("unrecognized response shape: {seen}"));
    }
    Ok(m)
}

/// A percentage of an allowance given in MiB, from a usage figure given in bytes (R7).
///
/// This is the only place the two units meet. Everything else passes bytes around.
pub fn pct_of_mib(used_bytes: f64, allowance_mib: f64) -> Option<f64> {
    if allowance_mib <= 0.0 {
        return None;
    }
    Some(100.0 * used_bytes / (allowance_mib * MIB))
}

/// R9: a percentage outside the plausible band is not a reading, so the metric loses its denominator and renders
/// as a figure instead of a bar.
pub fn trusted_pct(pct: Option<f64>) -> Option<f64> {
    pct.filter(|p| p.is_finite() && *p >= 0.0 && *p <= PCT_MAX)
}

/// R5's window: the start of the current UTC calendar month, and now, both RFC 3339.
///
/// UTC and not Europe/Lisbon, because the allowance is not a Lisbon month and pretending otherwise would shift
/// the boundary by an hour twice a year.
pub fn month_window(now_ms: i64) -> Result<(String, String), String> {
    let zoned = jiff::Timestamp::from_millisecond(now_ms)
        .map_err(|e| e.to_string())?
        .in_tz("UTC")
        .map_err(|e| e.to_string())?;
    let date = zoned.date();
    Ok((
        format!("{:04}-{:02}-01T00:00:00Z", date.year(), date.month()),
        zoned.strftime("%Y-%m-%dT%H:%M:%SZ").to_string(),
    ))
}

#[derive(Debug, PartialEq)]
pub enum PollResult {
    NotConfigured,
    Applied(usize),
    RateLimited { retry_after_s: Option<u64> },
    Failed(String),
}

/// Both responses of one poll. `metrics` is `None` when the list failed, so a bad token costs one request, not two.
pub struct Fetched {
    pub vms: HttpResponse,
    pub metrics: Option<HttpResponse>,
}

/// The requests themselves, kept apart from `record_poll` so the runtime makes them without holding the store's lock.
pub fn fetch(client: &dyn MetricsClient, base_url: &str, token: &str, vm_id: i64, now: i64) -> Result<Fetched, String> {
    let vms = client.list_vms(base_url, token)?;
    if vms.status != 200 {
        return Ok(Fetched { vms, metrics: None });
    }
    let (from, to) = month_window(now)?;
    let metrics = client.metrics(base_url, token, vm_id, &from, &to)?;
    Ok(Fetched { vms, metrics: Some(metrics) })
}

/// One poll: `fetch`, then `record_poll`. No token or no selected VPS means no request at all (R4).
#[cfg(test)]
pub fn poll(conn: &mut Connection, org_id: &str, token: Option<&str>, vm_id: Option<i64>, client: &dyn MetricsClient, now: i64) -> PollResult {
    let fetched = token.filter(|t| !t.is_empty()).zip(vm_id).map(|(t, id)| fetch(client, "https://stub.invalid", t, id, now));
    record_poll(conn, org_id, fetched, vm_id, vm_id.is_some(), now)
}

/// Records what a poll found. `None` means no request was made; `configured` distinguishes "no token" from
/// "no VPS selected" so the message says which to fix. Values change only on two 200s that parse (R14).
pub fn record_poll(
    conn: &mut Connection,
    org_id: &str,
    fetched: Option<Result<Fetched, String>>,
    vm_id: Option<i64>,
    configured: bool,
    now: i64,
) -> PollResult {
    let record = |conn: &Connection, outcome: Outcome<'_>| {
        if let Err(e) = write_reader_status(conn, org_id, Reader::Hostinger, outcome, now) {
            log::error!("hostinger: could not record status: {e}");
        }
    };
    let Some(fetched) = fetched else {
        let message = if configured { "no API token — add one in Settings" } else { "no VPS selected — choose one in Settings" };
        record(conn, Outcome::NotConfigured(message));
        return PollResult::NotConfigured;
    };
    let fetched = match fetched {
        Ok(f) => f,
        Err(message) => {
            record(conn, Outcome::Error(&message));
            return PollResult::Failed(message);
        }
    };

    // The list's status governs first: a rejected token or a rate limit stops the poll before the second call.
    if let Some(result) = status_problem(fetched.vms.status, fetched.vms.retry_after_s) {
        return finish(conn, record, result);
    }
    let Some(metrics_response) = fetched.metrics else {
        let message = "no metrics response".to_string();
        record(conn, Outcome::Error(&message));
        return PollResult::Failed(message);
    };
    if let Some(result) = status_problem(metrics_response.status, metrics_response.retry_after_s) {
        return finish(conn, record, result);
    }

    let vms = match parse_vms(&fetched.vms.body) {
        Ok(v) => v,
        Err(message) => {
            record(conn, Outcome::Error(&message));
            return PollResult::Failed(message);
        }
    };
    let metrics = match parse_metrics(&metrics_response.body) {
        Ok(m) => m,
        Err(message) => {
            record(conn, Outcome::Error(&message));
            return PollResult::Failed(message);
        }
    };
    // The **selected** machine, not the first one listed. Taking `vms.first()` would work on a one-VPS account
    // and silently show the wrong box's denominators on any other — and the fixture's own second machine has a
    // different disk size, so that mistake reads as a plausible number rather than an obvious one.
    // It may also have been destroyed or removed from the account since it was chosen.
    let Some(vm) = vm_id.and_then(|id| vms.iter().find(|v| v.id == id)) else {
        let message = "the selected VPS is no longer on this account".to_string();
        record(conn, Outcome::Error(&message));
        return PollResult::Failed(message);
    };

    match upsert(conn, org_id, vm, &metrics, now) {
        Ok(n) => {
            record(conn, Outcome::Success);
            PollResult::Applied(n)
        }
        Err(message) => {
            record(conn, Outcome::Error(&message));
            PollResult::Failed(message)
        }
    }
}

/// The status codes that end a poll, with the message each records (R14).
fn status_problem(status: u16, retry_after_s: Option<u64>) -> Option<(String, PollResult)> {
    match status {
        200 => None,
        401 => Some(("api token rejected".into(), PollResult::Failed("api token rejected".into()))),
        // Ours to fix, not Miguel's: `date_from`/`date_to` are required and this reader builds them (R5).
        422 => Some(("bad request window (HTTP 422)".into(), PollResult::Failed("bad request window (HTTP 422)".into()))),
        429 => Some(("rate limited (HTTP 429)".into(), PollResult::RateLimited { retry_after_s })),
        other => Some((format!("HTTP {other}"), PollResult::Failed(format!("HTTP {other}")))),
    }
}

fn finish(conn: &mut Connection, record: impl Fn(&Connection, Outcome<'_>), problem: (String, PollResult)) -> PollResult {
    let (message, result) = problem;
    record(conn, Outcome::Error(&message));
    result
}

/// One row per metric, in a single transaction.
///
/// `limit_value` is stored **in bytes**, converted from the API's MiB, so that it and `used` are always in the
/// same unit and no surface has to repeat R7's conversion. CPU and uptime keep NULL limits: a percentage and a
/// duration have no allowance. Bandwidth keeps a NULL limit too, for now — see the module header and §7 Q1.
/// One row bound for `provider_metrics`.
///
/// A struct rather than a tuple because the two `Option<f64>` fields are `limit_value` and `used_pct`, and at a
/// call site those are indistinguishable by position — swapping them would store a percentage as a denominator
/// and still compile.
struct Row {
    metric: &'static str,
    window: &'static str,
    used: f64,
    limit: Option<f64>,
    unit: Option<String>,
    pct: Option<f64>,
}

impl Row {
    /// A number with no denominator: rendered as a figure, never a bar (R8's rule, reused here).
    fn figure(metric: &'static str, window: &'static str, used: f64, unit: Option<String>) -> Self {
        Row { metric, window, used, limit: None, unit, pct: None }
    }

    /// A usage-in-bytes figure against an allowance-in-MiB, which is the only place those two units meet (R7).
    /// The limit is stored in **bytes** so that it and `used` always share a unit.
    fn gauged(metric: &'static str, used_bytes: f64, unit: Option<String>, allowance_mib: f64) -> Self {
        Row {
            metric,
            window: WINDOW_NOW,
            used: used_bytes,
            limit: Some(allowance_mib * MIB),
            unit,
            pct: trusted_pct(pct_of_mib(used_bytes, allowance_mib)),
        }
    }
}

fn upsert(conn: &mut Connection, org_id: &str, vm: &Vm, metrics: &Metrics, now: i64) -> Result<usize, String> {
    let detail = vm.detail();
    let mut rows: Vec<Row> = Vec::new();

    if let Some(cpu) = &metrics.cpu {
        // A percentage has no allowance to be measured against, so it stays a figure.
        rows.push(Row::figure(METRIC_CPU, WINDOW_NOW, cpu.latest, cpu.unit.clone()));
    }
    if let Some(ram) = &metrics.ram {
        rows.push(Row::gauged(METRIC_RAM, ram.latest, ram.unit.clone(), vm.memory_mib));
    }
    if let Some(disk) = &metrics.disk {
        rows.push(Row::gauged(METRIC_DISK, disk.latest, disk.unit.clone(), vm.disk_mib));
    }
    if let Some(uptime) = &metrics.uptime {
        rows.push(Row::figure(METRIC_UPTIME, WINDOW_NOW, uptime.latest, uptime.unit.clone()));
    }
    // Both directions, summed — the upper bound, which is the safe direction while §7 Q1 and Q2 are open. The
    // NULL limit is what keeps this a figure rather than a bar until they are answered (R10).
    if metrics.outgoing.is_some() || metrics.incoming.is_some() {
        let total = metrics.outgoing.as_ref().map(|s| s.sum).unwrap_or_default() + metrics.incoming.as_ref().map(|s| s.sum).unwrap_or_default();
        let unit = metrics.outgoing.as_ref().or(metrics.incoming.as_ref()).and_then(|s| s.unit.clone());
        rows.push(Row::figure(METRIC_BANDWIDTH, WINDOW_MONTH, total, unit));
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let written = rows.len();
    for Row { metric, window, used, limit, unit, pct } in rows {
        tx.execute(
            "INSERT INTO provider_metrics (org_id, provider, metric, \"window\", used, limit_value, unit, used_pct, detail, source, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT (org_id, provider, metric, \"window\") DO UPDATE SET
               used = excluded.used, limit_value = excluded.limit_value, unit = excluded.unit,
               used_pct = excluded.used_pct, detail = excluded.detail, source = excluded.source,
               updated_at = excluded.updated_at",
            params![org_id, PROVIDER, metric, window, used, limit, unit, pct, detail, SOURCE, now],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};

    const TOKEN: &str = "hostinger-FAKE-api-token";
    const VM_ID: i64 = 17923;

    struct Stub {
        list_status: u16,
        list_body: String,
        metrics_status: u16,
        metrics_body: String,
        retry_after_s: Option<u64>,
        calls: AtomicUsize,
        /// The id the reader actually asked for, recorded rather than asserted here: a stub that insisted on one
        /// id could not be reused by the tests that poll for a different machine, and a fixed assertion inside a
        /// stub fails in the stub's name rather than the test's.
        last_vm: AtomicI64,
    }

    impl Stub {
        fn ok() -> Self {
            Stub {
                list_status: 200,
                list_body: vms_fixture(),
                metrics_status: 200,
                metrics_body: metrics_fixture(),
                retry_after_s: None,
                calls: AtomicUsize::new(0),
                last_vm: AtomicI64::new(0),
            }
        }
    }

    impl MetricsClient for Stub {
        fn list_vms(&self, _base_url: &str, token: &str) -> Result<HttpResponse, String> {
            assert_eq!(token, TOKEN, "the reader must send the configured token");
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(HttpResponse { status: self.list_status, retry_after_s: self.retry_after_s, body: self.list_body.clone() })
        }

        fn metrics(&self, _base_url: &str, token: &str, vm_id: i64, date_from: &str, date_to: &str) -> Result<HttpResponse, String> {
            assert_eq!(token, TOKEN);
            assert!(!date_from.is_empty() && !date_to.is_empty(), "both window parameters are required (R5)");
            self.last_vm.store(vm_id, Ordering::SeqCst);
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(HttpResponse { status: self.metrics_status, retry_after_s: self.retry_after_s, body: self.metrics_body.clone() })
        }
    }

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)).unwrap()
    }
    fn vms_fixture() -> String {
        fixture("hostinger-vms.synthetic.json")
    }
    fn metrics_fixture() -> String {
        fixture("hostinger-metrics.synthetic.json")
    }

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        (dir, store)
    }

    fn one(store: &Store, metric: &str, column: &str) -> Option<f64> {
        store
            .conn()
            .query_row(
                &format!("SELECT {column} FROM provider_metrics WHERE provider = 'hostinger' AND metric = ?1"),
                params![metric],
                |r| r.get(0),
            )
            .unwrap()
    }

    // R1. The two guards that make "watch-only" true, since the credential does not make it true.
    //
    // Both judge **code**, not prose: `code_lines` drops comment lines first. That is not a convenience, it is
    // what makes the guards correct. Written against the raw source, the first version of these two tests both
    // failed on themselves — one on the sentence in this very comment block naming the verb it forbids, the
    // other on the list of forbidden words in its own array. A guard that trips on a description of itself
    // teaches whoever hits it to weaken the guard, which is the opposite of the point. Prose may name a
    // destructive endpoint; a URL may not contain one.
    //
    // Dropping whole comment lines is deliberately blunt: a trailing comment on a line of code is still judged.
    // Over-strict fails loudly and is fixed in a minute; under-strict is how a destructive call ships.
    fn code_lines() -> String {
        include_str!("mod.rs")
            .lines()
            .filter(|line| {
                let t = line.trim_start();
                !(t.starts_with("//") || t.starts_with('*') || t.starts_with("/*"))
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn the_guards_are_reading_real_code_and_not_an_empty_string() {
        // The negative control for the two guards below. If `code_lines` ever returned nothing — a changed
        // filter, a renamed file, a failed include — both would go on passing while the rule they exist to
        // protect had quietly stopped being checked. A security test that cannot fail is worse than none,
        // because it is believed.
        let code = code_lines();
        assert!(code.contains("fn parse_vms"), "the guards are not reading this module's code");
        assert!(code.contains("api/vps"), "the guards cannot see the URLs they are meant to judge");
        // And the comment filter really is dropping prose. Checked by counting lines rather than by searching
        // for a phrase: the first version of this assertion looked for a sentence from the module header, and
        // failed — because writing that sentence as a string literal here put it back into the code the filter
        // returns. Three tests in this file have now self-matched that way. A count cannot.
        let raw = include_str!("mod.rs").lines().count();
        assert!(code.lines().count() < raw, "no comment lines were dropped from {raw}");
    }

    #[test]
    fn no_verb_but_get_reaches_hostinger() {
        let code = code_lines();
        for verb in ["post", "put", "patch", "delete", "head"] {
            let needle = format!(".{verb}(");
            assert!(!code.contains(&needle), "{needle} has no business in a watch-only reader");
        }
    }

    #[test]
    fn no_destructive_path_is_ever_constructed() {
        // GET-only is not enough on its own: these endpoints differ from the ones this reader calls only by
        // verb and suffix, so an edit that changed the verb would be one typo from destroying the machine.
        //
        // The halves are joined at runtime so that this array cannot satisfy its own search.
        let code = code_lines();
        for (head, tail) in [
            ("recre", "ate"),
            ("rest", "art"),
            ("root", "-password"),
            ("panel", "-password"),
            ("namese", "rvers"),
            ("purch", "ase"),
            ("/st", "op"),
            ("/st", "art"),
        ] {
            let fragment = format!("{head}{tail}");
            assert!(!code.contains(&fragment), "the path fragment {fragment} appeared in a watch-only reader");
        }
    }

    #[test]
    fn the_list_carries_every_denominator_the_feature_needs() {
        let vms = parse_vms(&vms_fixture()).unwrap();
        assert_eq!(vms.len(), 2);
        let vm = &vms[0];
        assert_eq!((vm.id, vm.hostname.as_str(), vm.plan.as_str(), vm.state.as_str()), (17923, "srv17923.hstgr.cloud", "KVM 4", "running"));
        assert_eq!((vm.memory_mib, vm.disk_mib, vm.bandwidth_mib), (8192.0, 51200.0, 16777216.0));
        // A stopped machine is data, not an error (R14).
        assert_eq!(vms[1].state, "stopped");
    }

    #[test]
    fn the_newest_sample_wins_and_keys_compare_numerically() {
        let m = parse_metrics(&metrics_fixture()).unwrap();
        // 1789700600 is the newest; the larger earlier values must not win.
        assert_eq!(m.cpu.as_ref().unwrap().latest, 12.5);
        assert_eq!(m.ram.as_ref().unwrap().latest, 554176512.0);
        assert_eq!(m.ram.as_ref().unwrap().unit.as_deref(), Some("bytes"));
        // The traffic totals are sums, not latest values.
        assert_eq!(m.outgoing.as_ref().unwrap().sum, 3.0 * 1099511627776.0);
        assert_eq!(m.incoming.as_ref().unwrap().sum, 1099511627776.0);
    }

    #[test]
    fn a_null_metric_is_omitted_rather_than_stored_as_zero() {
        // R6. A zero renders as "0 % used", which reads as good news — the one failure mode worth a test.
        let body = r#"{"cpu_usage":null,"ram_usage":{"unit":"bytes","usage":{"1":5}},"disk_space":null,
                       "outgoing_traffic":null,"incoming_traffic":null,"uptime":null}"#;
        let m = parse_metrics(body).unwrap();
        assert!(m.cpu.is_none() && m.disk.is_none() && m.uptime.is_none());
        assert_eq!(m.ram.unwrap().latest, 5.0);
    }

    #[test]
    fn every_metric_null_is_an_error_naming_keys_only() {
        let err = parse_metrics(r#"{"cpu_usage":null,"ram_usage":null}"#).unwrap_err();
        assert!(err.contains("cpu_usage") && err.contains("ram_usage"), "{err}");
    }

    #[test]
    fn bytes_against_mib_is_exact_and_the_plausible_near_miss_is_not_accepted() {
        // R7, and the whole reason the conversion lives in one function. The spec's own example values.
        let ram = pct_of_mib(554176512.0, 8192.0).unwrap();
        let disk = pct_of_mib(2620018688.0, 51200.0).unwrap();
        assert!((ram - 6.4515).abs() < 0.0001, "ram was {ram}");
        assert!((disk - 4.8802).abs() < 0.0001, "disk was {disk}");
        // Reading the documented "megabytes" as 10⁶ gives 6.7649 — close enough to look right, which is exactly
        // why R9's band cannot catch it and this assertion has to.
        assert!((ram - 6.7649).abs() > 0.1, "the 10^6 reading slipped through: {ram}");
        // Treating the allowance as bytes is the catastrophic version; R9 does catch that one.
        assert_eq!(trusted_pct(Some(100.0 * 554176512.0 / 8192.0)), None);
    }

    #[test]
    fn a_real_overage_survives_but_a_unit_error_does_not() {
        // R9's band is generous on purpose: hiding overage is the one thing a usage gauge exists to prevent.
        assert_eq!(trusted_pct(Some(150.0)), Some(150.0));
        assert_eq!(trusted_pct(Some(0.0)), Some(0.0));
        assert_eq!(trusted_pct(Some(PCT_MAX)), Some(PCT_MAX));
        assert_eq!(trusted_pct(Some(PCT_MAX + 0.1)), None);
        assert_eq!(trusted_pct(Some(-1.0)), None);
        assert_eq!(trusted_pct(Some(f64::NAN)), None);
        assert_eq!(trusted_pct(None), None);
    }

    #[test]
    fn the_window_is_the_utc_calendar_month_to_date() {
        // 2026-09-18T07:00:00Z
        let (from, to) = month_window(1789714800000).unwrap();
        assert_eq!(from, "2026-09-01T00:00:00Z");
        assert!(to.starts_with("2026-09-18T"), "{to}");
        assert!(to.ends_with('Z'), "the API wants RFC 3339: {to}");
    }

    #[test]
    fn a_good_poll_writes_the_tile_rows_and_leaves_bandwidth_a_figure() {
        let (_dir, store) = store();
        let org = store.org_id().to_string();
        let stub = Stub::ok();
        let result = poll(&mut store.conn(), &org, Some(TOKEN), Some(VM_ID), &stub, 1_000);
        assert_eq!(result, PollResult::Applied(5));
        assert_eq!(stub.last_vm.load(Ordering::SeqCst), VM_ID, "the metrics call must name the selected machine");

        assert_eq!(one(&store, METRIC_RAM, "used"), Some(554176512.0));
        // The limit is stored in bytes, so `used` and `limit_value` share a unit and R7 lives in one place.
        assert_eq!(one(&store, METRIC_RAM, "limit_value"), Some(8192.0 * MIB));
        let pct = one(&store, METRIC_RAM, "used_pct").unwrap();
        assert!((pct - 6.4515).abs() < 0.0001, "{pct}");
        // CPU and uptime have no allowance, so they keep NULL and render as figures.
        assert_eq!(one(&store, METRIC_CPU, "limit_value"), None);
        assert_eq!(one(&store, METRIC_UPTIME, "limit_value"), None);
        // Bandwidth is the month's traffic, both directions, with **no** denominator until §7 Q1/Q2 are settled.
        assert_eq!(one(&store, METRIC_BANDWIDTH, "used"), Some(4.0 * 1024.0 * 1024.0 * 1024.0 * 1024.0));
        assert_eq!(one(&store, METRIC_BANDWIDTH, "limit_value"), None);
        assert_eq!(one(&store, METRIC_BANDWIDTH, "used_pct"), None);
    }

    #[test]
    fn nothing_is_requested_without_a_token_or_a_vps() {
        let (_dir, store) = store();
        let org = store.org_id().to_string();
        let stub = Stub::ok();
        assert_eq!(poll(&mut store.conn(), &org, None, Some(VM_ID), &stub, 1_000), PollResult::NotConfigured);
        assert_eq!(poll(&mut store.conn(), &org, Some(TOKEN), None, &stub, 1_000), PollResult::NotConfigured);
        assert_eq!(stub.calls.load(Ordering::SeqCst), 0, "R4: nothing configured means zero requests");
    }

    #[test]
    fn a_rejected_token_costs_one_request_not_two() {
        let (_dir, store) = store();
        let org = store.org_id().to_string();
        let stub = Stub { list_status: 401, ..Stub::ok() };
        assert_eq!(poll(&mut store.conn(), &org, Some(TOKEN), Some(VM_ID), &stub, 1_000), PollResult::Failed("api token rejected".into()));
        assert_eq!(stub.calls.load(Ordering::SeqCst), 1, "the metrics call must not follow a failed list");
    }

    #[test]
    fn failures_keep_the_previous_values() {
        let (_dir, store) = store();
        let org = store.org_id().to_string();
        assert_eq!(poll(&mut store.conn(), &org, Some(TOKEN), Some(VM_ID), &Stub::ok(), 1_000), PollResult::Applied(5));
        let before = one(&store, METRIC_RAM, "used");

        for (stub, expected) in [
            (Stub { metrics_status: 401, ..Stub::ok() }, PollResult::Failed("api token rejected".into())),
            (Stub { metrics_status: 422, ..Stub::ok() }, PollResult::Failed("bad request window (HTTP 422)".into())),
            (Stub { metrics_status: 500, ..Stub::ok() }, PollResult::Failed("HTTP 500".into())),
            (Stub { metrics_body: "not json".into(), ..Stub::ok() }, PollResult::Failed("unrecognized response shape: not JSON".into())),
        ] {
            assert_eq!(poll(&mut store.conn(), &org, Some(TOKEN), Some(VM_ID), &stub, 2_000), expected);
            assert_eq!(one(&store, METRIC_RAM, "used"), before, "a failure must keep the previous numbers (R14)");
        }

        let limited = Stub { metrics_status: 429, retry_after_s: Some(42), ..Stub::ok() };
        assert_eq!(
            poll(&mut store.conn(), &org, Some(TOKEN), Some(VM_ID), &limited, 3_000),
            PollResult::RateLimited { retry_after_s: Some(42) }
        );
        assert_eq!(one(&store, METRIC_RAM, "used"), before);
    }

    #[test]
    fn the_chosen_machine_is_used_and_not_merely_the_first_listed() {
        // The fixture holds two machines on purpose. srv18044 is second, `stopped`, and has a 100 GiB disk
        // against srv17923's 50 GiB — so reading the wrong one gives a plausible number, not an obvious error.
        let (_dir, store) = store();
        let org = store.org_id().to_string();
        assert_eq!(poll(&mut store.conn(), &org, Some(TOKEN), Some(18044), &Stub::ok(), 1_000), PollResult::Applied(5));
        assert_eq!(one(&store, METRIC_DISK, "limit_value"), Some(102400.0 * MIB));
        let detail: String = store
            .conn()
            .query_row("SELECT detail FROM provider_metrics WHERE provider = 'hostinger' AND metric = 'disk'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(detail, "srv18044.hstgr.cloud · KVM 2 · stopped", "a stopped machine is still data (R14)");
    }

    #[test]
    fn a_vps_that_left_the_account_says_so_rather_than_showing_another_one() {
        let (_dir, store) = store();
        let org = store.org_id().to_string();
        let result = poll(&mut store.conn(), &org, Some(TOKEN), Some(999_999), &Stub::ok(), 1_000);
        assert_eq!(result, PollResult::Failed("the selected VPS is no longer on this account".into()));
    }

    #[test]
    fn the_tile_can_label_itself_without_a_second_lookup() {
        let (_dir, store) = store();
        let org = store.org_id().to_string();
        poll(&mut store.conn(), &org, Some(TOKEN), Some(VM_ID), &Stub::ok(), 1_000);
        let detail: String = store
            .conn()
            .query_row("SELECT detail FROM provider_metrics WHERE provider = 'hostinger' AND metric = 'ram'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(detail, "srv17923.hstgr.cloud · KVM 4 · running");
    }
}
