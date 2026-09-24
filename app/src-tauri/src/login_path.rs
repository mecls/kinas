//! The login shell's `PATH`, for every crew process (build spec §6.9). An app started by launchd inherits a bare
//! `PATH` without Homebrew or `~/.local/bin`, where `herdr`, `gh`, `jq` and the crew's tools live, so Firstmate's
//! scripts would fail on their first `command -v`. The login shell is asked once per run, as the terminal pane's own
//! shell would be (`pty::login_shell`), and a shell that does not answer within 5 s leaves the fallback.

use crate::proc::{self, Exit, Run};
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

const PROBE_LIMIT: Duration = Duration::from_secs(5);

/// Where Kinas's crew looks when the login shell does not say; `~` is the home folder.
pub(crate) const FALLBACK_PATH: &str = "~/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

static LOGIN_PATH: OnceLock<String> = OnceLock::new();

pub(crate) fn login_path() -> &'static str {
    LOGIN_PATH.get_or_init(|| probe().unwrap_or_else(|| expand(FALLBACK_PATH, &home())))
}

fn probe() -> Option<String> {
    let shell = crate::pty::login_shell();
    let ran = proc::run(&Run {
        program: Path::new(&shell),
        args: &["-l", "-c", "printf %s \"$PATH\""],
        cwd: Some(&home()),
        set: &[],
        limit: PROBE_LIMIT,
    })
    .ok()?;
    accepted(ran.exit, &ran.stdout)
}

/// A `PATH` is taken only from a clean exit, and only when it is one line of absolute folders — a profile that
/// prints a banner would otherwise become the crew's `PATH`.
fn accepted(exit: Exit, stdout: &str) -> Option<String> {
    let path = stdout.trim();
    let ok = exit == Exit::Code(0) && !path.is_empty() && !path.contains('\n') && path.split(':').filter(|d| !d.is_empty()).all(|d| d.starts_with('/'));
    ok.then(|| path.to_string())
}

fn home() -> std::path::PathBuf {
    std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_else(|| "/".into())
}

fn expand(path: &str, home: &Path) -> String {
    path.split(':').map(|d| d.strip_prefix("~/").map(|rest| home.join(rest).display().to_string()).unwrap_or_else(|| d.to_string())).collect::<Vec<_>>().join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_clean_single_line_of_absolute_folders_is_taken() {
        assert_eq!(accepted(Exit::Code(0), "/opt/homebrew/bin:/usr/bin:/bin"), Some("/opt/homebrew/bin:/usr/bin:/bin".into()));
        assert_eq!(accepted(Exit::Code(0), "  /usr/bin::/bin\n"), Some("/usr/bin::/bin".into()));
        assert_eq!(accepted(Exit::Code(1), "/usr/bin"), None);
        assert_eq!(accepted(Exit::TimedOut, "/usr/bin"), None);
        assert_eq!(accepted(Exit::Code(0), ""), None);
        assert_eq!(accepted(Exit::Code(0), "Welcome back!\n/usr/bin"), None);
        assert_eq!(accepted(Exit::Code(0), "relative/bin:/usr/bin"), None);
    }

    #[test]
    fn the_fallback_expands_the_home_folder() {
        assert_eq!(expand(FALLBACK_PATH, Path::new("/Users/someone")), "/Users/someone/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    }

    #[test]
    fn the_login_path_is_absolute_folders() {
        let path = login_path();
        assert!(!path.is_empty());
        assert!(path.split(':').filter(|d| !d.is_empty()).all(|d| d.starts_with('/')), "{path}");
    }
}
