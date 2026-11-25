//! Whether a task's pull request or branch changes `.claude/` or `.mcp.json` (the captain's (b), 2026-11-25; ADR 0027):
//! a hook or an MCP server merged there would run in the captain's own sessions, outside any sandbox, so the card asks
//! for the captain's review. Two readings, each a list of the paths that matched:
//! - the PR: `gh pr view`'s `files` (paths only), and `changedFiles` to know whether the list is whole;
//! - the branch: `git log --name-only` over the branch's commits not on `origin/HEAD`, read from the clone's own git
//!   folder (`--git-dir`), never inside the worker's worktree, whose per-worktree config the worker can write. No hook
//!   runs for `log`, and no textconv or external diff runs for names.
//!
//! A reading that cannot be whole says so (`unknown`) and the card still asks for review: fail closed. The same argv
//! runs on the VPS (`cli/src/companion/run.ts` `branchArgs`) and its output comes back verbatim in the bundle.

use serde::{Deserialize, Serialize};
use std::path::{Component, Path};

/// The most paths kept: the card says what kind, the detail lists these.
const KEPT: usize = 20;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Touches {
    /// The matching paths, sorted, at most 20.
    pub paths: Vec<String>,
    /// The reading could not see every path (more files than GitHub lists, or git could not answer).
    pub unknown: bool,
}

impl Touches {
    /// Nothing to ask the captain about.
    pub(crate) fn clear(&self) -> bool {
        self.paths.is_empty() && !self.unknown
    }

    /// Both readings at once: every path either found, unknown if either was.
    pub(crate) fn union(a: Option<&Touches>, b: Option<&Touches>) -> Option<Touches> {
        let mut paths: Vec<String> = a.into_iter().chain(b).flat_map(|t| t.paths.iter().cloned()).collect();
        paths.sort_unstable();
        paths.dedup();
        paths.truncate(KEPT);
        let t = Touches { paths, unknown: a.is_some_and(|t| t.unknown) || b.is_some_and(|t| t.unknown) };
        (!t.clear()).then_some(t)
    }
}

/// A path the captain reviews: any part of it `.claude`, or the file `.mcp.json` anywhere.
pub(crate) fn sensitive(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    parts.contains(&".claude") || parts.last() == Some(&".mcp.json")
}

/// The matching paths of `paths`; `whole` false when `paths` is not every path changed.
pub(crate) fn of_paths<'a>(paths: impl IntoIterator<Item = &'a str>, whole: bool) -> Touches {
    let mut found: Vec<String> = paths.into_iter().filter(|p| sensitive(p)).map(str::to_string).collect();
    found.sort_unstable();
    found.dedup();
    found.truncate(KEPT);
    Touches { paths: found, unknown: !whole }
}

/// A branch name git and Firstmate both accept here: `fm/<id>` and the like, never an option, never `..`.
pub(crate) fn branch_ok(branch: &str) -> bool {
    !branch.is_empty()
        && branch.len() <= 200
        && !branch.starts_with(['-', '/'])
        && !branch.ends_with(['/', '.'])
        && !branch.contains("..")
        && !branch.contains("//")
        && branch.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
}

/// `git`'s arguments for a branch's changed names, read from the clone's git folder only. None for a branch name that
/// is not one.
pub(crate) fn branch_args(git_dir: &str, branch: &str) -> Option<Vec<String>> {
    if !branch_ok(branch) || !git_dir.starts_with('/') {
        return None;
    }
    let mut args: Vec<String> = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"].map(String::from).to_vec();
    args.push(format!("--git-dir={git_dir}"));
    args.extend(["log", "--no-renames", "--no-ext-diff", "--no-textconv", "--name-only", "--format=", "-z"].map(String::from));
    args.push(format!("refs/heads/{branch}"));
    args.extend(["--not", "refs/remotes/origin/HEAD", "--"].map(String::from));
    Some(args)
}

/// Whether the branch is there yet: `git rev-parse --verify --quiet refs/heads/<branch>^{commit}`, from the clone's git
/// folder. A branch not made yet has nothing to review; one that is there but cannot be read asks for review.
pub(crate) fn branch_exists_args(git_dir: &str, branch: &str) -> Option<Vec<String>> {
    if !branch_ok(branch) || !git_dir.starts_with('/') {
        return None;
    }
    let mut args: Vec<String> = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"].map(String::from).to_vec();
    args.push(format!("--git-dir={git_dir}"));
    args.extend(["rev-parse", "--verify", "--quiet"].map(String::from));
    args.push(format!("refs/heads/{branch}^{{commit}}"));
    Some(args)
}

/// A task clone's git folder: the clone lexically under `<home>/projects/` (as `crew::repo::clone_repo` checks), and its
/// `.git` a real folder — a worktree's `.git` file or a link is not read.
pub(crate) fn clone_git_dir(home: &Path, clone: &str) -> Option<String> {
    let clone = Path::new(clone);
    if !clone.is_absolute() || clone.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return None;
    }
    let rest = clone.strip_prefix(home.join("projects")).ok()?;
    if rest.as_os_str().is_empty() {
        return None;
    }
    let git = clone.join(".git");
    let meta = std::fs::symlink_metadata(&git).ok()?;
    (meta.is_dir() && !meta.file_type().is_symlink()).then(|| git.display().to_string())
}

/// The names `git log --name-only --format= -z` printed: whole when git answered 0, unknown otherwise.
pub(crate) fn of_branch(exit_zero: bool, stdout: &str) -> Touches {
    if !exit_zero {
        return Touches { paths: Vec::new(), unknown: true };
    }
    of_paths(stdout.split(['\0', '\n']).filter(|p| !p.is_empty()), true)
}

/// The PR's paths from `gh pr view --json files,changedFiles`: unknown when `files` is missing or shorter than
/// `changedFiles` (GitHub lists at most 100).
pub(crate) fn of_pr(v: &serde_json::Value) -> Touches {
    let Some(files) = v.get("files").and_then(serde_json::Value::as_array) else { return Touches { paths: Vec::new(), unknown: true } };
    let paths: Vec<&str> = files.iter().filter_map(|f| f.get("path").and_then(serde_json::Value::as_str)).collect();
    let changed = v.get("changedFiles").and_then(serde_json::Value::as_u64);
    let whole = paths.len() == files.len() && changed.is_some_and(|n| n <= paths.len() as u64);
    of_paths(paths, whole)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_claude_folder_anywhere_or_an_mcp_json_anywhere_is_sensitive() {
        for p in [".claude/settings.json", ".claude/skills/x/SKILL.md", "app/.claude/agents/a.md", ".mcp.json", "packages/x/.mcp.json"] {
            assert!(sensitive(p), "{p}");
        }
        for p in ["claude.md", "CLAUDE.md", ".claude-notes", "src/claude/x.ts", "mcp.json", ".mcp.json.bak", "docs/.mcp.json/readme"] {
            assert!(!sensitive(p), "{p}");
        }
    }

    /// ADR 0028, the captain's (2): nested paths match through both readings, not only the root's, and a committed
    /// `.claude/` file is flagged even when it is empty (the sandbox's placeholders, should one ever be committed).
    #[test]
    fn nested_paths_match_through_the_pr_and_the_branch_and_an_empty_placeholder_is_still_flagged() {
        let nested = [
            "sub/.claude/x",
            "sub/.mcp.json",
            "a/b/c/d/e/.claude/skills/s/SKILL.md",
            "packages/x/.claude",
            "deep/a/b/.mcp.json",
            "apps/web/.claude/settings.local.json",
        ];
        let plain = ["src/a.ts", "sub/claude.md", "sub/.claude-notes", "sub/mcp.json", "sub/.mcp.json.bak", "x/.mcp.json/readme"];
        for p in nested {
            assert!(sensitive(p), "{p}");
        }
        for p in plain {
            assert!(!sensitive(p), "{p}");
        }
        let all: Vec<&str> = nested.iter().chain(plain.iter()).copied().collect();
        let mut want: Vec<String> = nested.iter().map(|p| p.to_string()).collect();
        want.sort();

        // The branch: `git log --name-only --format= -z` over two commits.
        let log = format!("\0{}\0\0{}\0", all[..6].join("\0"), all[6..].join("\0"));
        assert_eq!(of_branch(true, &log), Touches { paths: want.clone(), unknown: false });
        // The PR: `gh pr view --json files,changedFiles`.
        let files: Vec<serde_json::Value> = all.iter().map(|p| json!({ "path": p })).collect();
        assert_eq!(of_pr(&json!({ "files": files, "changedFiles": all.len() })), Touches { paths: want, unknown: false });

        // A path only: an empty placeholder committed at the root is flagged like any other file there.
        for p in [".claude/hooks", ".claude/settings.json", ".claude", ".mcp.json"] {
            assert_eq!(of_branch(true, &format!("\0{p}\0")).paths, [p], "{p}");
        }
    }

    #[test]
    fn the_pr_s_files_and_whether_the_list_is_whole() {
        let pr = json!({"files": [{"path": "src/a.ts"}, {"path": ".claude/settings.json"}, {"path": ".mcp.json"}], "changedFiles": 3});
        assert_eq!(of_pr(&pr), Touches { paths: vec![".claude/settings.json".into(), ".mcp.json".into()], unknown: false });
        assert!(of_pr(&json!({"files": [{"path": "src/a.ts"}], "changedFiles": 1})).clear());
        // GitHub lists at most 100: a PR with more cannot be read whole, and asks for review.
        assert_eq!(of_pr(&json!({"files": [{"path": "src/a.ts"}], "changedFiles": 140})), Touches { paths: vec![], unknown: true });
        assert!(of_pr(&json!({"number": 1})).unknown, "no files at all");
        assert!(of_pr(&json!({"files": [{"path": "a"}]})).unknown, "no count");
    }

    #[test]
    fn the_branch_is_read_from_the_clone_s_git_folder_never_the_worktree_and_a_name_that_is_not_one_is_refused() {
        assert_eq!(
            branch_args("/h/fm/projects/shop/.git", "fm/fix-login").unwrap(),
            [
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.hooksPath=/dev/null",
                "--git-dir=/h/fm/projects/shop/.git",
                "log",
                "--no-renames",
                "--no-ext-diff",
                "--no-textconv",
                "--name-only",
                "--format=",
                "-z",
                "refs/heads/fm/fix-login",
                "--not",
                "refs/remotes/origin/HEAD",
                "--",
            ]
        );
        for bad in ["", "-x", "--output=/tmp/x", "a..b", "/abs", "a//b", "a b", "a;b", "fm/x.", "fm/x/"] {
            assert!(branch_args("/g", bad).is_none(), "{bad}");
        }
        assert!(branch_args("relative/.git", "fm/x").is_none());
        assert_eq!(of_branch(true, "\0src/a.ts\0.claude/hooks/x.sh\0\0src/b.ts\0"), Touches { paths: vec![".claude/hooks/x.sh".into()], unknown: false });
        assert_eq!(of_branch(false, ""), Touches { paths: vec![], unknown: true });
    }

    #[test]
    fn the_branch_s_existence_and_the_clone_s_git_folder() {
        assert_eq!(
            branch_exists_args("/g/.git", "fm/x").unwrap(),
            ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "--git-dir=/g/.git", "rev-parse", "--verify", "--quiet", "refs/heads/fm/x^{commit}"]
        );
        assert!(branch_exists_args("/g/.git", "--all").is_none());
        let home = tempfile::tempdir().unwrap();
        let clone = home.path().join("projects").join("shop");
        std::fs::create_dir_all(clone.join(".git")).unwrap();
        assert_eq!(clone_git_dir(home.path(), &clone.display().to_string()), Some(clone.join(".git").display().to_string()));
        assert_eq!(clone_git_dir(home.path(), &home.path().join("elsewhere").display().to_string()), None);
        assert_eq!(clone_git_dir(home.path(), &format!("{}/projects/../x", home.path().display())), None);
        assert_eq!(clone_git_dir(home.path(), &home.path().join("projects").display().to_string()), None);
        // A worktree, whose `.git` is a file, is not read.
        let wt = home.path().join("projects").join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join(".git"), "gitdir: /elsewhere\n").unwrap();
        assert_eq!(clone_git_dir(home.path(), &wt.display().to_string()), None);
    }

    #[test]
    fn both_readings_together() {
        let pr = Touches { paths: vec![".mcp.json".into()], unknown: false };
        let branch = Touches { paths: vec![".claude/x".into(), ".mcp.json".into()], unknown: false };
        assert_eq!(Touches::union(Some(&pr), Some(&branch)), Some(Touches { paths: vec![".claude/x".into(), ".mcp.json".into()], unknown: false }));
        assert_eq!(Touches::union(Some(&Touches::default()), None), None);
        assert_eq!(Touches::union(None, Some(&Touches { paths: vec![], unknown: true })), Some(Touches { paths: vec![], unknown: true }));
    }
}
