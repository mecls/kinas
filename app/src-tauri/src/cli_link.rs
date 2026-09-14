//! `~/.local/bin/kinas` → the CLI inside the running `Kinas.app` (PRD R35).
//!
//! Created when missing, repointed when it already points into a (moved) Kinas.app, and otherwise left
//! alone: a regular file or a link to something else is somebody's own `kinas`, and Settings shows the
//! conflict instead of replacing it.

use serde::Serialize;
use std::path::{Path, PathBuf};

const BUNDLE_MARKER: &str = "Kinas.app/Contents/MacOS/";
/// Inside the bundle the CLI is `kinas-cli`, next to the `Kinas` executable: `kinas` and `Kinas` would be the same
/// file on the case-insensitive disk. The link on PATH is still called `kinas`.
const BUNDLED_CLI: &str = "kinas-cli";

/// What happened to the link at launch, for Settings.
pub struct CliLink(pub LinkStatus);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum LinkStatus {
    Linked { target: String },
    Created { target: String },
    Repointed { from: String, target: String },
    Conflict { reason: String },
    /// Running outside a bundle (development): there is no bundled CLI to link.
    NoBundle,
}

/// The CLI next to the app's own executable, when the app runs from a Kinas.app bundle.
pub fn bundled_cli(exe: &Path) -> Option<PathBuf> {
    if !exe.to_string_lossy().contains(BUNDLE_MARKER) {
        return None;
    }
    let cli = exe.parent()?.join(BUNDLED_CLI);
    cli.is_file().then_some(cli)
}

fn in_a_kinas_bundle(path: &Path) -> bool {
    path.to_string_lossy().contains(BUNDLE_MARKER)
}

pub fn ensure_link(home: &Path, target: &Path) -> LinkStatus {
    let bin = home.join(".local/bin");
    let link = bin.join("kinas");
    let target_s = target.display().to_string();
    match std::fs::symlink_metadata(&link) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Err(e) = std::fs::create_dir_all(&bin) {
                return LinkStatus::Conflict { reason: format!("could not create {}: {e}", bin.display()) };
            }
            match std::os::unix::fs::symlink(target, &link) {
                Ok(()) => LinkStatus::Created { target: target_s },
                Err(e) => LinkStatus::Conflict { reason: format!("could not create {}: {e}", link.display()) },
            }
        }
        Err(e) => LinkStatus::Conflict { reason: format!("could not inspect {}: {e}", link.display()) },
        Ok(meta) if meta.file_type().is_symlink() => {
            let current = std::fs::read_link(&link).unwrap_or_default();
            if current == target {
                LinkStatus::Linked { target: target_s }
            } else if in_a_kinas_bundle(&current) {
                let replaced = std::fs::remove_file(&link).and_then(|()| std::os::unix::fs::symlink(target, &link));
                match replaced {
                    Ok(()) => LinkStatus::Repointed { from: current.display().to_string(), target: target_s },
                    Err(e) => LinkStatus::Conflict { reason: format!("could not repoint {}: {e}", link.display()) },
                }
            } else {
                LinkStatus::Conflict { reason: format!("~/.local/bin/kinas points to {} — not replaced", current.display()) }
            }
        }
        Ok(_) => LinkStatus::Conflict { reason: "~/.local/bin/kinas is a regular file — not replaced".into() },
    }
}

/// Run at every launch.
pub fn ensure_for_running_app() -> LinkStatus {
    let Some(target) = std::env::current_exe().ok().and_then(|exe| bundled_cli(&exe)) else {
        return LinkStatus::NoBundle;
    };
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return LinkStatus::Conflict { reason: "HOME is not set".into() };
    };
    ensure_link(&home, &target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_bundle(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name).join("Kinas.app/Contents/MacOS");
        std::fs::create_dir_all(&dir).unwrap();
        let cli = dir.join(BUNDLED_CLI);
        std::fs::write(&cli, "#!/bin/sh\n").unwrap();
        cli
    }

    #[test]
    fn creates_a_missing_link() {
        let home = tempfile::tempdir().unwrap();
        let target = fake_bundle(home.path(), "Applications");
        assert!(matches!(ensure_link(home.path(), &target), LinkStatus::Created { .. }));
        assert_eq!(std::fs::read_link(home.path().join(".local/bin/kinas")).unwrap(), target);
        assert!(matches!(ensure_link(home.path(), &target), LinkStatus::Linked { .. }));
    }

    #[test]
    fn repoints_a_link_into_a_moved_bundle() {
        let home = tempfile::tempdir().unwrap();
        let old = fake_bundle(home.path(), "Downloads");
        let new = fake_bundle(home.path(), "Applications");
        ensure_link(home.path(), &old);
        assert!(matches!(ensure_link(home.path(), &new), LinkStatus::Repointed { .. }));
        assert_eq!(std::fs::read_link(home.path().join(".local/bin/kinas")).unwrap(), new);
    }

    #[test]
    fn never_replaces_a_regular_file_or_a_foreign_link() {
        let home = tempfile::tempdir().unwrap();
        let target = fake_bundle(home.path(), "Applications");
        let bin = home.path().join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();

        std::fs::write(bin.join("kinas"), "my own script").unwrap();
        assert_eq!(ensure_link(home.path(), &target), LinkStatus::Conflict { reason: "~/.local/bin/kinas is a regular file — not replaced".into() });
        assert_eq!(std::fs::read_to_string(bin.join("kinas")).unwrap(), "my own script");

        std::fs::remove_file(bin.join("kinas")).unwrap();
        std::os::unix::fs::symlink("/usr/local/bin/something-else", bin.join("kinas")).unwrap();
        assert!(matches!(ensure_link(home.path(), &target), LinkStatus::Conflict { .. }));
        assert_eq!(std::fs::read_link(bin.join("kinas")).unwrap(), PathBuf::from("/usr/local/bin/something-else"));
    }

    #[test]
    fn only_a_bundled_executable_has_a_cli_to_link() {
        let root = tempfile::tempdir().unwrap();
        let cli = fake_bundle(root.path(), "Applications");
        let exe = cli.with_file_name("Kinas");
        assert_eq!(bundled_cli(&exe), Some(cli));
        assert_eq!(bundled_cli(Path::new("/x/target/debug/Kinas")), None);
    }
}
