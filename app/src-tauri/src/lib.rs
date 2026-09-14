mod commands;
mod paths;
mod store;

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
                .level(log::LevelFilter::Info)
                .build(),
        );
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .setup(|app| {
            let dir = paths::data_dir(app.handle())?;
            match store::Store::open(&dir) {
                Ok(store) => {
                    log::info!("store open at {}", store.path().display());
                    app.manage(store);
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
        .invoke_handler(tauri::generate_handler![commands::store_info])
        .on_window_event(|window, event| {
            // Closing the window hides it; the app, its readers and the terminal keep running (R28).
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Kinas");

    app.run(|handle, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (handle, event);
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
