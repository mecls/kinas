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
        if h == home && fresh(*at, now) {
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

/// Whether modes read at `at` still count at `now`: a gap, not a moment to reach again — a stamp in what is now the
/// future (the wall clock stepped back) is not a fresh one.
fn fresh(at: i64, now: i64) -> bool {
    (0..MODES_MS).contains(&(now - at))
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

/// What `config/lane-capacity` asks for (Firstmate, current; ADR 0020): the gate in front of `fm-capacity.sh --json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LaneConfig {
    /// No file, or not a regular file: no cap set.
    Absent,
    Cap(u32),
    Auto,
    /// A `quota-provider` line: the script would run `quota-axi`, which Kinas never runs.
    Quota,
    /// A first line that is neither a cap nor `auto`.
    Invalid,
}

/// `config/lane-capacity`, read as Firstmate reads it (`bin/fm-capacity.sh` `parse_lane_config`): a regular file under
/// 1 MiB, `#` comments stripped, tabs and carriage returns as spaces; the first non-empty line is a cap of at most nine
/// digits or `auto`; any later line whose first word is `quota-provider` makes it Quota. Nothing else is read of it.
pub(crate) fn lane_config(home: &Path) -> LaneConfig {
    // Not there, not a regular file (a FIFO is never opened), or too large to be one: no cap set.
    match crate::reader::access::read_regular(&home.join("config").join("lane-capacity"), crate::reader::access::SMALL_FILE_BYTES) {
        Ok(text) => lane_config_of(&text),
        Err(_) => LaneConfig::Absent,
    }
}

fn lane_config_of(text: &str) -> LaneConfig {
    let mut lines = text.lines().map(|l| l.split('#').next().unwrap_or("").replace(['\t', '\r'], " ").trim().to_string()).filter(|l| !l.is_empty());
    let Some(first) = lines.next() else { return LaneConfig::Invalid };
    let head = if first == "auto" {
        LaneConfig::Auto
    } else if first.len() <= 9 && first.bytes().all(|b| b.is_ascii_digit()) {
        first.parse().map(LaneConfig::Cap).unwrap_or(LaneConfig::Invalid)
    } else {
        return LaneConfig::Invalid;
    };
    if lines.any(|l| l.split(' ').next() == Some("quota-provider")) {
        LaneConfig::Quota
    } else {
        head
    }
}

/// Lane capacity as Settings → Crew says it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum LaneOption {
    Off,
    Cap { cap: u32 },
    Auto,
    ChecksQuota,
    Invalid,
}

/// Firstmate's options the captain turns on in the first mate's chat (PRD rule 5): Kinas only says which are on.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FirstmateOptions {
    pub park_on_review: bool,
    pub fleet_ledger: bool,
    pub lane_capacity: LaneOption,
}

/// Whether each option's file exists (`config/park-on-review`, `config/fleet-ledger`: presence flags), and the lane
/// gate; `invalid` too when the last lane reading said the cap is invalid.
pub(crate) fn options(home: &Path, last_status: Option<&str>) -> FirstmateOptions {
    let flag = |name: &str| home.join("config").join(name).is_file();
    let lane_capacity = match lane_config(home) {
        LaneConfig::Absent => LaneOption::Off,
        LaneConfig::Quota => LaneOption::ChecksQuota,
        LaneConfig::Invalid => LaneOption::Invalid,
        _ if last_status == Some("invalid") => LaneOption::Invalid,
        LaneConfig::Cap(cap) => LaneOption::Cap { cap },
        LaneConfig::Auto => LaneOption::Auto,
    };
    FirstmateOptions { park_on_review: flag("park-on-review"), fleet_ledger: flag("fleet-ledger"), lane_capacity }
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

    /// As the tools' cache: a reading stamped in what is now the future (the clock stepped back) is not a fresh one.
    #[test]
    fn modes_stamped_in_the_future_are_not_fresh() {
        let now = 1_790_000_000_000;
        assert!(fresh(now, now));
        assert!(fresh(now - MODES_MS + 1, now));
        assert!(!fresh(now - MODES_MS, now));
        assert!(!fresh(now + 2 * 60 * 60_000, now), "after a step back");
    }

    /// Firstmate, current (build spec §11.4): the gate reads one key, as Firstmate's own parser would.
    #[test]
    fn lane_config_cases() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        std::fs::create_dir_all(home.join("config")).unwrap();
        let file = home.join("config/lane-capacity");
        assert_eq!(lane_config(home), LaneConfig::Absent);
        for (text, want) in [
            ("4\n", LaneConfig::Cap(4)),
            ("auto\n", LaneConfig::Auto),
            ("4\nquota-provider claude\n", LaneConfig::Quota),
            ("4 # cap\n  quota-provider x # c\n", LaneConfig::Quota),
            ("# a note first\n\n12\nmin-avail-gb 5\n", LaneConfig::Cap(12)),
            ("4\n# quota-provider claude\n", LaneConfig::Cap(4)),
            ("4\nquota-providers x\n", LaneConfig::Cap(4)),
            ("abc\n", LaneConfig::Invalid),
            ("1234567890\n", LaneConfig::Invalid),
            ("", LaneConfig::Invalid),
        ] {
            std::fs::write(&file, text).unwrap();
            assert_eq!(lane_config(home), want, "{text:?}");
        }
        std::fs::remove_file(&file).unwrap();
        // A FIFO is never opened: no cap set.
        let made = std::process::Command::new("/usr/bin/mkfifo").arg(&file).status().unwrap();
        assert!(made.success());
        assert_eq!(lane_config(home), LaneConfig::Absent);
    }

    #[test]
    fn options_say_which_are_on() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        std::fs::create_dir_all(home.join("config")).unwrap();
        assert_eq!(options(home, None), FirstmateOptions { park_on_review: false, fleet_ledger: false, lane_capacity: LaneOption::Off });
        std::fs::write(home.join("config/park-on-review"), "").unwrap();
        std::fs::write(home.join("config/fleet-ledger"), "").unwrap();
        std::fs::write(home.join("config/lane-capacity"), "4\n").unwrap();
        assert_eq!(options(home, None), FirstmateOptions { park_on_review: true, fleet_ledger: true, lane_capacity: LaneOption::Cap { cap: 4 } });
        assert_eq!(options(home, Some("invalid")).lane_capacity, LaneOption::Invalid, "the script said the file is invalid");
        std::fs::write(home.join("config/lane-capacity"), "auto\nquota-provider claude\n").unwrap();
        assert_eq!(options(home, None).lane_capacity, LaneOption::ChecksQuota);
        assert_eq!(serde_json::to_value(LaneOption::ChecksQuota).unwrap(), serde_json::json!({ "state": "checks-quota" }));
        assert_eq!(serde_json::to_value(LaneOption::Cap { cap: 4 }).unwrap(), serde_json::json!({ "state": "cap", "cap": 4 }));
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
