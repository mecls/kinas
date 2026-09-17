//! When the readers run (PRD R13, §3.1 step 7, §3.2–§3.5). One thread per reader; each takes the store's
//! connection only for its own writes, never across a network request or a sample, so the window's reads
//! are never blocked for long.

use super::{claude_plan, convex, host, logs, ollama_cloud, poller};
use crate::keychain::{self, KeyStore};
use crate::redact::{write_reader_status, Outcome, Reader};
use crate::store::{now_ms, Store};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

pub const READINGS_CHANGED: &str = "readings_changed";
pub const BACKFILL_PROGRESS: &str = "backfill_progress";

const HOST_VISIBLE: Duration = Duration::from_secs(10);
const HOST_HIDDEN: Duration = Duration::from_secs(60);
const SWEEP_EVERY: Duration = Duration::from_secs(60);
const LOGS_DEBOUNCE: Duration = Duration::from_secs(2);
const HANDOFF_DEBOUNCE: Duration = Duration::from_secs(1);

#[derive(Debug, Default, Clone, Copy, Serialize)]
pub struct Backfill {
    pub done: usize,
    pub total: usize,
    pub running: bool,
}

/// Shared with the Tauri commands: page visibility, wake-ups and backfill progress.
pub struct ReaderControl {
    usage_visible: AtomicBool,
    host: Mutex<Sender<()>>,
    logs: Mutex<Sender<()>>,
    handoff: Mutex<Sender<()>>,
    ollama: Mutex<Sender<poller::Trigger>>,
    convex: Mutex<Sender<poller::Trigger>>,
    backfill: Mutex<Backfill>,
    data_dir: PathBuf,
}

impl ReaderControl {
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn backfill(&self) -> Backfill {
        *self.backfill.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The Usage page became visible or hidden (R13): the host cadence changes, and a visible page refreshes
    /// an Ollama reading older than 60 s.
    pub fn set_usage_visible(&self, visible: bool, ollama_reading_age_ms: Option<i64>) {
        let was = self.usage_visible.swap(visible, Ordering::SeqCst);
        if visible && !was {
            let _ = self.host.lock().unwrap_or_else(|p| p.into_inner()).send(());
            let _ = self
                .ollama
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .send(poller::Trigger::Visible { reading_age_ms: ollama_reading_age_ms });
        }
    }

    /// "Refresh readings" in the palette, or a key just saved in Settings.
    pub fn refresh(&self) {
        let _ = self.host.lock().unwrap_or_else(|p| p.into_inner()).send(());
        let _ = self.logs.lock().unwrap_or_else(|p| p.into_inner()).send(());
        let _ = self.handoff.lock().unwrap_or_else(|p| p.into_inner()).send(());
        let _ = self.ollama.lock().unwrap_or_else(|p| p.into_inner()).send(poller::Trigger::Manual);
        let _ = self.convex.lock().unwrap_or_else(|p| p.into_inner()).send(poller::Trigger::Manual);
    }
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// Transcript roots; debug builds accept overrides so e2e runs read fixtures, not Miguel's history.
fn roots() -> (PathBuf, PathBuf) {
    #[cfg(debug_assertions)]
    {
        let claude = std::env::var_os("KINAS_CLAUDE_PROJECTS_DIR").map(PathBuf::from);
        let pi = std::env::var_os("KINAS_PI_SESSIONS_DIR").map(PathBuf::from);
        if claude.is_some() || pi.is_some() {
            return (claude.unwrap_or_default(), pi.unwrap_or_default());
        }
    }
    (home().join(".claude/projects"), home().join(".pi/agent/sessions"))
}

fn key_store() -> Arc<dyn KeyStore> {
    #[cfg(debug_assertions)]
    if std::env::var("KINAS_E2E_MEMORY_KEYCHAIN").as_deref() == Ok("1") {
        let store = keychain::MemoryKeyStore::default();
        if let Ok(key) = std::env::var("KINAS_E2E_OLLAMA_KEY") {
            let _ = store.set(keychain::OLLAMA_ACCOUNT, &key);
        }
        if let Ok(key) = std::env::var("KINAS_E2E_CONVEX_KEY") {
            let _ = store.set(keychain::CONVEX_ACCOUNT, &key);
        }
        return Arc::new(store);
    }
    Arc::new(keychain::MacKeychain)
}

pub fn start(app: &AppHandle, data_dir: PathBuf) -> Arc<dyn KeyStore> {
    let (host_tx, host_rx) = channel();
    let (logs_tx, logs_rx) = channel();
    let (handoff_tx, handoff_rx) = channel();
    let (ollama_tx, ollama_rx) = channel();
    let (convex_tx, convex_rx) = channel();
    let keys = key_store();
    app.manage(ReaderControl {
        usage_visible: AtomicBool::new(false),
        host: Mutex::new(host_tx),
        logs: Mutex::new(logs_tx.clone()),
        handoff: Mutex::new(handoff_tx.clone()),
        ollama: Mutex::new(ollama_tx),
        convex: Mutex::new(convex_tx),
        backfill: Mutex::new(Backfill::default()),
        data_dir: data_dir.clone(),
    });
    let machine = host::machine_name();

    spawn("kinas-host", {
        let app = app.clone();
        let machine = machine.clone();
        move || host_loop(app, machine, host_rx)
    });
    spawn("kinas-logs", {
        let app = app.clone();
        move || logs_loop(app, machine, logs_tx, logs_rx)
    });
    spawn("kinas-handoff", {
        let app = app.clone();
        let data_dir = data_dir.clone();
        move || handoff_loop(app, data_dir, handoff_tx, handoff_rx)
    });
    spawn("kinas-ollama", {
        let app = app.clone();
        let keys = Arc::clone(&keys);
        move || ollama_loop(app, keys, ollama_rx)
    });
    spawn("kinas-convex", {
        let app = app.clone();
        let keys = Arc::clone(&keys);
        move || convex_loop(app, keys, convex_rx)
    });
    keys
}

fn spawn(name: &str, f: impl FnOnce() + Send + 'static) {
    if let Err(e) = std::thread::Builder::new().name(name.into()).spawn(f) {
        log::error!("could not start {name}: {e}");
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit(READINGS_CHANGED, ());
    crate::tray::refresh(app);
}

/// Waits for a wake-up or the timeout. Returns false when the channel is gone (the app is quitting).
fn wait(rx: &Receiver<()>, timeout: Duration) -> bool {
    !matches!(rx.recv_timeout(timeout), Err(RecvTimeoutError::Disconnected))
}

fn drain<T>(rx: &Receiver<T>, debounce: Duration) {
    std::thread::sleep(debounce);
    while rx.try_recv().is_ok() {}
}

fn host_loop(app: AppHandle, machine: String, rx: Receiver<()>) {
    let mut sampler = host::HostSampler::default();
    loop {
        let reading = sampler.sample();
        let now = now_ms();
        {
            let store = app.state::<Store>();
            let conn = store.conn();
            let outcome = match &reading {
                Ok(r) => match host::write_host(&conn, store.org_id(), &machine, r, now) {
                    Ok(()) => Outcome::Success,
                    Err(e) => {
                        log::error!("host: {e}");
                        Outcome::Error("could not store the host reading")
                    }
                },
                Err(e) => Outcome::Error(e),
            };
            let _ = write_reader_status(&conn, store.org_id(), Reader::Host, outcome, now);
        }
        changed(&app);
        let visible = app.state::<ReaderControl>().usage_visible.load(Ordering::SeqCst);
        if !wait(&rx, if visible { HOST_VISIBLE } else { HOST_HIDDEN }) {
            return;
        }
    }
}

fn logs_loop(app: AppHandle, machine: String, tx: Sender<()>, rx: Receiver<()>) {
    let (claude_root, pi_root) = roots();
    // Kept alive for the life of the thread.
    let _watcher = watch(&[&claude_root, &pi_root], notify::RecursiveMode::Recursive, tx);
    let mut first = true;
    loop {
        let files: Vec<(logs::Harness, Reader, PathBuf, Vec<PathBuf>)> = [
            (logs::Harness::ClaudeCode, Reader::ClaudeCodeLogs, claude_root.clone()),
            (logs::Harness::Pi, Reader::PiLogs, pi_root.clone()),
        ]
        .into_iter()
        .map(|(harness, reader, root)| {
            let list = logs::jsonl_files(&root);
            (harness, reader, root, list)
        })
        .collect();
        let total: usize = files.iter().map(|f| f.3.len()).sum();
        let mut done = 0;
        let mut any_events = false;
        if first {
            set_backfill(&app, Backfill { done: 0, total, running: true });
        }

        for (harness, reader, root, list) in files {
            let now = now_ms();
            if !root.is_dir() {
                with_conn(&app, |conn, org| {
                    let _ = write_reader_status(conn, org, reader, Outcome::NotConfigured(&format!("{} not found", root.display())), now);
                });
                continue;
            }
            let (mut malformed, mut failed) = (0, Vec::new());
            for file in &list {
                let result = {
                    let store = app.state::<Store>();
                    let mut conn = store.conn();
                    logs::ingest_file(&mut conn, store.org_id(), &machine, harness, file, now)
                };
                match result {
                    Ok(r) => {
                        malformed += r.malformed;
                        any_events |= r.events > 0;
                    }
                    Err(e) => failed.push(e),
                }
                done += 1;
                if first && (done % 20 == 0 || done == total) {
                    set_backfill(&app, Backfill { done, total, running: done < total });
                }
            }
            with_conn(&app, |conn, org| {
                let note;
                let outcome = if !failed.is_empty() {
                    note = format!("could not read {} file(s): {}", failed.len(), failed[0]);
                    Outcome::Error(&note)
                } else if malformed > 0 {
                    note = format!("{malformed} unparseable line(s) skipped");
                    Outcome::Partial(&note)
                } else {
                    Outcome::Success
                };
                let _ = write_reader_status(conn, org, reader, outcome, now);
            });
        }
        if first {
            set_backfill(&app, Backfill { done: total, total, running: false });
            first = false;
        }

        if any_events {
            changed(&app);
        }

        match rx.recv_timeout(SWEEP_EVERY) {
            Ok(()) => drain(&rx, LOGS_DEBOUNCE),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn handoff_loop(app: AppHandle, data_dir: PathBuf, tx: Sender<()>, rx: Receiver<()>) {
    let inbox = claude_plan::handoff_path(&data_dir);
    if let Some(dir) = inbox.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            log::error!("claude-plan: could not create {}: {e}", dir.display());
        }
    }
    let (claude_root, _) = roots();
    let _watcher = inbox.parent().map(|dir| watch(&[dir], notify::RecursiveMode::NonRecursive, tx));
    let mut last_seen: Option<Option<SystemTime>> = None;
    loop {
        let modified = std::fs::metadata(&inbox).and_then(|m| m.modified()).ok();
        if last_seen != Some(modified) {
            last_seen = Some(modified);
            let result = {
                let store = app.state::<Store>();
                let mut conn = store.conn();
                claude_plan::ingest(&mut conn, store.org_id(), &data_dir, &claude_root, now_ms())
            };
            if matches!(result, claude_plan::IngestResult::Applied(n) if n > 0) || matches!(result, claude_plan::IngestResult::Failed(_)) {
                changed(&app);
            }
        }
        match rx.recv_timeout(SWEEP_EVERY) {
            Ok(()) => drain(&rx, HANDOFF_DEBOUNCE),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn ollama_loop(app: AppHandle, keys: Arc<dyn KeyStore>, rx: Receiver<poller::Trigger>) {
    let client = match ollama_cloud::ReqwestClient::new() {
        Ok(c) => c,
        Err(e) => {
            with_conn(&app, |conn, org| {
                let _ = write_reader_status(conn, org, Reader::OllamaCloud, Outcome::Error(&format!("HTTP client: {e}")), now_ms());
            });
            return;
        }
    };
    let base = ollama_cloud::base_url();
    let mut schedule = poller::Poller::new(now_ms());
    loop {
        let now = now_ms();
        let trigger = match rx.recv_timeout(Duration::from_millis(schedule.sleep_ms(now) as u64)) {
            Ok(t) => t,
            Err(RecvTimeoutError::Timeout) => poller::Trigger::Tick,
            Err(RecvTimeoutError::Disconnected) => return,
        };
        let now = now_ms();
        if !schedule.should_request(trigger, now) {
            continue;
        }
        let key = match keys.get(keychain::OLLAMA_ACCOUNT) {
            Ok(k) => k,
            Err(e) => {
                with_conn(&app, |conn, org| {
                    let _ = write_reader_status(conn, org, Reader::OllamaCloud, Outcome::Error(&e), now);
                });
                schedule.skip(now);
                changed(&app);
                continue;
            }
        };
        // The request happens outside the store's lock.
        let fetched = key.as_deref().filter(|k| !k.is_empty()).map(|k| ollama_cloud::fetch(&client, &base, k));
        let requested = fetched.is_some();
        let result = {
            let store = app.state::<Store>();
            let mut conn = store.conn();
            ollama_cloud::record_poll(&mut conn, store.org_id(), fetched, now)
        };
        match result {
            ollama_cloud::PollResult::RateLimited { retry_after_s } => schedule.record(poller::Result::RateLimited { retry_after_s }, now),
            _ if requested => schedule.record(poller::Result::Done, now),
            _ => schedule.skip(now),
        }
        changed(&app);
    }
}

/// The Convex reader's thread (prd-convex-usage.md R11), the same shape as `ollama_loop`.
///
/// Two things it must not do, both of which have bitten this app before: hold the store's lock across the
/// network request, and take `Store::conn()` twice on this thread — the second froze the whole window on
/// 2026-09-16. So the deployment URL and the tier are read under **one** guard that is released before the
/// request, and the write takes a fresh guard afterwards.
fn convex_loop(app: AppHandle, keys: Arc<dyn KeyStore>, rx: Receiver<poller::Trigger>) {
    let client = match convex::ReqwestClient::new() {
        Ok(c) => c,
        Err(e) => {
            with_conn(&app, |conn, org| {
                let _ = write_reader_status(conn, org, Reader::Convex, Outcome::Error(&format!("HTTP client: {e}")), now_ms());
            });
            return;
        }
    };
    let mut schedule = poller::Poller::new(now_ms());
    loop {
        let now = now_ms();
        let trigger = match rx.recv_timeout(Duration::from_millis(schedule.sleep_ms(now) as u64)) {
            Ok(t) => t,
            Err(RecvTimeoutError::Timeout) => poller::Trigger::Tick,
            Err(RecvTimeoutError::Disconnected) => return,
        };
        let now = now_ms();
        if !schedule.should_request(trigger, now) {
            continue;
        }
        let (stored_url, url, tier) = {
            let store = app.state::<Store>();
            let conn = store.conn();
            let org = store.org_id();
            let text = |key: &str| crate::system::get_setting(&conn, org, key).and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
            let stored = text("convex_deployment_url");
            (stored.clone(), convex::base_url(&stored), convex::limits::Tier::parse(&text("convex_plan")))
        };
        let key = match keys.get(keychain::CONVEX_ACCOUNT) {
            Ok(k) => k,
            Err(e) => {
                with_conn(&app, |conn, org| {
                    let _ = write_reader_status(conn, org, Reader::Convex, Outcome::Error(&e), now);
                });
                schedule.skip(now);
                changed(&app);
                continue;
            }
        };
        // "Configured" is judged on the **stored** setting, never on the resolved URL. The debug override decides
        // only *where* a request goes; if it also decided *whether* one happens, a build with the override set
        // would poll with no deployment saved — which is R3's "blank URL means zero requests" quietly broken,
        // and it made the e2e's "makes no request until a deployment is saved" case impossible to satisfy.
        let configured = !stored_url.trim().is_empty();
        // The request happens outside the store's lock.
        let fetched = key.as_deref().filter(|k| !k.is_empty()).filter(|_| configured).map(|k| convex::fetch(&client, &url, k));
        let requested = fetched.is_some();
        let result = {
            let store = app.state::<Store>();
            let mut conn = store.conn();
            convex::record_poll(&mut conn, store.org_id(), fetched, configured, tier, now)
        };
        match result {
            convex::PollResult::RateLimited { retry_after_s } => schedule.record(poller::Result::RateLimited { retry_after_s }, now),
            // A seeding deployment lands here too, and rightly: a request *was* made, so it counts against the
            // cadence even though nothing was written.
            _ if requested => schedule.record(poller::Result::Done, now),
            // Nothing was requested — no key, or no deployment. `skip` moves the next tick on without counting a
            // request, so saving a key polls immediately (R11).
            _ => schedule.skip(now),
        }
        changed(&app);
    }
}

fn with_conn(app: &AppHandle, f: impl FnOnce(&rusqlite::Connection, &str)) {
    let store = app.state::<Store>();
    let conn = store.conn();
    f(&conn, store.org_id());
}

fn set_backfill(app: &AppHandle, value: Backfill) {
    *app.state::<ReaderControl>().backfill.lock().unwrap_or_else(|p| p.into_inner()) = value;
    let _ = app.emit(BACKFILL_PROGRESS, value);
}

/// A file watcher that nudges `tx`; roots that do not exist are skipped (their reader reports it).
fn watch(paths: &[&Path], mode: notify::RecursiveMode, tx: Sender<()>) -> Option<notify::RecommendedWatcher> {
    use notify::Watcher;
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = tx.send(());
        }
    })
    .map_err(|e| log::error!("file watcher: {e}"))
    .ok()?;
    for path in paths.iter().filter(|p| p.is_dir()) {
        if let Err(e) = watcher.watch(path, mode) {
            log::warn!("could not watch {}: {e}", path.display());
        }
    }
    Some(watcher)
}
