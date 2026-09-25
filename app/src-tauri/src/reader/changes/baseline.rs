//! The baseline (rule 20): how a root looked when its tree was first shown. A stat walk first — `read_dir` and
//! `symlink_metadata`, no reads — then git, per repository: a file that matches HEAD is not copied, because HEAD's blob
//! is its text. Then a copy of every other listed text file, breadth first, until the window's budget runs out. A file
//! left without a copy keeps its reason, which its Changes view will say (rule 23).

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, UNIX_EPOCH};

use super::git::Git;
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

/// A repository's HEAD at the baseline, shared by every file it vouches for.
#[derive(Debug, PartialEq, Eq)]
pub struct Head {
    /// The repository's top: the root's own (which may be above the root), or a folder beneath it holding a `.git`.
    pub repo: PathBuf,
    pub commit: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BaseText {
    Copy(Arc<[u8]>),
    /// It matched HEAD: its text is the blob, read from git when it is needed. Never read at the baseline, so whether
    /// it is a binary is judged when it changes (rule 5, Gate 2).
    Blob { head: Arc<Head>, blob: String },
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

/// A repository reaching into a root: its top (a worktree's own folder, for a worktree) and the git folder every
/// worktree of it shares, where the refs a push moves live (tree changes clear on push, architecture 4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepoAt {
    pub top: PathBuf,
    pub common: PathBuf,
}

/// What one path's baseline becomes once it is found on its branch's remote, or can never be pushed (tree changes
/// clear on push, architecture 3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rebase {
    /// On the upstream: its text is the upstream's blob, read from git when it is needed; no copy is kept.
    Pushed { head: Arc<Head>, blob: String, stat: Stat },
    /// Gone here and at the upstream: the entry and everything beneath it removed — the moment kept, as a tombstone.
    Gone,
    /// Can't be pushed (↻): the text now is the starting point — a copy, or the reason there is none.
    Kept { stat: Stat, text: BaseText },
    /// An added folder the upstream holds: its own entry. What is inside is judged path by path.
    Folder { stat: Stat },
}

/// Cloned, never edited in place once installed: the root's thread rebaselines a copy and installs it whole, so a diff
/// reading the old one meanwhile reads a baseline that was true (architecture 3). The clone shares every copy's bytes.
#[derive(Clone, Debug, Default)]
pub struct Baseline {
    /// Ordered, so everything beneath a folder is one range.
    pub entries: BTreeMap<PathBuf, BaseEntry>,
    pub copy_bytes: u64,
    /// The copies in the order they were taken, breadth first, so a trim drops the deepest first.
    copied: Vec<PathBuf>,
    /// Every repository reaching into the root, deepest first, so a path asks the nearest.
    pub repos: Vec<RepoAt>,
    /// When each rebaseline happened, for a path or a folder — a removed path's moment too, as a tombstone — so a
    /// mark says since when it counts (PRD rule 12, Gate 2).
    pub since: BTreeMap<PathBuf, Millis>,
}

impl Baseline {
    /// The entries beneath `dir`, not `dir` itself.
    pub fn beneath<'a>(&'a self, dir: &'a Path) -> impl Iterator<Item = (&'a PathBuf, &'a BaseEntry)> + 'a {
        self.entries.range(dir.to_path_buf()..).skip_while(move |(p, _)| p.as_path() == dir).take_while(move |(p, _)| p.starts_with(dir))
    }

    /// The nearest repository holding `path`, if any.
    pub fn repo_of(&self, path: &Path) -> Option<&RepoAt> {
        self.repos.iter().find(|r| path.starts_with(&r.top))
    }

    /// A path's "since": the latest rebaseline of the path or of a folder above it, else the record's own moment.
    pub fn since_of(&self, path: &Path, record_since: Millis) -> Millis {
        path.ancestors().filter_map(|a| self.since.get(a)).copied().max().unwrap_or(record_since)
    }

    /// Makes `path`'s baseline what `rebase` says, from `now`. Answers the change in copy bytes: negative when copies
    /// are given back, positive when a copy is taken.
    pub fn rebase(&mut self, path: &Path, rebase: Rebase, now: Millis) -> i64 {
        let before = self.copy_bytes;
        match rebase {
            Rebase::Pushed { head, blob, stat } => self.put(path, BaseEntry { stat, text: BaseText::Blob { head, blob } }),
            Rebase::Gone => {
                let gone: Vec<PathBuf> = self.entries.get_key_value(path).map(|(p, _)| p.clone()).into_iter().chain(self.beneath(path).map(|(p, _)| p.clone())).collect();
                for p in gone {
                    self.give_back(&p);
                    self.entries.remove(&p);
                }
            }
            Rebase::Kept { stat, text } => {
                if let BaseText::Copy(bytes) = &text {
                    self.copy_bytes += bytes.len() as u64;
                    self.copied.push(path.to_path_buf());
                }
                self.put(path, BaseEntry { stat, text });
            }
            Rebase::Folder { stat } => self.put(path, BaseEntry { stat, text: BaseText::NotText }),
        }
        self.since.insert(path.to_path_buf(), now);
        self.copy_bytes as i64 - before as i64
    }

    /// Replaces a path's entry, giving back the copy it held.
    fn put(&mut self, path: &Path, entry: BaseEntry) {
        self.give_back(path);
        self.entries.insert(path.to_path_buf(), entry);
    }

    fn give_back(&mut self, path: &Path) {
        if let Some(BaseEntry { text: BaseText::Copy(bytes), .. }) = self.entries.get(path) {
            self.copy_bytes -= bytes.len() as u64;
        }
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

/// A walk that takes longer is logged as slow: a huge folder opened as a root (Gate 2, the risks). Nothing is refused.
pub const SLOW_WALK: Duration = Duration::from_secs(10);

pub struct Walked {
    /// Every listable path, breadth first.
    pub entries: Vec<(PathBuf, Stat)>,
    /// The walked folders holding a `.git` (a folder or, for a worktree or a submodule, a file), the root included.
    pub repo_tops: Vec<PathBuf>,
}

/// Every listable path beneath `root`, breadth first, with its kind, size and modification time. No file is read and
/// no symlink followed. A folder that cannot be read is listed with nothing beneath it.
pub fn walk(root: &Path) -> Walked {
    let mut walked = Walked { entries: Vec::new(), repo_tops: Vec::new() };
    let mut folders = VecDeque::from([root.to_path_buf()]);
    while let Some(dir) = folders.pop_front() {
        let Ok(read) = std::fs::read_dir(&dir) else { continue };
        let mut here = Vec::new();
        for entry in read.flatten() {
            let name = entry.file_name();
            if name == ".git" {
                walked.repo_tops.push(dir.clone());
            }
            if listable_name(&name.to_string_lossy()) {
                if let Some(stat) = Stat::of(&entry.path()) {
                    here.push((entry.path(), stat));
                }
            }
        }
        // A stable order, so the budget falls on the same files every time.
        here.sort_by(|a: &(PathBuf, Stat), b| a.0.cmp(&b.0));
        for (path, stat) in here {
            if stat.kind == Kind::Dir {
                folders.push_back(path.clone());
            }
            walked.entries.push((path, stat));
        }
    }
    walked
}

/// `walk`, timed, for a whole root — the baseline's, and a rescan's. One past `SLOW_WALK` is logged.
pub fn walk_root(root: &Path) -> Walked {
    let started = Instant::now();
    let walked = walk(root);
    if let Some(line) = slow_walk(walked.entries.len(), started.elapsed()) {
        log::warn!("{line}");
    }
    walked
}

/// The slow walk's log line: a count and a duration, never where.
fn slow_walk(entries: usize, took: Duration) -> Option<String> {
    (took > SLOW_WALK).then(|| format!("tree changes: a slow walk, {entries} entries in {} ms", took.as_millis()))
}

/// A repository reaching into the root, with what its HEAD vouches for there.
struct Repo {
    head: Arc<Head>,
    /// The files under the root that match HEAD — tracked, and not dirty — with their blobs. Empty when it has no commit.
    clean: HashMap<PathBuf, String>,
}

/// The root's own repository — whose top may be above the root — and every one the walk found beneath it, deepest
/// first, each with its shared git folder. One git cannot place is left out.
pub fn find_repos(root: &Path, tops: &[PathBuf], git: &Git) -> Vec<RepoAt> {
    let mut all: Vec<PathBuf> = git.toplevel(root).into_iter().chain(tops.iter().cloned()).collect();
    all.sort();
    all.dedup();
    let mut repos: Vec<RepoAt> = all.into_iter().filter_map(|top| Some(RepoAt { common: git.common_dir(&top)?, top })).collect();
    repos.sort_by_key(|r| std::cmp::Reverse(r.top.components().count()));
    repos
}

/// Each repository's HEAD and the files under the root it vouches for, deepest first, so a file asks the nearest. A
/// repository git cannot read is left out, and its files are copied like any others.
fn repositories(root: &Path, found: &[RepoAt], git: &Git) -> Vec<Repo> {
    let mut repos: Vec<Repo> = found
        .iter()
        .map(|r| r.top.clone())
        .filter_map(|top| {
            let head = git.head(&top).ok()?;
            let clean = match &head {
                None => HashMap::new(),
                Some(commit) => {
                    let dirty = git.dirty(&top, commit).ok()?;
                    let mut blobs = git.tree_blobs(&top, commit).ok()?;
                    blobs.retain(|path, _| path.starts_with(root) && !dirty.contains(path));
                    blobs
                }
            };
            Some(Repo { head: Arc::new(Head { repo: top, commit: head.unwrap_or_default() }), clean })
        })
        .collect();
    repos.sort_by_key(|r| std::cmp::Reverse(r.head.repo.components().count()));
    repos
}

/// HEAD's blob for a file its nearest repository vouches for.
fn clean_blob(repos: &[Repo], path: &Path) -> Option<BaseText> {
    let repo = repos.iter().find(|r| path.starts_with(&r.head.repo))?;
    repo.clean.get(path).map(|blob| BaseText::Blob { head: repo.head.clone(), blob: blob.clone() })
}

/// The walk, then git per repository, then a copy of every other listed text file that fits in `budget_left`,
/// breadth first. `changed` says whether a path had an event since the watch started: such a file gets no copy,
/// because the copy might already hold the change. Without `git`, every listed text file is copied.
pub fn take(root: &Path, git: Option<&Git>, budget_left: u64, changed: &dyn Fn(&Path) -> bool) -> Baseline {
    let walked = walk_root(root);
    let found = git.map(|g| find_repos(root, &walked.repo_tops, g)).unwrap_or_default();
    let repos = git.map(|g| repositories(root, &found, g)).unwrap_or_default();
    let mut baseline = Baseline { repos: found, ..Baseline::default() };
    for (path, stat) in walked.entries {
        let text = match stat.kind {
            Kind::Dir => BaseText::NotText,
            // An image is never copied, git or not: it has no Changes view.
            Kind::File => match clean_blob(&repos, &path) {
                Some(blob) if !access::is_image(&path) => blob,
                _ => copy(&path, stat, budget_left.saturating_sub(baseline.copy_bytes), changed),
            },
        };
        if let BaseText::Copy(bytes) = &text {
            baseline.copy_bytes += bytes.len() as u64;
            baseline.copied.push(path.clone());
        }
        baseline.entries.insert(path, BaseEntry { stat, text });
    }
    baseline
}

pub(super) fn copy(path: &Path, stat: Stat, left: u64, changed: &dyn Fn(&Path) -> bool) -> BaseText {
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
        let walked: Vec<String> = walk(&root).entries.into_iter().map(|(p, _)| p.strip_prefix(&root).unwrap().display().to_string()).collect();
        assert_eq!(walked, ["a", "b.md", "a/deep", "a/z.md", "a/deep/c.md"]);
    }

    #[test]
    fn a_walk_over_ten_seconds_is_logged_by_its_count_and_time_alone() {
        assert_eq!(slow_walk(120_000, Duration::from_secs(10)), None);
        assert_eq!(slow_walk(120_000, Duration::from_millis(10_450)).as_deref(), Some("tree changes: a slow walk, 120000 entries in 10450 ms"));
    }

    #[test]
    fn symlinks_are_not_followed() {
        let (_outside_dir, outside) = tree(&[("secret.md", b"# outside")]);
        let (_dir, root) = tree(&[("in.md", b"# in")]);
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.md"), root.join("link.md")).unwrap();
        let walked: Vec<PathBuf> = walk(&root).entries.into_iter().map(|(p, _)| p).collect();
        assert_eq!(walked, [root.join("in.md")]);
    }

    #[test]
    fn every_listed_text_file_is_copied_outside_git() {
        let (_dir, root) = tree(&[("README.md", b"# Read me\n"), ("docs/old.md", b"# Old\n"), ("photo.png", b"\x89PNG"), ("blob.bin", b"\x00\x01\x02")]);
        let baseline = take(&root, None, 1024, NOTHING_CHANGED);
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
        let baseline = take(&root, None, 1024, NOTHING_CHANGED);
        // The deeper file sorts first by name, but the shallow one's turn comes first.
        assert!(matches!(baseline.entries[&root.join("z-shallow.md")].text, BaseText::Copy(_)));
        assert_eq!(baseline.entries[&root.join("a/deep.md")].text, BaseText::NoCopy(NoCopy::Budget));
        assert_eq!(baseline.copy_bytes, 600);
    }

    #[test]
    fn a_file_over_4_mb_is_not_copied() {
        let big = vec![b'a'; (access::MAX_TEXT_BYTES + 1) as usize];
        let (_dir, root) = tree(&[("big.md", &big)]);
        let baseline = take(&root, None, 64 * 1024 * 1024, NOTHING_CHANGED);
        assert_eq!(baseline.entries[&root.join("big.md")].text, BaseText::NoCopy(NoCopy::TooLarge));
        assert_eq!(baseline.copy_bytes, 0);
    }

    #[test]
    fn a_binary_is_noted_not_copied_even_past_the_budget() {
        let (_dir, root) = tree(&[("a.bin", b"\x00\x01\x02\x03"), ("b.bin", &[0u8; 2048])]);
        let baseline = take(&root, None, 8, NOTHING_CHANGED);
        assert_eq!(baseline.entries[&root.join("a.bin")].text, BaseText::NotText);
        assert_eq!(baseline.entries[&root.join("b.bin")].text, BaseText::NotText);
    }

    #[test]
    fn a_file_named_by_an_event_before_its_copy_gets_none() {
        let (_dir, root) = tree(&[("busy.md", b"# half written"), ("calm.md", b"# calm")]);
        let busy = root.join("busy.md");
        let baseline = take(&root, None, 1024, &|p: &Path| p == busy);
        assert_eq!(baseline.entries[&busy].text, BaseText::NoCopy(NoCopy::ChangedDuringCopy));
        assert!(matches!(baseline.entries[&root.join("calm.md")].text, BaseText::Copy(_)));
    }

    #[test]
    fn a_trim_gives_back_the_deepest_copies_first() {
        let (_dir, root) = tree(&[("a.md", &[b'a'; 100]), ("d/b.md", &[b'b'; 100]), ("d/e/c.md", &[b'c'; 100])]);
        let mut baseline = take(&root, None, 1024, NOTHING_CHANGED);
        assert_eq!(baseline.copy_bytes, 300);
        baseline.trim_to(150);
        assert_eq!(baseline.copy_bytes, 100);
        assert!(matches!(baseline.entries[&root.join("a.md")].text, BaseText::Copy(_)));
        assert_eq!(baseline.entries[&root.join("d/b.md")].text, BaseText::NoCopy(NoCopy::Budget));
        assert_eq!(baseline.entries[&root.join("d/e/c.md")].text, BaseText::NoCopy(NoCopy::Budget));
    }

    use super::super::git::tests::{git, repo_with};

    fn blob_of(root: &Path, rel: &str) -> String {
        git(root, &["rev-parse", &format!("HEAD:{rel}")])
    }

    #[test]
    fn a_clean_tracked_file_is_not_copied_and_its_blob_is_recorded() {
        let (_dir, root) = tree(&[]);
        repo_with(&root, &[("README.md", b"# Read me\n"), ("docs/old.md", b"# Old\n")]);
        let g = Git::find().expect("git is installed");
        let baseline = take(&root, Some(&g), 1024, NOTHING_CHANGED);
        let head = Arc::new(Head { repo: root.clone(), commit: git(&root, &["rev-parse", "HEAD"]) });
        assert_eq!(baseline.entries[&root.join("README.md")].text, BaseText::Blob { head: head.clone(), blob: blob_of(&root, "README.md") });
        assert_eq!(baseline.entries[&root.join("docs/old.md")].text, BaseText::Blob { head, blob: blob_of(&root, "docs/old.md") });
        assert_eq!(baseline.copy_bytes, 0);
    }

    #[test]
    fn dirty_untracked_and_ignored_files_are_copied() {
        let (_dir, root) = tree(&[]);
        repo_with(&root, &[(".gitignore", b"tasks/\n"), ("README.md", b"# Read me\n"), ("clean.md", b"# Clean\n")]);
        std::fs::write(root.join("README.md"), "# Read me, edited\n").unwrap();
        std::fs::write(root.join("untracked.md"), "# New\n").unwrap();
        std::fs::create_dir(root.join("tasks")).unwrap();
        std::fs::write(root.join("tasks/plan.md"), "# Plan\n").unwrap();
        let g = Git::find().expect("git is installed");
        let baseline = take(&root, Some(&g), 1024, NOTHING_CHANGED);
        let text = |name: &str| baseline.entries[&root.join(name)].text.clone();
        assert_eq!(text("README.md"), BaseText::Copy(Arc::from(&b"# Read me, edited\n"[..])));
        assert_eq!(text("untracked.md"), BaseText::Copy(Arc::from(&b"# New\n"[..])));
        assert_eq!(text("tasks/plan.md"), BaseText::Copy(Arc::from(&b"# Plan\n"[..])));
        assert!(matches!(text("clean.md"), BaseText::Blob { .. }));
    }

    #[test]
    fn a_nested_repository_answers_for_its_own_files() {
        let (_dir, root) = tree(&[]);
        repo_with(&root, &[(".gitignore", b"inner/\n"), ("outer.md", b"# Outer\n")]);
        let inner = root.join("inner");
        std::fs::create_dir(&inner).unwrap();
        repo_with(&inner, &[("inside.md", b"# Inside\n")]);
        std::fs::write(inner.join("loose.md"), "# Untracked in inner\n").unwrap();
        let g = Git::find().expect("git is installed");
        let baseline = take(&root, Some(&g), 1024, NOTHING_CHANGED);
        let BaseText::Blob { head, blob } = baseline.entries[&inner.join("inside.md")].text.clone() else { panic!("inside.md is clean in its own repository") };
        assert_eq!((head.repo.clone(), head.commit.clone(), blob), (inner.clone(), git(&inner, &["rev-parse", "HEAD"]), blob_of(&inner, "inside.md")));
        assert!(matches!(&baseline.entries[&root.join("outer.md")].text, BaseText::Blob { head, .. } if head.repo == root));
        assert_eq!(baseline.entries[&inner.join("loose.md")].text, BaseText::Copy(Arc::from(&b"# Untracked in inner\n"[..])));
    }

    #[test]
    fn a_root_inside_a_repository_asks_the_repository_above_it() {
        let (_dir, top) = tree(&[]);
        repo_with(&top, &[("docs/guide.md", b"# Guide\n"), ("other/far.md", b"# Far\n")]);
        let root = top.join("docs");
        let g = Git::find().expect("git is installed");
        let baseline = take(&root, Some(&g), 1024, NOTHING_CHANGED);
        assert!(matches!(&baseline.entries[&root.join("guide.md")].text, BaseText::Blob { head, .. } if head.repo == top));
        assert_eq!(baseline.entries.len(), 1, "nothing outside the root is kept");
    }

    #[test]
    fn an_unborn_repository_copies_everything() {
        let (_dir, root) = tree(&[("draft.md", b"# Draft\n")]);
        git(&root, &["init", "-q"]);
        let g = Git::find().expect("git is installed");
        let baseline = take(&root, Some(&g), 1024, NOTHING_CHANGED);
        assert_eq!(baseline.entries[&root.join("draft.md")].text, BaseText::Copy(Arc::from(&b"# Draft\n"[..])));
    }

    #[test]
    fn the_repositories_reaching_into_a_root_are_kept_deepest_first_with_their_shared_git_folder() {
        let (_dir, top) = tree(&[]);
        repo_with(&top, &[(".gitignore", b"docs/inner/\n"), ("docs/guide.md", b"# Guide\n")]);
        let inner = top.join("docs/inner");
        std::fs::create_dir_all(&inner).unwrap();
        repo_with(&inner, &[("inside.md", b"# Inside\n")]);
        let g = Git::find().expect("git is installed");
        let baseline = take(&top.join("docs"), Some(&g), 1024, NOTHING_CHANGED);
        assert_eq!(baseline.repos, [RepoAt { top: inner.clone(), common: inner.join(".git") }, RepoAt { top: top.clone(), common: top.join(".git") }]);
        assert_eq!(baseline.repo_of(&inner.join("inside.md")).map(|r| &r.top), Some(&inner));
        assert_eq!(baseline.repo_of(&top.join("docs/guide.md")).map(|r| &r.top), Some(&top));
        assert_eq!(take(&top.join("docs"), None, 1024, NOTHING_CHANGED).repos, [], "no git, no repository");
    }

    #[test]
    fn a_pushed_rebase_gives_its_copy_back_and_leaves_the_old_baseline_as_it_was() {
        let (_dir, root) = tree(&[("a.md", &[b'a'; 100])]);
        let before = take(&root, None, 1024, NOTHING_CHANGED);
        let mut after = before.clone();
        let stat = Stat::of(&root.join("a.md")).unwrap();
        let head = Arc::new(Head { repo: root.clone(), commit: "c0ffee".into() });
        assert_eq!(after.rebase(&root.join("a.md"), Rebase::Pushed { head: head.clone(), blob: "b10b".into(), stat }, 5_000), -100);
        assert_eq!(after.copy_bytes, 0);
        assert_eq!(after.entries[&root.join("a.md")].text, BaseText::Blob { head, blob: "b10b".into() });
        assert!(matches!(before.entries[&root.join("a.md")].text, BaseText::Copy(_)), "the clone was rebaselined, not the original");
        assert_eq!(before.copy_bytes, 100);
    }

    #[test]
    fn since_of_takes_the_latest_of_the_path_and_its_folders() {
        let (_dir, root) = tree(&[("docs/a.md", b"a"), ("docs/sub/b.md", b"b"), ("other.md", b"o")]);
        let mut baseline = take(&root, None, 1024, NOTHING_CHANGED);
        assert_eq!(baseline.since_of(&root.join("docs/a.md"), 1_000), 1_000, "never rebaselined: the record's moment");
        let stat = |p: &str| Stat::of(&root.join(p)).unwrap();
        let head = Arc::new(Head { repo: root.clone(), commit: "c0ffee".into() });
        baseline.rebase(&root.join("docs/a.md"), Rebase::Pushed { head, blob: "b10b".into(), stat: stat("docs/a.md") }, 3_000);
        baseline.rebase(&root.join("docs"), Rebase::Folder { stat: stat("docs") }, 5_000);
        assert_eq!(baseline.since_of(&root.join("docs/a.md"), 1_000), 5_000, "the folder's later moment wins");
        assert_eq!(baseline.since_of(&root.join("docs/sub/b.md"), 1_000), 5_000, "inherited from the folder above");
        assert_eq!(baseline.since_of(&root.join("other.md"), 1_000), 1_000);
        // Removed, the path's moment stays: a file made again there counts from it.
        baseline.rebase(&root.join("docs/sub"), Rebase::Gone, 7_000);
        assert!(!baseline.entries.contains_key(&root.join("docs/sub/b.md")) && !baseline.entries.contains_key(&root.join("docs/sub")));
        assert_eq!(baseline.since_of(&root.join("docs/sub/b.md"), 1_000), 7_000, "a tombstone still answers");
    }

    #[test]
    fn rebase_gives_copies_back() {
        let (_dir, root) = tree(&[("a.md", &[b'a'; 100]), ("d/b.md", &[b'b'; 50]), ("d/c.md", &[b'c'; 30])]);
        let mut baseline = take(&root, None, 1024, NOTHING_CHANGED);
        assert_eq!(baseline.copy_bytes, 180);
        // Gone takes the folder and everything beneath, and gives back their copies.
        assert_eq!(baseline.rebase(&root.join("d"), Rebase::Gone, 2_000), -80);
        // A folder where a file was gives the file's copy back.
        std::fs::remove_file(root.join("a.md")).unwrap();
        std::fs::create_dir(root.join("a.md")).unwrap();
        assert_eq!(baseline.rebase(&root.join("a.md"), Rebase::Folder { stat: Stat::of(&root.join("a.md")).unwrap() }, 3_000), -100);
        assert_eq!((baseline.copy_bytes, baseline.entries[&root.join("a.md")].text.clone()), (0, BaseText::NotText));
    }

    #[test]
    fn rebase_takes_a_copy_within_budget() {
        let (_dir, root) = tree(&[("a.md", &[b'a'; 100])]);
        let mut baseline = take(&root, None, 1024, NOTHING_CHANGED);
        let stat = || Stat::of(&root.join("a.md")).unwrap();
        std::fs::write(root.join("a.md"), [b'z'; 40]).unwrap();
        // Kept takes a copy of the text now, and gives the old one back.
        let now = copy(&root.join("a.md"), stat(), 1024, NOTHING_CHANGED);
        assert_eq!(baseline.rebase(&root.join("a.md"), Rebase::Kept { stat: stat(), text: now }, 3_000), 40 - 100);
        assert_eq!(baseline.entries[&root.join("a.md")].text, BaseText::Copy(Arc::from(&[b'z'; 40][..])));
        // Past the budget: the reason instead, and nothing taken.
        let none_left = copy(&root.join("a.md"), stat(), 0, NOTHING_CHANGED);
        assert_eq!(none_left, BaseText::NoCopy(NoCopy::Budget));
        assert_eq!(baseline.rebase(&root.join("a.md"), Rebase::Kept { stat: stat(), text: none_left }, 4_000), -40);
        assert_eq!((baseline.copy_bytes, baseline.since_of(&root.join("a.md"), 0)), (0, 4_000));
    }

    #[test]
    fn beneath_is_everything_under_a_folder_and_nothing_beside_it() {
        let (_dir, root) = tree(&[("docs/a.md", b"a"), ("docs/sub/b.md", b"b"), ("docs-old.md", b"c"), ("docsx/d.md", b"d")]);
        let baseline = take(&root, None, 1024, NOTHING_CHANGED);
        let docs = root.join("docs");
        let under: Vec<&PathBuf> = baseline.beneath(&docs).map(|(p, _)| p).collect();
        assert_eq!(under, [&docs.join("a.md"), &docs.join("sub"), &docs.join("sub/b.md")]);
    }
}
