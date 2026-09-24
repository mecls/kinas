//! The pure half of tree changes: which paths may carry a mark, what mark a path carries, and what its folders roll
//! up. No disk, no clock, no lock — the burst does the disk work and hands the answers here.

use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};

use super::baseline::BaseEntry;
use super::{FolderRollup, Mark};
use crate::reader::access::Kind;
use crate::reader::listable_name;

/// A path as it is now, as far as a mark cares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Now {
    Absent,
    Dir,
    /// `listable`: the tree's filter says yes — a text file or an image, not a binary.
    File { listable: bool },
}

/// Every component between `root` and `path` passes `reader::listable_name` (rule 5): a write anywhere under `.git`,
/// `node_modules` or a dot-folder never marks, whatever the file itself is called. The root itself is not a path
/// below the root, and neither is anything outside it.
pub fn listable_path(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else {
        return false;
    };
    let mut components = rel.components().peekable();
    components.peek().is_some()
        && components.all(|c| match c {
            // Lossy, as `list_dir` reads names: a name the tree lists is a name that can mark.
            Component::Normal(name) => listable_name(&name.to_string_lossy()),
            _ => false,
        })
}

/// Rules 3 and 4 as one table, from the tree's point of view: what it listed at the baseline, what it would list now.
/// `same` answers for a file listed at both moments — byte-equal to its copy, or, with no copy, the same size and
/// modification time — and is not asked otherwise. None is no mark (and, for absent at both, no row).
pub fn mark_of(base: Option<&BaseEntry>, now: Now, same: bool) -> Option<(Kind, Mark)> {
    let was = base.filter(|b| b.listed()).map(|b| b.stat.kind);
    let is = match now {
        Now::Absent | Now::File { listable: false } => None,
        Now::Dir => Some(Kind::Dir),
        Now::File { listable: true } => Some(Kind::File),
    };
    match (was, is) {
        (None, None) => None,
        (None, Some(kind)) => Some((kind, Mark::Added)),
        (Some(kind), None) => Some((kind, Mark::Deleted)),
        // A folder is marked by existence only; what changed inside it is its roll-up.
        (Some(Kind::Dir), Some(Kind::Dir)) => None,
        (Some(Kind::File), Some(Kind::File)) => (!same).then_some((Kind::File, Mark::Modified)),
        // A file replaced by a folder of the same name, or the reverse: the new kind, added.
        (Some(_), Some(kind)) => Some((kind, Mark::Added)),
    }
}

/// Deleted over modified over added: a deletion is the change least likely to be noticed any other way (rule 10).
pub fn strongest(a: Mark, b: Mark) -> Mark {
    let rank = |m: Mark| match m {
        Mark::Deleted => 2,
        Mark::Modified => 1,
        Mark::Added => 0,
    };
    if rank(a) >= rank(b) {
        a
    } else {
        b
    }
}

/// Whether a folder between `root` and `path` is itself marked A or D. Such a folder counts once, for everything in
/// it (rule 10), so the path's own mark is dropped.
pub fn under_marked_folder(root: &Path, path: &Path, marks: &BTreeMap<PathBuf, (Kind, Mark)>) -> bool {
    path.ancestors()
        .skip(1)
        .take_while(|a| *a != root && a.starts_with(root))
        .any(|a| matches!(marks.get(a), Some((_, Mark::Added | Mark::Deleted))))
}

/// Every folder above a marked path, up to and not including the root, with the count of marks beneath it and the
/// strongest of them; and the root's total. Call it after dropping the marks under marked folders.
pub fn rollups(root: &Path, marks: &BTreeMap<PathBuf, (Kind, Mark)>) -> (Vec<FolderRollup>, u32) {
    let mut folders: HashMap<&Path, (u32, Mark)> = HashMap::new();
    for (path, &(_, mark)) in marks {
        for folder in path.ancestors().skip(1).take_while(|a| *a != root && a.starts_with(root)) {
            let entry = folders.entry(folder).or_insert((0, mark));
            entry.0 += 1;
            entry.1 = strongest(entry.1, mark);
        }
    }
    let mut rollups: Vec<FolderRollup> = folders.into_iter().map(|(path, (count, strongest))| FolderRollup { path: path.display().to_string(), count, strongest }).collect();
    rollups.sort_by(|a, b| a.path.cmp(&b.path));
    (rollups, u32::try_from(marks.len()).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::super::baseline::{BaseText, NoCopy, Stat};
    use super::*;
    use std::sync::Arc;

    fn file(text: BaseText) -> BaseEntry {
        BaseEntry { stat: Stat { kind: Kind::File, size: 3, mtime_ms: 1 }, text }
    }
    fn dir() -> BaseEntry {
        BaseEntry { stat: Stat { kind: Kind::Dir, size: 0, mtime_ms: 1 }, text: BaseText::NotText }
    }
    const TEXT: Now = Now::File { listable: true };

    #[test]
    fn a_path_is_listable_only_if_every_component_below_the_root_is() {
        let root = Path::new("/p/kinas");
        for shown in ["/p/kinas/README.md", "/p/kinas/docs/adr/0001.md", "/p/kinas/builds/a.md"] {
            assert!(listable_path(root, Path::new(shown)), "{shown} must be listable");
        }
        for hidden in [
            "/p/kinas",
            "/p/kinas/.git/index",
            "/p/kinas/.hidden.md",
            "/p/kinas/node_modules/x/readme.md",
            "/p/kinas/app/target/debug/a.md",
            "/p/kinas/docs/.drafts/a.md",
            "/p/other/README.md",
            "/p/kinas/../other/README.md",
        ] {
            assert!(!listable_path(root, Path::new(hidden)), "{hidden} must not be listable");
        }
    }

    #[test]
    fn rule_three_table_every_row() {
        let copy = file(BaseText::Copy(Arc::from(&b"abc"[..])));
        // absent → present: A. present → absent: D. present, different: M. present, the same: none. absent, absent: none.
        assert_eq!(mark_of(None, TEXT, false), Some((Kind::File, Mark::Added)));
        assert_eq!(mark_of(Some(&copy), Now::Absent, false), Some((Kind::File, Mark::Deleted)));
        assert_eq!(mark_of(Some(&copy), TEXT, false), Some((Kind::File, Mark::Modified)));
        assert_eq!(mark_of(Some(&copy), TEXT, true), None);
        assert_eq!(mark_of(None, Now::Absent, false), None);
    }

    #[test]
    fn folders_are_marked_by_existence_and_a_changed_kind_is_the_new_kind_added() {
        assert_eq!(mark_of(None, Now::Dir, false), Some((Kind::Dir, Mark::Added)));
        assert_eq!(mark_of(Some(&dir()), Now::Absent, false), Some((Kind::Dir, Mark::Deleted)));
        assert_eq!(mark_of(Some(&dir()), Now::Dir, false), None);
        assert_eq!(mark_of(Some(&file(BaseText::NoCopy(NoCopy::Budget))), Now::Dir, false), Some((Kind::Dir, Mark::Added)));
        assert_eq!(mark_of(Some(&dir()), TEXT, false), Some((Kind::File, Mark::Added)));
    }

    #[test]
    fn a_binary_is_never_a_row_whichever_side_it_is_on() {
        let binary = file(BaseText::NotText);
        assert_eq!(mark_of(Some(&binary), Now::Absent, false), None);
        assert_eq!(mark_of(Some(&binary), Now::File { listable: false }, false), None);
        assert_eq!(mark_of(None, Now::File { listable: false }, false), None);
        // A binary that became text is a row the tree did not have; a text file that became binary is one it lost.
        assert_eq!(mark_of(Some(&binary), TEXT, false), Some((Kind::File, Mark::Added)));
        assert_eq!(mark_of(Some(&file(BaseText::Copy(Arc::from(&b"abc"[..])))), Now::File { listable: false }, false), Some((Kind::File, Mark::Deleted)));
    }

    #[test]
    fn a_deleted_file_without_a_copy_is_still_deleted() {
        for reason in [NoCopy::Budget, NoCopy::TooLarge, NoCopy::ChangedDuringCopy, NoCopy::Image] {
            assert_eq!(mark_of(Some(&file(BaseText::NoCopy(reason))), Now::Absent, false), Some((Kind::File, Mark::Deleted)), "{reason:?}");
        }
    }

    fn marks(list: &[(&str, Kind, Mark)]) -> BTreeMap<PathBuf, (Kind, Mark)> {
        list.iter().map(|&(p, k, m)| (PathBuf::from(p), (k, m))).collect()
    }

    #[test]
    fn a_new_folder_counts_once_and_a_deleted_folder_subsumes_marks_beneath_it() {
        let root = Path::new("/r");
        let mut m = marks(&[
            ("/r/research", Kind::Dir, Mark::Added),
            ("/r/research/a.md", Kind::File, Mark::Added),
            ("/r/research/deep/b.md", Kind::File, Mark::Added),
            ("/r/docs", Kind::Dir, Mark::Deleted),
            ("/r/docs/overview.md", Kind::File, Mark::Modified),
            ("/r/app/main.rs", Kind::File, Mark::Modified),
        ]);
        let snapshot = m.clone();
        m.retain(|p, _| !under_marked_folder(root, p, &snapshot));
        assert_eq!(m.keys().map(|p| p.display().to_string()).collect::<Vec<_>>(), ["/r/app/main.rs", "/r/docs", "/r/research"]);
        let (folders, total) = rollups(root, &m);
        assert_eq!(total, 3);
        assert_eq!(folders, [FolderRollup { path: "/r/app".into(), count: 1, strongest: Mark::Modified }]);
    }

    #[test]
    fn rollup_colour_is_deleted_over_modified_over_added_and_the_count_is_exact() {
        assert_eq!(strongest(Mark::Added, Mark::Modified), Mark::Modified);
        assert_eq!(strongest(Mark::Modified, Mark::Added), Mark::Modified);
        assert_eq!(strongest(Mark::Deleted, Mark::Modified), Mark::Deleted);
        assert_eq!(strongest(Mark::Added, Mark::Deleted), Mark::Deleted);

        let root = Path::new("/r");
        let mut list: Vec<(String, Kind, Mark)> = (0..150).map(|i| (format!("/r/docs/sub/{i:03}.md"), Kind::File, Mark::Added)).collect();
        list.push(("/r/docs/old.md".into(), Kind::File, Mark::Deleted));
        list.push(("/r/docs/sub/x.md".into(), Kind::File, Mark::Modified));
        let m: BTreeMap<PathBuf, (Kind, Mark)> = list.into_iter().map(|(p, k, mark)| (PathBuf::from(p), (k, mark))).collect();
        let (folders, total) = rollups(root, &m);
        assert_eq!(total, 152);
        assert_eq!(
            folders,
            [
                FolderRollup { path: "/r/docs".into(), count: 152, strongest: Mark::Deleted },
                FolderRollup { path: "/r/docs/sub".into(), count: 151, strongest: Mark::Modified },
            ]
        );
    }
}
