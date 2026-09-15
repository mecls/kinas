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
pub fn projects_root() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"));
    let config = std::env::var_os("KINAS_CONFIG")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config/kinas/config.json"));
    projects_root_from(std::env::var("KINAS_ROOT").ok().as_deref(), &config, &home)
}

/// `projects_root` with its inputs passed in, so tests never touch the process environment.
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
}
