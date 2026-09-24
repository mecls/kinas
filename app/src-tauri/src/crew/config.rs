//! What Settings → Crew shows of Firstmate's own configuration (build spec §4 Settings): the away record while it
//! exists, and each project's registered mode. Both come from Firstmate's read-only scripts (`fm-afk-contract.sh field`,
//! `fm-project-mode.sh`); the project names are the folders under `<home>/projects/`, where Firstmate clones (or links)
//! every registered project — the registry file itself is not read (ADR 0016, §17). Modes are kept 300 s.

use super::firstmate;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MODES_MS: i64 = 300_000;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Away {
    pub entered: String,
    pub expected_return: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ProjectMode {
    pub name: String,
    pub mode: String,
    pub yolo: bool,
}

/// The away record's entry and expected return, only while `state/.afk-contract` exists.
pub(crate) fn away(home: &Path) -> Option<Away> {
    if !home.join("state/.afk-contract").is_file() {
        return None;
    }
    let field = |name: &str| firstmate::afk_field(home, name).ok().filter(|r| r.ok()).map(|r| r.stdout.trim().to_string()).filter(|v| !v.is_empty());
    let entered = field("entered")?;
    let expected_return = field("expected_return").filter(|v| v != "-");
    Some(Away { entered, expected_return })
}

static MODES: Mutex<Option<(PathBuf, i64, Vec<ProjectMode>)>> = Mutex::new(None);

/// Every project folder under `<home>/projects/` with the mode `fm-project-mode.sh` gives it, by name; kept 300 s.
pub(crate) fn project_modes(home: &Path, now: i64) -> Vec<ProjectMode> {
    if let Some((h, at, modes)) = MODES.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
        if h == home && now - at < MODES_MS {
            return modes.clone();
        }
    }
    let modes: Vec<ProjectMode> = project_names(home)
        .into_iter()
        .filter_map(|name| {
            let ran = firstmate::project_mode(home, &name).ok().filter(|r| r.ok())?;
            let (mode, yolo) = parse_mode(&ran.stdout)?;
            Some(ProjectMode { name, mode, yolo })
        })
        .collect();
    *MODES.lock().unwrap_or_else(|p| p.into_inner()) = Some((home.to_path_buf(), now, modes.clone()));
    modes
}

/// "Refresh readings": the next `project_modes` asks again.
pub(crate) fn clear() {
    *MODES.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

/// The names only — a folder or a link — and only names a project can have (`[A-Za-z0-9._-]`, no leading dot).
fn project_names(home: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(home.join("projects")) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| !n.starts_with('.') && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')))
        .collect();
    names.sort();
    names
}

/// `fm-project-mode.sh`'s answer: `<mode> <yolo>`, yolo `on` or `off`.
fn parse_mode(stdout: &str) -> Option<(String, bool)> {
    let mut words = stdout.split_whitespace();
    let mode = words.next()?.to_string();
    let yolo = match words.next()? {
        "on" => true,
        "off" => false,
        _ => return None,
    };
    Some((mode, yolo))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script(path: &Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn modes_are_parsed_as_the_script_prints_them() {
        assert_eq!(parse_mode("no-mistakes off\n"), Some(("no-mistakes".into(), false)));
        assert_eq!(parse_mode("local-only on"), Some(("local-only".into(), true)));
        assert_eq!(parse_mode("direct-PR"), None);
        assert_eq!(parse_mode("direct-PR maybe"), None);
    }

    #[test]
    fn away_and_modes_come_from_the_scripts() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        script(&home.join("bin/fm-afk-contract.sh"), r#"[ "$1" = field ] || exit 2; case "$2" in entered) echo 2026-09-23T22:10:00Z ;; expected_return) echo - ;; esac"#);
        script(&home.join("bin/fm-project-mode.sh"), r#"case "$1" in shop-9c2e) echo "direct-PR on" ;; *) echo "no-mistakes off" ;; esac"#);
        assert_eq!(away(home), None, "no record, no away line");
        std::fs::create_dir_all(home.join("state")).unwrap();
        std::fs::write(home.join("state/.afk-contract"), "not read by Kinas\n").unwrap();
        assert_eq!(away(home), Some(Away { entered: "2026-09-23T22:10:00Z".into(), expected_return: None }));

        for name in ["shop-9c2e", "api-9c2e", ".hidden", "bad name"] {
            std::fs::create_dir_all(home.join("projects").join(name)).unwrap();
        }
        clear();
        let modes = project_modes(home, 0);
        assert_eq!(
            modes,
            vec![
                ProjectMode { name: "api-9c2e".into(), mode: "no-mistakes".into(), yolo: false },
                ProjectMode { name: "shop-9c2e".into(), mode: "direct-PR".into(), yolo: true },
            ]
        );
        clear();
    }
}
