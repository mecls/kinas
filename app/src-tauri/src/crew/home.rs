//! Where Firstmate's home is, and whether it is installed. The home is Kinas's own clone under its data directory
//! (ADR 0016) — never `FM_HOME` from the environment, never the captain's other clone — and it is not a project:
//! `access::permitted` refuses it because it sits outside the projects folder (§6.17).

use std::path::{Path, PathBuf};

/// `<data dir>/firstmate`.
pub(crate) fn home_in(data_dir: &Path) -> PathBuf {
    data_dir.join(super::pin::HOME_DIR)
}

/// Installed means the snapshot script is there: `kinas crew setup` clones the pin, and nothing else puts it there.
pub(crate) fn installed(home: &Path) -> bool {
    home.join("bin/fm-fleet-snapshot.sh").is_file()
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
}
