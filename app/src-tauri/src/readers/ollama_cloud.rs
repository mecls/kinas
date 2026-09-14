//! Ollama Cloud plan limits from `GET https://ollama.com/api/usage` (PRD R18–R19).
//!
//! The endpoint is undocumented, so parsing is strict about what it recognizes and says so by key name
//! when it doesn't. Legacy plans report `limits.session.usage` and `limits.weekly.usage` as fractions used
//! (0–1) with no reset times; the credit-plan shape has not been captured yet (PRD §7 Q2, task 1.2) and is
//! reported as unrecognized until a real response is committed as a fixture.

use crate::redact::{write_reader_status, Outcome, Reader};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::time::Duration;

pub const SOURCE: &str = "ollama.com/api/usage";
const TIMEOUT: Duration = Duration::from_secs(10);

pub struct HttpResponse {
    pub status: u16,
    pub retry_after_s: Option<u64>,
    pub body: String,
}

/// The one request this module makes, behind a trait so tests never reach the network.
pub trait UsageClient: Send + Sync {
    fn get_usage(&self, base_url: &str, api_key: &str) -> Result<HttpResponse, String>;
}

pub struct ReqwestClient(reqwest::blocking::Client);

impl ReqwestClient {
    pub fn new() -> Result<Self, String> {
        reqwest::blocking::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map(ReqwestClient)
            .map_err(|e| e.to_string())
    }
}

impl UsageClient for ReqwestClient {
    fn get_usage(&self, base_url: &str, api_key: &str) -> Result<HttpResponse, String> {
        let response = self
            .0
            .get(format!("{}/api/usage", base_url.trim_end_matches('/')))
            .bearer_auth(api_key)
            .send()
            // The request error can include the URL but never the Authorization header.
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

/// `https://ollama.com`, or `KINAS_OLLAMA_BASE_URL` in debug builds (a local stub in tests).
pub fn base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("KINAS_OLLAMA_BASE_URL") {
        if !url.is_empty() {
            return url;
        }
    }
    "https://ollama.com".into()
}

#[derive(Debug, Clone, PartialEq)]
pub struct UsageWindow {
    pub window: &'static str,
    pub used_pct: f64,
}

pub fn parse_usage(body: &str) -> Result<Vec<UsageWindow>, String> {
    let j: Value = serde_json::from_str(body).map_err(|_| "unrecognized response shape: not JSON".to_string())?;
    let top_keys = || j.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>().join(", ")).unwrap_or_default();
    let limits = &j["limits"];
    let mut windows = Vec::new();
    for (key, window) in [("session", "session"), ("weekly", "week")] {
        if let Some(usage) = limits[key]["usage"].as_f64() {
            let used = usage * 100.0;
            if !(0.0..=100.0).contains(&used) {
                return Err(format!("out of range: {used}"));
            }
            windows.push(UsageWindow { window, used_pct: used });
        }
    }
    if windows.is_empty() {
        return Err(format!("unrecognized response shape: {}", top_keys()));
    }
    Ok(windows)
}

#[derive(Debug, PartialEq)]
pub enum PollResult {
    NotConfigured,
    Applied(usize),
    RateLimited { retry_after_s: Option<u64> },
    Failed(String),
}

/// The request itself, kept apart from `record_poll` so the runtime makes it without holding the store's lock.
pub fn fetch(client: &dyn UsageClient, base_url: &str, api_key: &str) -> Result<HttpResponse, String> {
    client.get_usage(base_url, api_key)
}

/// One poll (PRD §3.3): `fetch`, then `record_poll`.
#[cfg(test)]
pub fn poll(conn: &mut Connection, org_id: &str, api_key: Option<&str>, client: &dyn UsageClient, base_url: &str, now: i64) -> PollResult {
    let fetched = api_key.filter(|k| !k.is_empty()).map(|k| fetch(client, base_url, k));
    record_poll(conn, org_id, fetched, now)
}

/// Records what a poll found; `None` means there was no key, so no request was made. Values change only on
/// a 200 that parses; every outcome is recorded.
pub fn record_poll(conn: &mut Connection, org_id: &str, fetched: Option<Result<HttpResponse, String>>, now: i64) -> PollResult {
    let record = |conn: &Connection, outcome: Outcome<'_>| {
        if let Err(e) = write_reader_status(conn, org_id, Reader::OllamaCloud, outcome, now) {
            log::error!("ollama-cloud: could not record status: {e}");
        }
    };
    let Some(fetched) = fetched else {
        record(conn, Outcome::NotConfigured("no API key — add one in Settings"));
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
            Ok(windows) => match upsert(conn, org_id, &windows, now) {
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
            // The stored key is not deleted: Miguel decides that in Settings (R18).
            record(conn, Outcome::Error("API key rejected"));
            PollResult::Failed("API key rejected".into())
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

fn upsert(conn: &mut Connection, org_id: &str, windows: &[UsageWindow], now: i64) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for w in windows {
        tx.execute(
            "INSERT INTO quotas (org_id, subscription, \"window\", used_pct, resets_at, plan, source, updated_at)
             VALUES (?1, 'ollama-cloud', ?2, ?3, NULL, NULL, ?4, ?5)
             ON CONFLICT (org_id, subscription, \"window\") DO UPDATE SET
               used_pct = excluded.used_pct, resets_at = NULL, source = excluded.source, updated_at = excluded.updated_at",
            params![org_id, w.window, w.used_pct, SOURCE, now],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(windows.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use std::sync::atomic::{AtomicUsize, Ordering};

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
        fn get_usage(&self, _base: &str, key: &str) -> Result<HttpResponse, String> {
            assert_eq!(key, "ollama-FAKE-key");
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(HttpResponse { status: self.status, retry_after_s: self.retry_after_s, body: self.body.clone() })
        }
    }

    fn legacy() -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/ollama-usage-legacy.synthetic.json")).unwrap()
    }

    fn windows(store: &Store) -> Vec<(String, f64, Option<i64>)> {
        let conn = store.conn();
        let mut stmt = conn
            .prepare("SELECT \"window\", used_pct, resets_at FROM quotas WHERE subscription = 'ollama-cloud' ORDER BY \"window\"")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect()
    }

    fn reader_error(store: &Store) -> (String, Option<String>) {
        store.conn().query_row("SELECT state, last_error FROM reader_status WHERE reader = 'ollama-cloud'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
    }

    #[test]
    fn legacy_shape_is_fractions_used_with_no_reset_times() {
        assert_eq!(
            parse_usage(&legacy()).unwrap(),
            vec![UsageWindow { window: "session", used_pct: 2.5 }, UsageWindow { window: "week", used_pct: 33.5 }]
        );
    }

    #[test]
    fn unknown_shapes_name_their_keys_only() {
        // serde_json keeps object keys sorted.
        assert_eq!(parse_usage(r#"{"plan":"max","credits":{"used":12}}"#).unwrap_err(), "unrecognized response shape: credits, plan");
        assert_eq!(parse_usage(r#"{"limits":{"session":{"usage":1.37}}}"#).unwrap_err(), "out of range: 137");
    }

    #[test]
    fn no_key_means_no_request() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let stub = Stub::new(200, &legacy());
        assert_eq!(poll(&mut store.conn(), store.org_id(), None, &stub, "http://x", 1), PollResult::NotConfigured);
        assert_eq!(stub.calls.load(Ordering::SeqCst), 0);
        assert_eq!(reader_error(&store).0, "not_configured");
    }

    #[test]
    fn a_200_stores_both_windows() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let stub = Stub::new(200, &legacy());
        assert_eq!(poll(&mut store.conn(), store.org_id(), Some("ollama-FAKE-key"), &stub, "http://x", 5), PollResult::Applied(2));
        assert_eq!(windows(&store), vec![("session".into(), 2.5, None), ("week".into(), 33.5, None)]);
        assert_eq!(reader_error(&store), ("ok".into(), None));
    }

    #[test]
    fn failures_keep_the_previous_values() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        poll(&mut store.conn(), store.org_id(), Some("ollama-FAKE-key"), &Stub::new(200, &legacy()), "http://x", 1);
        let before = windows(&store);

        assert_eq!(poll(&mut store.conn(), store.org_id(), Some("ollama-FAKE-key"), &Stub::new(401, ""), "http://x", 2), PollResult::Failed("API key rejected".into()));
        assert_eq!(reader_error(&store), ("error".into(), Some("API key rejected".into())));

        let mut limited = Stub::new(429, "");
        limited.retry_after_s = Some(900);
        assert_eq!(poll(&mut store.conn(), store.org_id(), Some("ollama-FAKE-key"), &limited, "http://x", 3), PollResult::RateLimited { retry_after_s: Some(900) });

        assert_eq!(poll(&mut store.conn(), store.org_id(), Some("ollama-FAKE-key"), &Stub::new(500, "boom"), "http://x", 4), PollResult::Failed("HTTP 500".into()));
        assert!(matches!(poll(&mut store.conn(), store.org_id(), Some("ollama-FAKE-key"), &Stub::new(200, r#"{"plan":"x"}"#), "http://x", 5), PollResult::Failed(_)));

        assert_eq!(windows(&store), before);
    }
}
