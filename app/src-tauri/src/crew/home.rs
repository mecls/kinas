//! Where Firstmate's home is, whether it is installed, where its clone stands, and its backend. The home is Kinas's own
//! clone under its data directory (ADR 0016) — never `FM_HOME` from the environment, never the captain's other clone —
//! and it is not a project: `access::permitted` refuses it because it sits outside the projects folder (§6.17).

use super::pin::{FIRSTMATE_PIN, HOME_DIR};
use crate::login_path::login_path;
use crate::proc::{self, Run};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

const GIT_LIMIT: Duration = Duration::from_secs(3);

/// `<data dir>/firstmate`.
pub(crate) fn home_in(data_dir: &Path) -> PathBuf {
    data_dir.join(HOME_DIR)
}

/// Installed means the snapshot script is there: `kinas crew setup` clones the pin, and nothing else puts it there.
pub(crate) fn installed(home: &Path) -> bool {
    super::firstmate::snapshot_script(home).is_file()
}

/// Where the clone stands (§4 Settings): at the pin, moved on (Firstmate's `/updatefirstmate` moves `main`), on another
/// branch (a tangle for the first mate to sort out), or not a clone at all.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PinState {
    Pinned { short: String },
    Moved { short: String, from: String },
    Tangle { branch: String },
    Missing,
}

pub(crate) fn pin_state(home: &Path) -> PinState {
    if !home.join(".git").exists() {
        return PinState::Missing;
    }
    let Some(head) = git(home, &["rev-parse", "HEAD"]) else { return PinState::Missing };
    let branch = git(home, &["symbolic-ref", "--short", "-q", "HEAD"]);
    classify(&head, branch.as_deref())
}

fn classify(head: &str, branch: Option<&str>) -> PinState {
    let short = |sha: &str| sha.chars().take(7).collect::<String>();
    match branch {
        Some(b) if b != "main" => PinState::Tangle { branch: b.to_string() },
        _ if head == FIRSTMATE_PIN => PinState::Pinned { short: short(head) },
        _ => PinState::Moved { short: short(head), from: short(FIRSTMATE_PIN) },
    }
}

/// `git -C <home> <args>` with the login `PATH`, 3 s; its first line of output, or None.
fn git(home: &Path, args: &[&str]) -> Option<String> {
    let home_text = home.to_string_lossy();
    let mut argv = vec!["-C", &home_text];
    argv.extend_from_slice(args);
    let ran = proc::run(&Run { program: Path::new("git"), args: &argv, cwd: None, set: &[("PATH", login_path())], limit: GIT_LIMIT }).ok()?;
    ran.ok().then(|| ran.stdout.lines().next().unwrap_or("").trim().to_string()).filter(|l| !l.is_empty())
}

/// `config/backend`'s first non-empty line: the one file under the home Kinas writes (`kinas crew setup`), read back.
pub(crate) fn backend(home: &Path) -> Option<String> {
    let text = std::fs::read_to_string(home.join("config/backend")).ok()?;
    text.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_is_the_snapshot_script() {
        let dir = tempfile::tempdir().unwrap();
        let home = home_in(dir.path());
        assert_eq!(home, dir.path().join("firstmate"));
        assert!(!installed(&home));
        std::fs::create_dir_all(home.join("bin")).unwrap();
        assert!(!installed(&home));
        std::fs::write(home.join("bin/fm-fleet-snapshot.sh"), "#!/bin/sh\n").unwrap();
        assert!(installed(&home));
    }

    #[test]
    fn the_pin_is_pinned_moved_or_a_tangle() {
        assert_eq!(classify(FIRSTMATE_PIN, Some("main")), PinState::Pinned { short: "f9f74a1".into() });
        assert_eq!(classify(FIRSTMATE_PIN, None), PinState::Pinned { short: "f9f74a1".into() }, "detached at the pin");
        assert_eq!(classify("9296f9b000", Some("main")), PinState::Moved { short: "9296f9b".into(), from: "f9f74a1".into() });
        assert_eq!(classify(FIRSTMATE_PIN, Some("fix-9c2e")), PinState::Tangle { branch: "fix-9c2e".into() });
        assert_eq!(pin_state(Path::new("/nonexistent/kinas-home")), PinState::Missing);
    }

    #[test]
    fn a_real_clone_reads_its_head_and_branch() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let git = |args: &[&str]| {
            let ok = std::process::Command::new("git")
                .arg("-C")
                .arg(home)
                .args(["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false"])
                .args(args)
                .output()
                .unwrap()
                .status
                .success();
            assert!(ok, "git {args:?}");
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["commit", "-q", "--allow-empty", "-m", "x"]);
        match pin_state(home) {
            PinState::Moved { short, from } => assert_eq!((short.len(), from.as_str()), (7, "f9f74a1")),
            other => panic!("{other:?}"),
        }
        git(&["checkout", "-q", "-b", "side-9c2e"]);
        assert_eq!(pin_state(home), PinState::Tangle { branch: "side-9c2e".into() });
    }

    #[test]
    fn the_backend_is_the_first_non_empty_line() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(backend(dir.path()), None);
        std::fs::create_dir_all(dir.path().join("config")).unwrap();
        std::fs::write(dir.path().join("config/backend"), "\n  herdr \nx\n").unwrap();
        assert_eq!(backend(dir.path()).as_deref(), Some("herdr"));
    }
}
