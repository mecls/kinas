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

/// `bash <home>/bin/fm-fleet-snapshot.sh --json`, 20 s. `Err` only when `bash` could not be started.
pub(crate) fn fleet_snapshot(home: &Path) -> Result<Ran, String> {
    let script = home.join("bin").join("fm-fleet-snapshot.sh");
    let script = script.to_string_lossy();
    let home_text = home.to_string_lossy();
    proc::run(&Run {
        program: Path::new("bash"),
        args: &[&script, "--json"],
        cwd: Some(home),
        set: &[("PATH", login_path()), ("FM_HOME", &home_text)],
        limit: SNAPSHOT_LIMIT,
    })
}
