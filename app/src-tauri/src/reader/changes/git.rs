//! Git as the baseline's source (rule 20): a file that matches HEAD is not copied, because HEAD's blob is its text.
//! Plumbing only, as the context packet reads projects (`packages/context/src/sources/projects.ts`): a fixed argv,
//! optional locks off, no prompt, and nothing ever written to a repository — not an object, not the index.
//!
//! A failed call answers with its exit code and nothing else: git's stderr names paths, and nothing here logs one.

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const GIT_TIMEOUT: Duration = Duration::from_secs(10);
/// No optional lock (a read never takes `index.lock` from an agent's commit), no credential prompt, plain output.
pub const ENV: [(&str, &str); 3] = [("GIT_OPTIONAL_LOCKS", "0"), ("GIT_TERMINAL_PROMPT", "0"), ("LC_ALL", "C")];

#[derive(Clone, Debug)]
pub struct Git {
    exe: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub struct GitError {
    /// None: it could not start, or did not finish within `GIT_TIMEOUT`.
    pub exit: Option<i32>,
}

/// `["-C", repo, sub, ...rest]`: every call's argv. Nothing a file or a folder is called ever lands before `--` or in
/// an option's place: the only paths are the repository (`-C`), and the ones `hash_objects` sends on stdin.
pub fn argv(repo: &Path, sub: &str, rest: &[&str]) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["-C".into(), repo.into(), sub.into()];
    args.extend(rest.iter().map(OsString::from));
    args
}

/// NUL-separated output as paths under `repo`.
fn paths_under<'a>(repo: &'a Path, out: &'a [u8]) -> impl Iterator<Item = PathBuf> + 'a {
    out.split(|&b| b == 0).filter(|p| !p.is_empty()).map(move |p| repo.join(OsStr::from_bytes(p)))
}

impl Git {
    /// `git` on `PATH`, then `/usr/bin/git`. A debug build started with `KINAS_E2E_NO_GIT=1` finds none, so the e2e can
    /// show a folder inside a repository marked as any other folder is.
    pub fn find() -> Option<Git> {
        #[cfg(debug_assertions)]
        if std::env::var("KINAS_E2E_NO_GIT").as_deref() == Ok("1") {
            return None;
        }
        use std::os::unix::fs::PermissionsExt;
        let executable = |p: &Path| std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0);
        std::env::var_os("PATH")
            .and_then(|paths| std::env::split_paths(&paths).map(|dir| dir.join("git")).find(|p| executable(p)))
            .or_else(|| Some(PathBuf::from("/usr/bin/git")).filter(|p| executable(p)))
            .map(|exe| Git { exe })
    }

    /// The repository holding `dir` — its top, which may be above `dir` — or None outside any.
    pub fn toplevel(&self, dir: &Path) -> Option<PathBuf> {
        let out = self.run(dir, "rev-parse", &["--show-toplevel"], None).ok()?;
        let top = String::from_utf8(out).ok()?;
        std::fs::canonicalize(top.trim_end_matches('\n')).ok()
    }

    /// HEAD's commit, or None when the repository has no commit yet.
    pub fn head(&self, repo: &Path) -> Result<Option<String>, GitError> {
        self.commit_of(repo, "HEAD")
    }

    /// The commit `rev` names — `HEAD`, `@{upstream}`, a remote-tracking ref — or None when it names nothing (exit 1,
    /// quietly: no commit yet, no upstream, a detached HEAD asked for its upstream).
    pub fn commit_of(&self, repo: &Path, rev: &str) -> Result<Option<String>, GitError> {
        match self.run(repo, "rev-parse", &["--verify", "-q", rev], None) {
            Ok(out) => Ok(Some(String::from_utf8_lossy(&out).trim().to_string())),
            Err(GitError { exit: Some(1) }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// The folder every worktree of `repo` shares — where the refs a push moves live. Relative in a main checkout
    /// (`.git`), absolute in a worktree. None outside a repository.
    pub fn common_dir(&self, repo: &Path) -> Option<PathBuf> {
        let out = self.run(repo, "rev-parse", &["--git-common-dir"], None).ok()?;
        let dir = PathBuf::from(OsStr::from_bytes(out.strip_suffix(b"\n").unwrap_or(&out)));
        std::fs::canonicalize(repo.join(dir)).ok()
    }

    /// The checked-out branch's short name, or None on a detached HEAD (exit 1). A branch with no commit yet has one.
    pub fn branch(&self, repo: &Path) -> Result<Option<String>, GitError> {
        match self.run(repo, "symbolic-ref", &["-q", "--short", "HEAD"], None) {
            Ok(out) => Ok(Some(String::from_utf8_lossy(&out).trim().to_string())),
            Err(GitError { exit: Some(1) }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Whether the repository has a remote at all — somewhere a push could go.
    pub fn has_remote(&self, repo: &Path) -> Result<bool, GitError> {
        Ok(self.run(repo, "remote", &[], None)?.iter().any(|b| !b.is_ascii_whitespace()))
    }

    /// Every regular file in `commit`, with its blob. Symlinks and submodules are left out: neither is a file the
    /// tree reads.
    pub fn tree_blobs(&self, repo: &Path, commit: &str) -> Result<HashMap<PathBuf, String>, GitError> {
        let out = self.run(repo, "ls-tree", &["-r", "-z", "--full-tree", commit], None)?;
        let mut blobs = HashMap::new();
        for record in out.split(|&b| b == 0).filter(|r| !r.is_empty()) {
            // "<mode> blob <sha>\t<path>"
            let Some(tab) = record.iter().position(|&b| b == b'\t') else { continue };
            let meta = String::from_utf8_lossy(&record[..tab]);
            let mut fields = meta.split(' ');
            let (Some(mode), Some("blob"), Some(sha)) = (fields.next(), fields.next(), fields.next()) else { continue };
            if mode == "100644" || mode == "100755" {
                blobs.insert(repo.join(OsStr::from_bytes(&record[tab + 1..])), sha.to_string());
            }
        }
        Ok(blobs)
    }

    /// The files whose working text may differ from `commit`: the index's stat data decides, unrefreshed, so a file
    /// only touched counts too — which costs it a copy, never a mark.
    pub fn dirty(&self, repo: &Path, commit: &str) -> Result<HashSet<PathBuf>, GitError> {
        let out = self.run(repo, "diff-index", &["-z", "--name-only", commit, "--"], None)?;
        Ok(paths_under(repo, &out).collect())
    }

    /// Each file's blob id as `git add` would store it, clean filters applied, without storing it: no `-w`.
    pub fn hash_objects(&self, repo: &Path, files: &[PathBuf]) -> Result<Vec<String>, GitError> {
        let mut stdin = Vec::new();
        for file in files {
            let rel = file.strip_prefix(repo).unwrap_or(file);
            stdin.extend_from_slice(rel.as_os_str().as_bytes());
            stdin.push(b'\n');
        }
        let out = self.run(repo, "hash-object", &["--stdin-paths"], Some(stdin))?;
        let ids: Vec<String> = String::from_utf8_lossy(&out).lines().map(str::to_string).collect();
        if ids.len() == files.len() {
            Ok(ids)
        } else {
            Err(GitError { exit: None })
        }
    }

    /// Which of these files and folders git ignores — asked by name, so a path that is gone is answered too. A folder
    /// is asked with a trailing slash: a `notes/` pattern matches a folder only, and git cannot tell a folder that is
    /// gone from a file without it (checked 2026-09-25). A tracked file inside an ignored folder is not ignored: git
    /// would push it. Exit 1 is "none of them".
    pub fn ignored(&self, repo: &Path, files: &[PathBuf], folders: &[PathBuf]) -> Result<HashSet<PathBuf>, GitError> {
        let mut stdin = Vec::new();
        for (path, slash) in files.iter().map(|f| (f, false)).chain(folders.iter().map(|d| (d, true))) {
            stdin.extend_from_slice(path.strip_prefix(repo).unwrap_or(path).as_os_str().as_bytes());
            if slash {
                stdin.push(b'/');
            }
            stdin.push(0);
        }
        match self.run(repo, "check-ignore", &["-z", "--stdin"], Some(stdin)) {
            Ok(out) => Ok(out.split(|&b| b == 0).filter(|p| !p.is_empty()).map(|p| repo.join(OsStr::from_bytes(p.strip_suffix(b"/").unwrap_or(p)))).collect()),
            Err(GitError { exit: Some(1) }) => Ok(HashSet::new()),
            Err(e) => Err(e),
        }
    }

    /// A file's text at `commit`, as a checkout would write it: filters and line endings applied.
    pub fn blob_text(&self, repo: &Path, commit: &str, file: &Path) -> Result<Vec<u8>, GitError> {
        let rel = file.strip_prefix(repo).unwrap_or(file);
        let mut spec = OsString::from(format!("{commit}:"));
        spec.push(rel.as_os_str());
        let spec = spec.to_string_lossy().into_owned();
        self.run(repo, "cat-file", &["--filters", &spec], None)
    }

    /// One call: the fixed environment, stdin closed (or fed, for `hash_objects`), both outputs drained on threads so a
    /// full pipe cannot stall it, and killed past `GIT_TIMEOUT`. Returns stdout; stderr is read and dropped.
    fn run(&self, repo: &Path, sub: &str, rest: &[&str], input: Option<Vec<u8>>) -> Result<Vec<u8>, GitError> {
        let mut command = Command::new(&self.exe);
        command.args(argv(repo, sub, rest)).envs(ENV).stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|_| GitError { exit: None })?;
        let feeder = child.stdin.take().zip(input).map(|(mut pipe, bytes)| std::thread::spawn(move || drop(pipe.write_all(&bytes))));
        let drain = |stream: Option<Box<dyn Read + Send>>| {
            std::thread::spawn(move || {
                let mut bytes = Vec::new();
                if let Some(mut s) = stream {
                    let _ = s.read_to_end(&mut bytes);
                }
                bytes
            })
        };
        let out = drain(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
        let err = drain(child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
        let deadline = Instant::now() + GIT_TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(GitError { exit: None });
                }
            }
        };
        if let Some(feeder) = feeder {
            let _ = feeder.join();
        }
        let stdout = out.join().unwrap_or_default();
        drop(err.join());
        if status.success() {
            Ok(stdout)
        } else {
            Err(GitError { exit: status.code() })
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A real `git` in a temp folder, with no global hook, signing or editor in the way. A missing `git` fails the
    /// test, never skips it.
    pub(crate) fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(["-c", "user.name=Kinas test", "-c", "user.email=test@kinas.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main"])
            .args(args)
            .current_dir(dir)
            .envs(ENV)
            .output()
            .expect("git runs");
        assert!(out.status.success(), "git {args:?} failed");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// A repository at `dir` with these files committed.
    pub(crate) fn repo_with(dir: &Path, files: &[(&str, &[u8])]) {
        git(dir, &["init", "-q"]);
        for (name, bytes) in files {
            let path = dir.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-q", "-m", "baseline"]);
    }

    fn temp() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        (dir, root)
    }

    #[test]
    fn argv_is_fixed_and_env_turns_locks_off() {
        let args = argv(Path::new("/p/repo"), "ls-tree", &["-r", "-z"]);
        assert_eq!(args, ["-C", "/p/repo", "ls-tree", "-r", "-z"].map(OsString::from));
        assert!(ENV.contains(&("GIT_OPTIONAL_LOCKS", "0")));
        assert!(ENV.contains(&("GIT_TERMINAL_PROMPT", "0")));
        assert!(ENV.contains(&("LC_ALL", "C")));
        // Tree changes clear on push: what says where a push goes, as literal argvs.
        let repo = Path::new("/p/repo");
        assert_eq!(argv(repo, "rev-parse", &["--git-common-dir"]), ["-C", "/p/repo", "rev-parse", "--git-common-dir"].map(OsString::from));
        assert_eq!(argv(repo, "symbolic-ref", &["-q", "--short", "HEAD"]), ["-C", "/p/repo", "symbolic-ref", "-q", "--short", "HEAD"].map(OsString::from));
        assert_eq!(argv(repo, "rev-parse", &["--verify", "-q", "@{upstream}"]), ["-C", "/p/repo", "rev-parse", "--verify", "-q", "@{upstream}"].map(OsString::from));
        assert_eq!(argv(repo, "remote", &[]), ["-C", "/p/repo", "remote"].map(OsString::from));
        assert_eq!(argv(repo, "check-ignore", &["-z", "--stdin"]), ["-C", "/p/repo", "check-ignore", "-z", "--stdin"].map(OsString::from));
    }

    /// A repository at `dir` with these files committed on `main`, and a bare remote beside it (`<dir>.git`'s
    /// sibling, outside `dir`) it was pushed to with `-u`. Answers the remote's path.
    pub(crate) fn pushed_repo_with(dir: &Path, files: &[(&str, &[u8])]) -> PathBuf {
        let remote = dir.with_file_name(format!("{}-remote.git", dir.file_name().unwrap().to_string_lossy()));
        std::fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "-q", "--bare"]);
        repo_with(dir, files);
        git(dir, &["remote", "add", "origin", &remote.to_string_lossy()]);
        git(dir, &["push", "-q", "-u", "origin", "main"]);
        remote
    }

    #[test]
    fn common_dir_is_absolute_in_a_main_checkout_and_a_worktree() {
        let (_dir, root) = temp();
        let repo = root.join("repo");
        std::fs::create_dir(&repo).unwrap();
        repo_with(&repo, &[("README.md", b"# Read me\n")]);
        git(&repo, &["worktree", "add", "-q", "../wt", "-b", "side"]);
        let g = Git::find().expect("git is installed");
        assert_eq!(g.common_dir(&repo), Some(repo.join(".git")));
        assert_eq!(g.common_dir(&root.join("wt")), Some(repo.join(".git")), "a worktree shares the main repository's refs");
        assert_eq!(g.common_dir(&root), None, "not a repository");
    }

    #[test]
    fn branch_is_none_on_a_detached_head() {
        let (_dir, root) = temp();
        repo_with(&root, &[("README.md", b"# Read me\n")]);
        let g = Git::find().expect("git is installed");
        assert_eq!(g.branch(&root), Ok(Some("main".into())));
        git(&root, &["checkout", "-q", "--detach"]);
        assert_eq!(g.branch(&root), Ok(None));
    }

    #[test]
    fn commit_of_answers_none_for_a_missing_rev_and_has_remote_says_whether_one_exists() {
        let (_dir, root) = temp();
        let repo = root.join("repo");
        std::fs::create_dir(&repo).unwrap();
        repo_with(&repo, &[("README.md", b"# Read me\n")]);
        let g = Git::find().expect("git is installed");
        assert_eq!(g.commit_of(&repo, "@{upstream}"), Ok(None), "no upstream is an answer, not a failure");
        assert_eq!(g.has_remote(&repo), Ok(false));

        let remote = root.join("remote.git");
        std::fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "-q", "--bare"]);
        git(&repo, &["remote", "add", "origin", &remote.to_string_lossy()]);
        assert_eq!(g.has_remote(&repo), Ok(true));
        git(&repo, &["push", "-q", "origin", "main"]);
        let head = git(&repo, &["rev-parse", "HEAD"]);
        assert_eq!(g.commit_of(&repo, "@{upstream}"), Ok(None), "pushed without -u: still no upstream");
        assert_eq!(g.commit_of(&repo, "refs/remotes/origin/main"), Ok(Some(head.clone())));
        git(&repo, &["branch", "-q", "--set-upstream-to", "origin/main"]);
        assert_eq!(g.commit_of(&repo, "@{upstream}"), Ok(Some(head)));
    }

    #[test]
    fn ignored_names_ignored_paths_even_deleted_ones() {
        let (_dir, root) = temp();
        repo_with(&root, &[(".gitignore", b"notes/\n*.log\n"), ("docs/a.md", b"# A\n")]);
        // Tracked although its pattern says ignore: git would still push it.
        std::fs::write(root.join("kept.log"), "tracked\n").unwrap();
        git(&root, &["add", "-f", "kept.log"]);
        git(&root, &["commit", "-q", "-m", "a tracked log"]);
        std::fs::create_dir(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/x.md"), "# X\n").unwrap();
        let g = Git::find().expect("git is installed");
        let asked = ["notes/x.md", "notes/gone.md", "docs/a.md", "kept.log", "new.log", "new.md"].map(|p| root.join(p));
        let ignored = g.ignored(&root, &asked, &[root.join("notes"), root.join("docs")]).unwrap();
        assert_eq!(ignored, HashSet::from(["notes/x.md", "notes/gone.md", "new.log", "notes"].map(|p| root.join(p))));
        // A folder that is gone is still answered, by its trailing slash.
        std::fs::remove_dir_all(root.join("notes")).unwrap();
        assert_eq!(g.ignored(&root, &[], &[root.join("notes")]), Ok(HashSet::from([root.join("notes")])));
        assert_eq!(g.ignored(&root, &[root.join("docs/a.md")], &[]), Ok(HashSet::new()), "none ignored is an answer, not a failure");
    }

    #[test]
    fn the_new_calls_never_write() {
        let (_dir, root) = temp();
        let repo = root.join("repo");
        std::fs::create_dir(&repo).unwrap();
        pushed_repo_with(&repo, &[("README.md", b"# Read me\n")]);
        std::fs::write(repo.join("README.md"), "# Read me, edited\n").unwrap();
        let g = Git::find().expect("git is installed");
        let mtime = |name: &str| std::fs::metadata(repo.join(".git").join(name)).ok().and_then(|m| m.modified().ok());
        let state = || (git(&repo, &["count-objects", "-v"]), mtime("index"), mtime("config"), mtime("FETCH_HEAD"), mtime("packed-refs"));
        let before = state();
        // Past the second, so a rewrite would show in a modification time.
        std::thread::sleep(Duration::from_millis(1100));

        g.common_dir(&repo).unwrap();
        g.branch(&repo).unwrap();
        g.commit_of(&repo, "@{upstream}").unwrap();
        g.commit_of(&repo, "refs/remotes/origin/main").unwrap();
        g.has_remote(&repo).unwrap();
        g.ignored(&repo, &[repo.join("README.md"), repo.join("notes/x.md")], &[repo.join("notes")]).unwrap();
        assert_eq!(state(), before, "no object, index, config or ref was written");
    }

    #[test]
    fn the_six_calls_read_a_repository() {
        let (_dir, root) = temp();
        repo_with(&root, &[("README.md", b"# Read me\n"), ("docs/old.md", b"# Old\n"), ("tool.sh", b"#!/bin/sh\n")]);
        std::os::unix::fs::symlink("README.md", root.join("link.md")).unwrap();
        git(&root, &["add", "link.md"]);
        git(&root, &["commit", "-q", "-m", "a link"]);
        let g = Git::find().expect("git is installed");

        assert_eq!(g.toplevel(&root.join("docs")), Some(root.clone()));
        let head = g.head(&root).unwrap().expect("a commit");
        assert_eq!(head, git(&root, &["rev-parse", "HEAD"]));

        let blobs = g.tree_blobs(&root, &head).unwrap();
        assert_eq!(blobs.len(), 3, "the symlink is not a file the tree reads: {blobs:?}");
        assert_eq!(blobs[&root.join("docs/old.md")], git(&root, &["rev-parse", "HEAD:docs/old.md"]));

        assert!(g.dirty(&root, &head).unwrap().is_empty());
        std::fs::write(root.join("docs/old.md"), "# Old, edited\n").unwrap();
        assert_eq!(g.dirty(&root, &head).unwrap(), HashSet::from([root.join("docs/old.md")]));

        assert_eq!(g.blob_text(&root, &head, &root.join("docs/old.md")).unwrap(), b"# Old\n");
    }

    #[test]
    fn an_unborn_repository_has_no_head_and_a_plain_folder_no_top() {
        let (_dir, root) = temp();
        let g = Git::find().expect("git is installed");
        assert_eq!(g.toplevel(&root), None);
        git(&root, &["init", "-q"]);
        assert_eq!(g.head(&root), Ok(None));
    }

    #[test]
    fn hash_object_never_writes() {
        let (_dir, root) = temp();
        repo_with(&root, &[("README.md", b"# Read me\n")]);
        std::fs::write(root.join("new.md"), "# Never stored\n").unwrap();
        let g = Git::find().expect("git is installed");
        let objects = || git(&root, &["count-objects", "-v"]);
        let before = objects();

        let ids = g.hash_objects(&root, &[root.join("README.md"), root.join("new.md")]).unwrap();
        assert_eq!(ids[0], git(&root, &["rev-parse", "HEAD:README.md"]), "an unchanged file hashes to its blob");
        assert_eq!(ids[1].len(), 40);
        assert_eq!(objects(), before, "nothing was written to the repository");
        assert_eq!(git(&root, &["cat-file", "-t", &ids[0]]), "blob");
        let missing = Command::new("git").args(["cat-file", "-e", &ids[1]]).current_dir(&root).status().unwrap();
        assert!(!missing.success(), "the new file's object was not stored");
    }

    #[test]
    fn blob_text_applies_filters() {
        let (_dir, root) = temp();
        repo_with(&root, &[(".gitattributes", b"*.txt eol=crlf\n"), ("notes.txt", b"one\ntwo\n")]);
        let g = Git::find().expect("git is installed");
        let head = g.head(&root).unwrap().unwrap();
        // Stored with LF; checked out, as the file on disk is, with CRLF.
        assert_eq!(g.blob_text(&root, &head, &root.join("notes.txt")).unwrap(), b"one\r\ntwo\r\n");
        assert_eq!(g.hash_objects(&root, &[root.join("notes.txt")]).unwrap()[0], git(&root, &["rev-parse", "HEAD:notes.txt"]));
    }
}
