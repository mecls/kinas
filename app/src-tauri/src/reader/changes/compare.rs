//! The pure half of tree changes: which paths may carry a mark at all. No disk, no clock, no lock.

use std::path::{Component, Path};

use crate::reader::listable_name;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
