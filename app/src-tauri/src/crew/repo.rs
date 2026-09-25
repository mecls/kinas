//! A folder's GitHub repository, from its git config read as a file (build spec §7, PRD rules 8 and 18): a client
//! folder's for the sidebar's lanes, a task clone's for its lane on the board. No `git` runs; the config is parsed for
//! `[remote "origin"]`'s `url` and nothing else, and only github.com counts.

use std::path::{Component, Path, PathBuf};

/// `owner/name`, lower-cased, from the folder's `origin` — a worktree's or a submodule's `.git` file is followed to
/// its git directory, and a worktree to the repository's shared config. None without a GitHub `origin`.
pub(crate) fn origin_repo(folder: &Path) -> Option<String> {
    let git = folder.join(".git");
    let dir = if git.is_dir() { git } else { gitdir_of(&git, folder)? };
    let url = origin_url(&dir.join("config")).or_else(|| {
        // A worktree's git directory has no config of its own: `commondir` names the repository's.
        let common = std::fs::read_to_string(dir.join("commondir")).ok()?;
        let common = dir.join(common.trim());
        origin_url(&common.join("config"))
    })?;
    normalise(&url)
}

/// `gitdir: <path>` from a `.git` file, relative to the folder when it is not absolute.
fn gitdir_of(file: &Path, folder: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(file).ok()?;
    let line = text.lines().find_map(|l| l.trim().strip_prefix("gitdir:"))?.trim();
    (!line.is_empty()).then(|| folder.join(line))
}

/// `[remote "origin"]`'s `url`: section names case-insensitive, the subsection exact, as git reads them.
fn origin_url(config: &Path) -> Option<String> {
    let text = std::fs::read_to_string(config).ok()?;
    let mut in_origin = false;
    for line in text.lines() {
        let line = line.trim();
        if let Some(header) = line.strip_prefix('[') {
            let header = header.split(']').next().unwrap_or_default().trim();
            in_origin = header.split_once(char::is_whitespace).is_some_and(|(section, sub)| section.eq_ignore_ascii_case("remote") && sub.trim() == "\"origin\"");
            continue;
        }
        if !in_origin {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        if key.trim().eq_ignore_ascii_case("url") {
            let value = value.trim();
            let value = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(value);
            return (!value.is_empty()).then(|| value.to_string());
        }
    }
    None
}

/// A remote URL as `owner/name`, lower-cased: `https://github.com/o/r(.git)`, `ssh://git@github.com(:22)/o/r.git` and
/// `git@github.com:o/r.git`. Any other host, or any other shape, is None.
pub(crate) fn normalise(url: &str) -> Option<String> {
    let url = url.trim();
    let path = if let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("ssh://")) {
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit('@').next()?;
        let host = host.split(':').next()?;
        host.eq_ignore_ascii_case("github.com").then_some(path)?
    } else {
        let (user_host, path) = url.split_once(':')?;
        let host = user_host.rsplit('@').next()?;
        (user_host.contains('@') && host.eq_ignore_ascii_case("github.com")).then_some(path)?
    };
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = path.split_once('/')?;
    let fine = |s: &str| !s.is_empty() && !s.contains('/') && s != "." && s != "..";
    (fine(owner) && fine(name)).then(|| format!("{owner}/{name}").to_lowercase())
}

/// A task's repository from Firstmate's clone of its project (build spec §7): only when `project` sits lexically under
/// `<home>/projects/`, checked before anything is read, so a snapshot cannot point Kinas at another folder's config.
pub(crate) fn clone_repo(home: &Path, project: &str) -> Option<String> {
    let project = Path::new(project);
    if !project.is_absolute() || project.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return None;
    }
    let rest = project.strip_prefix(home.join("projects")).ok()?;
    if rest.as_os_str().is_empty() {
        return None;
    }
    origin_repo(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn repo_with(dir: &Path, config: &str) {
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".git").join("config"), config).unwrap();
    }

    const ORIGIN: &str = "[core]\n\tbare = false\n[remote \"upstream\"]\n\turl = https://github.com/other/fork.git\n[remote \"origin\"]\n\turl = git@github.com:Owner-9c2e/Shop.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n";

    #[test]
    fn normalise_forms() {
        for url in [
            "https://github.com/o/r",
            "https://github.com/o/r.git",
            "https://github.com/o/r/",
            "https://user@github.com/o/r.git",
            "ssh://git@github.com/o/r.git",
            "ssh://git@github.com:22/o/r",
            "git@github.com:o/r.git",
            "git@GitHub.com:O/R",
        ] {
            assert_eq!(normalise(url).as_deref(), Some("o/r"), "{url}");
        }
        for url in [
            "https://gitlab.com/o/r.git",
            "git@gitlab.com:o/r.git",
            "https://github.com/o",
            "https://github.com/o/r/tree/main",
            "http://github.com/o/r",
            "/Users/x/o/r",
            "github.com:o/r",
            "",
        ] {
            assert_eq!(normalise(url), None, "{url}");
        }
    }

    #[test]
    fn origin_repo_reads_the_origin_only() {
        let dir = tempfile::tempdir().unwrap();
        repo_with(dir.path(), ORIGIN);
        assert_eq!(origin_repo(dir.path()).as_deref(), Some("owner-9c2e/shop"));

        let bare = tempfile::tempdir().unwrap();
        repo_with(bare.path(), "[remote \"upstream\"]\n\turl = https://github.com/o/r\n");
        assert_eq!(origin_repo(bare.path()), None, "no origin, no repository");
        assert_eq!(origin_repo(tempfile::tempdir().unwrap().path()), None, "no .git at all");
    }

    #[test]
    fn origin_repo_follows_a_gitdir_file() {
        let root = tempfile::tempdir().unwrap();
        let main = root.path().join("main");
        repo_with(&main, ORIGIN);
        // A worktree: its `.git` file names a git directory whose `commondir` leads back to the repository.
        let wt_git = main.join(".git").join("worktrees").join("wt");
        fs::create_dir_all(&wt_git).unwrap();
        fs::write(wt_git.join("commondir"), "../..\n").unwrap();
        let wt = root.path().join("wt");
        fs::create_dir_all(&wt).unwrap();
        fs::write(wt.join(".git"), format!("gitdir: {}\n", wt_git.display())).unwrap();
        assert_eq!(origin_repo(&wt).as_deref(), Some("owner-9c2e/shop"));

        // A submodule: a relative `gitdir:` to a directory with its own config.
        let sub = main.join("vendor").join("lib");
        fs::create_dir_all(&sub).unwrap();
        let modules = main.join(".git").join("modules").join("lib");
        fs::create_dir_all(&modules).unwrap();
        fs::write(modules.join("config"), "[remote \"origin\"]\n\turl = https://github.com/o/lib-9c2e\n").unwrap();
        fs::write(sub.join(".git"), "gitdir: ../../.git/modules/lib\n").unwrap();
        assert_eq!(origin_repo(&sub).as_deref(), Some("o/lib-9c2e"));
    }

    #[test]
    fn clone_repo_only_under_the_homes_projects() {
        let home = tempfile::tempdir().unwrap();
        let clone = home.path().join("projects").join("shop-9c2e");
        repo_with(&clone, ORIGIN);
        assert_eq!(clone_repo(home.path(), &clone.to_string_lossy()).as_deref(), Some("owner-9c2e/shop"));

        // Outside the home's projects, even with a config that names a repository: never read.
        let elsewhere = tempfile::tempdir().unwrap();
        repo_with(elsewhere.path(), ORIGIN);
        assert_eq!(clone_repo(home.path(), &elsewhere.path().to_string_lossy()), None);
        let dotted = format!("{}/projects/../../{}", home.path().display(), elsewhere.path().display());
        assert_eq!(clone_repo(home.path(), &dotted), None, "`..` never climbs out");
        assert_eq!(clone_repo(home.path(), &home.path().join("projects").to_string_lossy()), None, "the folder itself is no project");
        assert_eq!(clone_repo(home.path(), "projects/shop-9c2e"), None, "a relative path is refused");
    }
}
