//! The baseline (rule 20): how a root looked when its tree was first shown. A stat walk first — `read_dir` and
//! `symlink_metadata`, no reads — then a copy of every listed text file, breadth first, until the window's budget runs
//! out. A file left without a copy keeps its reason, which its Changes view will say (rule 23).
//!
//! Slice 2 copies every text file; slice 3 lets git answer for the files that match HEAD.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use super::Millis;
use crate::reader::access::{self, Kind};
use crate::reader::{listable_file, listable_name};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stat {
    pub kind: Kind,
    pub size: u64,
    pub mtime_ms: Millis,
}

impl Stat {
    /// A path as it is now, without following a symlink: a link is not an entry of the tree's own (rule 6).
    pub fn of(path: &Path) -> Option<Stat> {
        let meta = std::fs::symlink_metadata(path).ok()?;
        let kind = if meta.is_dir() {
            Kind::Dir
        } else if meta.is_file() {
            Kind::File
        } else {
            return None;
        };
        let mtime_ms = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
        Some(Stat { kind, size: meta.len(), mtime_ms })
    }
}

/// Why a listed file has no copy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoCopy {
    /// The window's budget was spent before this file's turn.
    Budget,
    /// Over `MAX_TEXT_BYTES`, the reader's own ceiling.
    TooLarge,
    /// It changed between the watch starting and its copy being taken, so no copy could be trusted.
    ChangedDuringCopy,
    /// It could not be read.
    Unreadable,
    /// No copy of an image is kept.
    Image,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BaseText {
    Copy(Arc<[u8]>),
    /// Not something the tree lists: a binary. A folder carries this too; it has no text.
    NotText,
    NoCopy(NoCopy),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BaseEntry {
    pub stat: Stat,
    pub text: BaseText,
}

impl BaseEntry {
    /// Whether the tree listed it at the baseline (rule 5): every folder, and every file but a binary.
    pub fn listed(&self) -> bool {
        self.stat.kind == Kind::Dir || self.text != BaseText::NotText
    }
}

#[derive(Debug, Default)]
pub struct Baseline {
    /// Ordered, so everything beneath a folder is one range.
    pub entries: BTreeMap<PathBuf, BaseEntry>,
    pub copy_bytes: u64,
    /// The copies in the order they were taken, breadth first, so a trim drops the deepest first.
    copied: Vec<PathBuf>,
}

impl Baseline {
    /// The entries beneath `dir`, not `dir` itself.
    pub fn beneath<'a>(&'a self, dir: &'a Path) -> impl Iterator<Item = (&'a PathBuf, &'a BaseEntry)> + 'a {
        self.entries.range(dir.to_path_buf()..).skip_while(move |(p, _)| p.as_path() == dir).take_while(move |(p, _)| p.starts_with(dir))
    }

    /// Drops copies, deepest first, until what is kept fits `left`: two roots taking their baselines at once each
    /// started from the same budget, and the one installed second gives back what no longer fits.
    pub fn trim_to(&mut self, left: u64) {
        while self.copy_bytes > left {
            let Some(path) = self.copied.pop() else { break };
            if let Some(entry) = self.entries.get_mut(&path) {
                if let BaseText::Copy(bytes) = &entry.text {
                    self.copy_bytes -= bytes.len() as u64;
                    entry.text = BaseText::NoCopy(NoCopy::Budget);
                }
            }
        }
    }
}

/// Every listable path beneath `root`, breadth first, with its kind, size and modification time. No file is read and
/// no symlink followed. A folder that cannot be read is listed with nothing beneath it.
pub fn walk(root: &Path) -> Vec<(PathBuf, Stat)> {
    let mut walked = Vec::new();
    let mut folders = VecDeque::from([root.to_path_buf()]);
    while let Some(dir) = folders.pop_front() {
        let Ok(read) = std::fs::read_dir(&dir) else { continue };
        let mut here: Vec<(PathBuf, Stat)> = read
            .flatten()
            .filter(|entry| listable_name(&entry.file_name().to_string_lossy()))
            .filter_map(|entry| Stat::of(&entry.path()).map(|stat| (entry.path(), stat)))
            .collect();
        // A stable order, so the budget falls on the same files every time.
        here.sort_by(|a, b| a.0.cmp(&b.0));
        for (path, stat) in here {
            if stat.kind == Kind::Dir {
                folders.push_back(path.clone());
            }
            walked.push((path, stat));
        }
    }
    walked
}

/// The walk, then a copy of every listed text file that fits in `budget_left`, breadth first. `changed` says whether
/// a path had an event since the watch started: such a file gets no copy, because the copy might already hold the
/// change.
pub fn take(root: &Path, budget_left: u64, changed: &dyn Fn(&Path) -> bool) -> Baseline {
    let mut baseline = Baseline::default();
    for (path, stat) in walk(root) {
        let text = if stat.kind == Kind::Dir {
            BaseText::NotText
        } else {
            copy(&path, stat, budget_left.saturating_sub(baseline.copy_bytes), changed)
        };
        if let BaseText::Copy(bytes) = &text {
            baseline.copy_bytes += bytes.len() as u64;
            baseline.copied.push(path.clone());
        }
        baseline.entries.insert(path, BaseEntry { stat, text });
    }
    baseline
}

fn copy(path: &Path, stat: Stat, left: u64, changed: &dyn Fn(&Path) -> bool) -> BaseText {
    // Only the head is read to tell a binary from a text file the budget leaves out, as the tree's own filter does.
    let unless_binary = |reason| if listable_file(path) { BaseText::NoCopy(reason) } else { BaseText::NotText };
    if access::is_image(path) {
        return BaseText::NoCopy(NoCopy::Image);
    }
    if stat.size > access::MAX_TEXT_BYTES {
        return unless_binary(NoCopy::TooLarge);
    }
    if stat.size > left {
        return unless_binary(NoCopy::Budget);
    }
    let Ok(bytes) = std::fs::read(path) else {
        return BaseText::NoCopy(NoCopy::Unreadable);
    };
    if access::sniff(&bytes[..bytes.len().min(access::SNIFF_BYTES)]) != access::Content::Text {
        return BaseText::NotText;
    }
    // Written since the walk looked, or named by an event: the bytes may already be the change.
    if Stat::of(path) != Some(stat) || bytes.len() as u64 != stat.size || changed(path) {
        return BaseText::NoCopy(NoCopy::ChangedDuringCopy);
    }
    BaseText::Copy(bytes.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(files: &[(&str, &[u8])]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for (name, bytes) in files {
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        (dir, root)
    }

    const NOTHING_CHANGED: &dyn Fn(&Path) -> bool = &|_| false;

    #[test]
    fn the_walk_is_breadth_first_and_lists_only_what_the_tree_would() {
        let (_dir, root) = tree(&[("b.md", b"b"), ("a/deep/c.md", b"c"), ("a/z.md", b"z"), (".git/HEAD", b"ref"), ("node_modules/x.md", b"x"), (".env", b"KEY=1")]);
        let walked: Vec<String> = walk(&root).into_iter().map(|(p, _)| p.strip_prefix(&root).unwrap().display().to_string()).collect();
        assert_eq!(walked, ["a", "b.md", "a/deep", "a/z.md", "a/deep/c.md"]);
    }

    #[test]
    fn symlinks_are_not_followed() {
        let (_outside_dir, outside) = tree(&[("secret.md", b"# outside")]);
        let (_dir, root) = tree(&[("in.md", b"# in")]);
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.md"), root.join("link.md")).unwrap();
        let walked: Vec<PathBuf> = walk(&root).into_iter().map(|(p, _)| p).collect();
        assert_eq!(walked, [root.join("in.md")]);
    }

    #[test]
    fn every_listed_text_file_is_copied_outside_git() {
        let (_dir, root) = tree(&[("README.md", b"# Read me\n"), ("docs/old.md", b"# Old\n"), ("photo.png", b"\x89PNG"), ("blob.bin", b"\x00\x01\x02")]);
        let baseline = take(&root, 1024, NOTHING_CHANGED);
        let text = |name: &str| baseline.entries[&root.join(name)].text.clone();
        assert_eq!(text("README.md"), BaseText::Copy(Arc::from(&b"# Read me\n"[..])));
        assert_eq!(text("docs/old.md"), BaseText::Copy(Arc::from(&b"# Old\n"[..])));
        assert_eq!(text("docs"), BaseText::NotText);
        assert_eq!(text("photo.png"), BaseText::NoCopy(NoCopy::Image));
        assert_eq!(text("blob.bin"), BaseText::NotText);
        assert!(!baseline.entries[&root.join("blob.bin")].listed());
        assert_eq!(baseline.copy_bytes, 16);
    }

    #[test]
    fn the_budget_stops_copies_breadth_first() {
        let shallow = vec![b'a'; 600];
        let deep = vec![b'b'; 600];
        let (_dir, root) = tree(&[("z-shallow.md", &shallow), ("a/deep.md", &deep)]);
        let baseline = take(&root, 1024, NOTHING_CHANGED);
        // The deeper file sorts first by name, but the shallow one's turn comes first.
        assert!(matches!(baseline.entries[&root.join("z-shallow.md")].text, BaseText::Copy(_)));
        assert_eq!(baseline.entries[&root.join("a/deep.md")].text, BaseText::NoCopy(NoCopy::Budget));
        assert_eq!(baseline.copy_bytes, 600);
    }

    #[test]
    fn a_file_over_4_mb_is_not_copied() {
        let big = vec![b'a'; (access::MAX_TEXT_BYTES + 1) as usize];
        let (_dir, root) = tree(&[("big.md", &big)]);
        let baseline = take(&root, 64 * 1024 * 1024, NOTHING_CHANGED);
        assert_eq!(baseline.entries[&root.join("big.md")].text, BaseText::NoCopy(NoCopy::TooLarge));
        assert_eq!(baseline.copy_bytes, 0);
    }

    #[test]
    fn a_binary_is_noted_not_copied_even_past_the_budget() {
        let (_dir, root) = tree(&[("a.bin", b"\x00\x01\x02\x03"), ("b.bin", &[0u8; 2048])]);
        let baseline = take(&root, 8, NOTHING_CHANGED);
        assert_eq!(baseline.entries[&root.join("a.bin")].text, BaseText::NotText);
        assert_eq!(baseline.entries[&root.join("b.bin")].text, BaseText::NotText);
    }

    #[test]
    fn a_file_named_by_an_event_before_its_copy_gets_none() {
        let (_dir, root) = tree(&[("busy.md", b"# half written"), ("calm.md", b"# calm")]);
        let busy = root.join("busy.md");
        let baseline = take(&root, 1024, &|p: &Path| p == busy);
        assert_eq!(baseline.entries[&busy].text, BaseText::NoCopy(NoCopy::ChangedDuringCopy));
        assert!(matches!(baseline.entries[&root.join("calm.md")].text, BaseText::Copy(_)));
    }

    #[test]
    fn a_trim_gives_back_the_deepest_copies_first() {
        let (_dir, root) = tree(&[("a.md", &[b'a'; 100]), ("d/b.md", &[b'b'; 100]), ("d/e/c.md", &[b'c'; 100])]);
        let mut baseline = take(&root, 1024, NOTHING_CHANGED);
        assert_eq!(baseline.copy_bytes, 300);
        baseline.trim_to(150);
        assert_eq!(baseline.copy_bytes, 100);
        assert!(matches!(baseline.entries[&root.join("a.md")].text, BaseText::Copy(_)));
        assert_eq!(baseline.entries[&root.join("d/b.md")].text, BaseText::NoCopy(NoCopy::Budget));
        assert_eq!(baseline.entries[&root.join("d/e/c.md")].text, BaseText::NoCopy(NoCopy::Budget));
    }

    #[test]
    fn beneath_is_everything_under_a_folder_and_nothing_beside_it() {
        let (_dir, root) = tree(&[("docs/a.md", b"a"), ("docs/sub/b.md", b"b"), ("docs-old.md", b"c"), ("docsx/d.md", b"d")]);
        let baseline = take(&root, 1024, NOTHING_CHANGED);
        let docs = root.join("docs");
        let under: Vec<&PathBuf> = baseline.beneath(&docs).map(|(p, _)| p).collect();
        assert_eq!(under, [&docs.join("a.md"), &docs.join("sub"), &docs.join("sub/b.md")]);
    }
}
