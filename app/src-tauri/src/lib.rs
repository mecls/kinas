mod cli_link;
mod commands;
mod keychain;
mod paths;
mod projects;
mod pty;
mod quota_line;
mod reader;
mod readers;
mod readings;
mod redact;
mod staleness;
mod store;
mod system;
mod tray;

use std::path::Path;
use tauri::{Manager, RunEvent, WindowEvent};

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("kinas".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                // The plugin's defaults are a 40 KB file deleted outright when it fills (`KeepOne`). That threw
                // the evidence away twice on 2026-09-16 while the frozen window and the slow first read were
                // being diagnosed — once in the middle of a measuring run, which read as a hung app. 2 MiB a
                // file and five files holds several sessions, caps the folder at 10 MiB rather than growing
                // without end, and never discards everything at once. Rotation renames the filled file to
                // `kinas_<date>.log` and reopens `kinas.log`, so anything reading the live path keeps working:
                // `scripts/acceptance.sh` reads `kinas.log` by name, and its §5.3 secret scan globs the whole
                // folder, so the rotated files are scanned too.
                .max_file_size(2 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .level(log::LevelFilter::Info)
                .build(),
        );
    let builder = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(system::on_hotkey).build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        // The save sheet behind the reader's Download, opened from Rust only (reader/export.rs). No capability
        // grants a `dialog:*` permission, so the webview cannot raise a dialog of its own: Tauri checks the ACL
        // on every `plugin:` command, and registering a plugin grants nothing.
        .plugin(tauri_plugin_dialog::init())
        .manage(system::SystemState::default());
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .setup(|app| {
            // e2e launches run as background apps: no Dock icon, no stolen focus while Miguel works.
            #[cfg(all(feature = "e2e", target_os = "macos"))]
            if std::env::var("KINAS_E2E_NO_SYSTEM_HOOKS").as_deref() == Ok("1") {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            let dir = paths::data_dir(app.handle())?;
            match store::Store::open(&dir) {
                Ok(store) => {
                    log::info!("store open at {}", store.path().display());
                    // Settings → Appearance, before the page draws: a launch on the light ground never shows the
                    // dark one first. Here rather than in system::setup, which e2e launches partly skip.
                    let (_, theme) = system::stored_appearance(system::get_setting(&store.conn(), store.org_id(), "appearance"));
                    if let Some(window) = app.get_webview_window("main") {
                        system::apply_appearance(&window, theme);
                    }
                    app.manage(store);
                    // Reader R15: `kinas open` reaches this instance through <data dir>/kinas.sock.
                    reader::socket::start(app.handle().clone(), &dir);
                    let keys = readers::runtime::start(app.handle(), dir.clone());
                    app.manage(keychain::Keys(keys));
                    // R35: ~/.local/bin/kinas → the CLI in this bundle, never clobbering anything else.
                    let link = cli_link::ensure_for_running_app();
                    log::info!("cli link: {link:?}");
                    app.manage(cli_link::CliLink(link));
                    // R39: the menu bar item.
                    if let Err(e) = tray::install(app.handle()) {
                        log::error!("menu bar item: {e}");
                    }
                    // R29, R30: launch at login and the global hotkey.
                    system::setup(app.handle());
                }
                Err(error) => {
                    // Nothing works without the store (PRD §3.1 step 1): say where and why, then quit.
                    log::error!("store failed to open at {}: {error}", dir.display());
                    fatal_dialog(&dir.join(store::DB_FILE), &error);
                    std::process::exit(1);
                }
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(projects::ProjectsCache::default())
        .manage(reader::ReaderState::default())
        .invoke_handler(tauri::generate_handler![
            commands::store_info,
            commands::pty_start,
            pty::pane_session,
            commands::pty_write,
            commands::pty_write_binary,
            commands::pty_resize,
            commands::pty_pid,
            commands::clipboard_write_text,
            commands::get_usage_snapshot,
            commands::set_usage_visible,
            commands::refresh_readings,
            commands::ollama_key_status,
            commands::save_ollama_key,
            commands::remove_ollama_key,
            commands::convex_key_status,
            commands::save_convex_key,
            commands::remove_convex_key,
            commands::set_convex_deployment,
            commands::set_convex_plan,
            commands::hostinger_key_status,
            commands::save_hostinger_token,
            commands::remove_hostinger_token,
            commands::hostinger_list_vms,
            commands::set_hostinger_vm,
            commands::cli_link_status,
            commands::get_settings,
            commands::set_org_name,
            commands::set_reader_editor,
            commands::set_projects_root,
            commands::set_appearance,
            commands::set_accent,
            commands::set_menu_bar_quota,
            commands::set_global_hotkey,
            commands::set_launch_at_login,
            commands::get_ui_prefs,
            commands::set_shortcuts,
            commands::set_sidebar_visible,
            commands::set_reader_width,
            projects::list_projects,
            projects::set_folder_category,
            projects::set_folder_internal,
            projects::set_folder_hidden,
            projects::set_folder_removed,
            projects::add_client_folder,
            reader::reader_open,
            reader::reader_read_text,
            reader::reader_list_dir,
            reader::reader_read_image,
            reader::reader_confirm,
            reader::reader_allow_click,
            reader::reader_close,
            reader::open_external,
            reader::reader_rendered,
            reader::reader_open_in_editor,
            reader::reader_open_in_terminal,
            reader::export::reader_export,
            reader::reader_print,
            reader::pins::reader_pins,
            reader::pins::reader_pin,
            reader::pins::reader_unpin,
        ])
        .on_window_event(|window, event| {
            // Closing the window hides it; the app, its readers and the terminal keep running (R28).
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Kinas");

    app.run(|handle, event| match event {
        // ⌘Q: hang up the terminal's child, SIGKILL after 2 s. Herdr's server keeps its sessions (R28).
        RunEvent::Exit => {
            if let Some(pty) = handle.try_state::<pty::PtyState>() {
                pty.shutdown();
            }
            // Only the socket this instance bound; another Kinas's live socket stays (reader R16).
            if let Some(socket) = handle.try_state::<reader::ReaderState>().and_then(|r| r.lock().socket.clone()) {
                let _ = std::fs::remove_file(socket);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    });
}

/// A blocking alert shown before the app quits. `osascript` needs no extra dependency and works
/// before any window exists.
fn fatal_dialog(db_path: &Path, error: &str) {
    let escape = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display alert \"Kinas can't open its database\" message \"{}\n\n{}\" as critical buttons {{\"Quit\"}} default button \"Quit\"",
        escape(&db_path.display().to_string()),
        escape(error)
    );
    let _ = std::process::Command::new("/usr/bin/osascript").args(["-e", &script]).status();
}
