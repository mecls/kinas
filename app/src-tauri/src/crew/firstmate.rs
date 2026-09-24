//! The only file that builds a path under `<home>/bin/`, and the only runner of Firstmate's scripts (ADR 0016, build
//! spec §6.3): `fm-fleet-snapshot.sh --json`, `fm-afk-contract.sh field <name>` and `fm-project-mode.sh <name>`, all
//! three read-only. Nothing that changes anything — not `fm-send.sh`, not any hold, spawn or teardown script — is ever
//! run from Kinas. Each runs through `proc::run`: `bash` from the login shell's `PATH`, `FM_HOME` set to the home, no
//! inherited `HERDR*`, null stdin, its process group killed at the limit.

use crate::login_path::login_path;
use crate::proc::{self, Ran, Run};
use std::path::Path;
use std::time::Duration;

const SNAPSHOT_LIMIT: Duration = Duration::from_secs(20);
const SETTINGS_LIMIT: Duration = Duration::from_secs(3);

/// `bash <home>/bin/fm-fleet-snapshot.sh --json`, 20 s. `Err` only when `bash` could not be started.
pub(crate) fn fleet_snapshot(home: &Path) -> Result<Ran, String> {
    script(home, "fm-fleet-snapshot.sh", &["--json"], SNAPSHOT_LIMIT)
}

/// `bash <home>/bin/fm-afk-contract.sh field <name>`, 3 s: one field of the away record (`entered`,
/// `expected_return`). Never `--proposal`, never the record's words.
pub(crate) fn afk_field(home: &Path, name: &str) -> Result<Ran, String> {
    script(home, "fm-afk-contract.sh", &["field", name], SETTINGS_LIMIT)
}

/// `bash <home>/bin/fm-project-mode.sh <name>`, 3 s: `<mode> <yolo>` as the captain registered the project.
pub(crate) fn project_mode(home: &Path, name: &str) -> Result<Ran, String> {
    script(home, "fm-project-mode.sh", &[name], SETTINGS_LIMIT)
}

fn script(home: &Path, name: &str, args: &[&str], limit: Duration) -> Result<Ran, String> {
    let path = home.join("bin").join(name);
    let path = path.to_string_lossy();
    let home_text = home.to_string_lossy();
    let mut argv = vec![path.as_ref()];
    argv.extend_from_slice(args);
    proc::run(&Run { program: Path::new("bash"), args: &argv, cwd: Some(home), set: &[("PATH", login_path()), ("FM_HOME", &home_text)], limit })
}
