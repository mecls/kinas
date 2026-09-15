//! The reader (`kinas open`, reader PRD): what it keeps for this session and the door the CLI uses. Everything here
//! lives in memory and is gone when Kinas quits; the only thing stored is the `reader_editor` setting.

pub mod access;
pub mod socket;

use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

/// `kinas open` with no path reopens the most recent of these (R38).
pub const RECENT_CAP: usize = 20;

#[derive(Default)]
pub struct Inner {
    /// Real file paths opened this session, most recent first.
    pub recent: VecDeque<PathBuf>,
    /// Real paths Miguel allowed by a click: a confirmation card or a link (R7, R8). Only ever grows.
    pub allowed: HashSet<PathBuf>,
    /// The one `--anywhere` request waiting for Open or Dismiss.
    pub pending_confirm: Option<PathBuf>,
    /// The watch on the open file's folder (R29).
    pub watcher: Option<notify::RecommendedWatcher>,
    /// The socket this instance bound, so quitting removes only its own (R16).
    pub socket: Option<PathBuf>,
}

impl Inner {
    pub fn remember(&mut self, path: PathBuf) {
        self.recent.retain(|p| p != &path);
        self.recent.push_front(path);
        self.recent.truncate(RECENT_CAP);
    }
}

#[derive(Default)]
pub struct ReaderState(Mutex<Inner>);

impl ReaderState {
    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_keeps_twenty_most_recent_first_without_repeats() {
        let mut inner = Inner::default();
        for i in 0..25 {
            inner.remember(PathBuf::from(format!("/r/{i}.md")));
        }
        inner.remember(PathBuf::from("/r/10.md"));
        assert_eq!(inner.recent.len(), RECENT_CAP);
        assert_eq!(inner.recent.front(), Some(&PathBuf::from("/r/10.md")));
        assert_eq!(inner.recent.iter().filter(|p| p.ends_with("10.md")).count(), 1);
        assert_eq!(inner.recent.get(1), Some(&PathBuf::from("/r/24.md")));
    }
}
