//! The menu bar item (PRD R39): one chosen quota as the title, every quota line in the menu, then
//! "Open Kinas" and "Quit". Rebuilt when readings change and once a minute, so readings age without new data.

use crate::quota_line::{format_quota_line, menu_title, provider_label, QuotaLineInput};
use crate::readers::claude_plan;
use crate::readers::runtime::ReaderControl;
use crate::readings::{self, UsageSnapshot};
use crate::store::{now_ms, Store};
use rusqlite::params;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

pub const TRAY_ID: &str = "kinas";
const OPEN_ID: &str = "open";
const QUIT_ID: &str = "quit";

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .title("—")
        .tooltip("Kinas")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_ID => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;
    refresh(app);
    let handle = app.clone();
    std::thread::Builder::new()
        .name("kinas-tray".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            refresh(&handle);
        })
        .map(|_| ())
        .map_err(|e| tauri::Error::Anyhow(e.into()))
}

/// The quota the menu bar title shows, as `subscription/window` (default `claude-plan/session`).
fn chosen_quota(app: &AppHandle) -> (String, String) {
    let store = app.state::<Store>();
    let value: Option<String> = store
        .conn()
        .query_row("SELECT value FROM settings WHERE org_id = ?1 AND key = 'menu_bar_quota'", params![store.org_id()], |r| r.get(0))
        .ok();
    let choice = value.and_then(|v| serde_json::from_str::<String>(&v).ok()).unwrap_or_else(|| "claude-plan/session".into());
    let (subscription, window) = choice.split_once('/').unwrap_or(("claude-plan", "session"));
    (subscription.to_string(), window.to_string())
}

fn read(app: &AppHandle) -> Option<UsageSnapshot> {
    let store = app.state::<Store>();
    let control = app.try_state::<ReaderControl>()?;
    let now = now_ms();
    let hook = claude_plan::hook_status(control.data_dir(), now);
    let snapshot = readings::snapshot(&store.conn(), store.org_id(), now, control.backfill(), hook);
    snapshot.map_err(|e| log::error!("tray: {e}")).ok()
}

pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let Some(snapshot) = read(app) else { return };
    let (subscription, window) = chosen_quota(app);
    let chosen = snapshot.quotas.iter().find(|q| q.subscription == subscription && q.window == window);
    let _ = tray.set_title(Some(menu_title(chosen.map(|q| (q.used_pct, q.state)))));
    match build_menu(app, &snapshot) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => log::error!("tray menu: {e}"),
    }
}

fn build_menu(app: &AppHandle, snapshot: &UsageSnapshot) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    for q in &snapshot.quotas {
        let reason = snapshot.readers.iter().find(|r| r.reader == q.subscription).and_then(|r| r.last_error.as_deref());
        let line = format_quota_line(
            &QuotaLineInput {
                provider: &q.subscription,
                window: &q.window,
                used_pct: q.used_pct,
                resets_at: q.resets_at,
                updated_at: Some(q.updated_at),
                state: q.state,
                reason,
            },
            snapshot.now,
        );
        menu.append(&MenuItem::new(app, line, false, None::<&str>)?)?;
    }
    for provider in ["claude-plan", "ollama-cloud"] {
        if snapshot.quotas.iter().any(|q| q.subscription == provider) {
            continue;
        }
        let text = format!("{} — not connected", provider_label(provider));
        menu.append(&MenuItem::new(app, text, false, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, OPEN_ID, "Open Kinas", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)?)?;
    Ok(menu)
}
