use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The folder holding `kinas.sqlite` and the status-line inbox.
///
/// `KINAS_DATA_DIR` overrides it in every build (PRD R7 allows it for tests); otherwise it is the
/// app data folder Tauri derives from the identifier:
/// `~/Library/Application Support/ai.sintralabs.kinas`.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("KINAS_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    app.path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve the app data folder: {e}"))
}

const DEFAULT_ROOT: &str = "~/Documents/Projects/SintraLabs";

/// The projects root the reader enforces (reader PRD R1), read exactly as `loadConfig` in
/// `packages/context/src/config.ts` reads it: `KINAS_ROOT`, else the `root` string in `KINAS_CONFIG` or
/// `~/.config/kinas/config.json`, else `~/Documents/Projects/SintraLabs`. Read on every call, so a config change
/// applies without a restart. An app started by launchd does not see a `KINAS_ROOT` exported in a shell.
/// The projects folder, with the Settings page's value ahead of the config file (reader R1, amended 2026-09-16).
pub fn projects_root(store: &crate::store::Store) -> PathBuf {
    let saved = crate::system::get_setting(&store.conn(), store.org_id(), SETTING_KEY).and_then(|v| v.as_str().map(str::to_string));
    projects_root_with(std::env::var("KINAS_ROOT").ok().as_deref(), saved.as_deref(), &config_path(), &home())
}

/// The key Settings writes: `set_projects_root` stores an absolute path here.
pub const SETTING_KEY: &str = "projects_root";

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

fn config_path() -> PathBuf {
    std::env::var_os("KINAS_CONFIG")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".config/kinas/config.json"))
}

/// `projects_root` with its inputs passed in, so tests never touch the process environment or the store.
///
/// `KINAS_ROOT` first (so an e2e run or a one-off shell wins), then the Settings page's value, then the config file's
/// `root`, then `~/Documents/Projects/SintraLabs`.
pub fn projects_root_with(env_root: Option<&str>, saved: Option<&str>, config: &Path, home: &Path) -> PathBuf {
    if let Some(root) = env_root.filter(|r| !r.trim().is_empty()) {
        return expand(root.trim(), home);
    }
    if let Some(root) = saved.filter(|r| !r.trim().is_empty()) {
        return expand(root.trim(), home);
    }
    projects_root_from(None, config, home)
}

/// The config file and default only, kept for the tests that pin that table.
pub fn projects_root_from(env_root: Option<&str>, config: &Path, home: &Path) -> PathBuf {
    if let Some(root) = env_root.filter(|r| !r.is_empty()) {
        return expand(root, home);
    }
    let from_file = std::fs::read_to_string(config)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("root").and_then(|r| r.as_str()).map(|r| r.trim().to_string()))
        .filter(|r| !r.is_empty());
    expand(from_file.as_deref().unwrap_or(DEFAULT_ROOT), home)
}

/// `~` and `~/…` expand to the home folder, and a relative path joins it, as `expand` in config.ts does.
fn expand(path: &str, home: &Path) -> PathBuf {
    if path == "~" {
        home.to_path_buf()
    } else if let Some(rest) = path.strip_prefix("~/") {
        home.join(rest)
    } else if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        home.join(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The same cases as packages/context/src/config.test.ts, so the CLI and the app agree on the root.
    #[test]
    fn the_projects_root_follows_env_then_file_then_default() {
        let dir = tempfile::tempdir().unwrap();
        let home = Path::new("/Users/someone");
        let file = |name: &str, contents: Option<&str>| {
            let path = dir.path().join(name);
            if let Some(c) = contents {
                std::fs::write(&path, c).unwrap();
            }
            path
        };
        let fallback = home.join("Documents/Projects/SintraLabs");

        assert_eq!(projects_root_from(Some("/from/env"), &file("env.json", Some(r#"{"root":"/from/file"}"#)), home), PathBuf::from("/from/env"));
        assert_eq!(projects_root_from(None, &file("abs.json", Some(r#"{"root":"/from/file"}"#)), home), PathBuf::from("/from/file"));
        assert_eq!(projects_root_from(None, &file("tilde.json", Some(r#"{"root":"~/x"}"#)), home), home.join("x"));
        assert_eq!(projects_root_from(None, &file("rel.json", Some(r#"{"root":"rel"}"#)), home), home.join("rel"));
        assert_eq!(projects_root_from(None, &file("blank.json", Some(r#"{"root":"   "}"#)), home), fallback);
        assert_eq!(projects_root_from(None, &file("bad.json", Some("{nope")), home), fallback);
        assert_eq!(projects_root_from(None, &file("absent.json", None), home), fallback);
        assert_eq!(projects_root_from(Some(""), &file("absent2.json", None), home), fallback);
    }

    // Reader R1, amended: Settings sits between the environment and the config file.
    #[test]
    fn a_folder_saved_in_settings_beats_the_config_file_but_not_the_environment() {
        let dir = tempfile::tempdir().unwrap();
        let home = Path::new("/Users/someone");
        let config = dir.path().join("config.json");
        std::fs::write(&config, r#"{"root":"/from/file"}"#).unwrap();

        assert_eq!(projects_root_with(Some("/from/env"), Some("/from/settings"), &config, home), PathBuf::from("/from/env"));
        assert_eq!(projects_root_with(None, Some("/from/settings"), &config, home), PathBuf::from("/from/settings"));
        assert_eq!(projects_root_with(None, Some("~/docs"), &config, home), home.join("docs"));
        assert_eq!(projects_root_with(None, Some("   "), &config, home), PathBuf::from("/from/file"));
        assert_eq!(projects_root_with(None, None, &config, home), PathBuf::from("/from/file"));
    }
}
