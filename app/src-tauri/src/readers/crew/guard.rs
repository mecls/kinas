//! The crew's code-grep guards (build spec §6.1–§6.3, §11.4 `guard::no_typing_no_writes_four_scripts`; the precedent is
//! `readers/hostinger/mod.rs`'s GET-only guard). They read this crate's own source and fail when:
//! - `crew/`, `readers/crew/` or `herdr.rs` could type into a pane — `send-text`, `send-keys`, a shell string, the PTY's
//!   write (ADR 0003);
//! - `crew/` or `readers/crew/` could write a file — under Firstmate's home above all (ADR 0016);
//! - any code names a Firstmate script but the four Kinas runs (ADR 0020: the three read-only ones and
//!   `fm-capacity.sh`), or names one outside `crew/firstmate.rs`, the only file that builds a path under `<home>/bin/` —
//!   `fm-send.sh` above all (slice 0's finding), and `fm-park.sh`, which writes;
//! - any file but `remote.rs` names `ssh`, `scp` or `sftp` as a program, or `remote.rs` builds a shell string — the one
//!   door is a fixed argv with the request on stdin (ADR 0024).
//!
//! Test modules and comments are not code here: a test may write a fixture, and a comment may say what is never run.
//! The negative control plants each forbidden thing in a string and proves the guard finds it.

#![cfg(test)]

use std::path::{Path, PathBuf};

const TYPING: &[&str] = &["send-text", "send-keys", "\"sh\", \"-c\"", "sh -c", "\"zsh\", \"-c\"", "\"bash\", \"-c\"", "\"-lc\"", ".arg(\"-c\")", "pty_write", "Session::write", ".write_all("];
const WRITES: &[&str] = &["File::create", "File::options", "OpenOptions", "fs::write", "fs::rename", "fs::copy", "remove_file", "remove_dir", "create_dir", "set_permissions", "::symlink(", "hard_link(", "write!("];
const READ_ONLY_SCRIPTS: &[&str] = &["fm-fleet-snapshot.sh", "fm-afk-contract.sh", "fm-project-mode.sh", "fm-capacity.sh"];
const SCRIPT_FILE: &str = "crew/firstmate.rs";
/// `ssh` and its kin as a program: a literal that is the bare name or ends in `/name`. `"ssh://"` and words are not.
const SSH_NAMES: &[&str] = &["\"ssh\"", "/ssh\"", "\"scp\"", "/scp\"", "\"sftp\"", "/sftp\""];
const SHELL_STRINGS: &[&str] = &["\"sh\"", "\"bash\"", "\"zsh\"", "\"-c\"", "\"-lc\"", "sh -c"];
const DOOR_FILE: &str = "remote.rs";

/// A file's code: everything before its `#[cfg(test)]` module, without comment lines and trailing ` // ` comments.
fn code_of(text: &str) -> Vec<(usize, String)> {
    let body = text.split("\n#[cfg(test)]").next().unwrap_or("");
    body.lines()
        .enumerate()
        .filter(|(_, l)| !l.trim_start().starts_with("//"))
        .map(|(i, l)| (i + 1, l.split(" // ").next().unwrap_or("").to_string()))
        .collect()
}

/// Every `fm-<name>.sh` in a line.
fn scripts_in(line: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = line;
    while let Some(at) = rest.find("fm-") {
        let tail = &rest[at..];
        let name: String = tail.chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.')).collect();
        if let Some(end) = name.find(".sh") {
            found.push(name[..end + 3].to_string());
        }
        rest = &tail[3..];
    }
    found
}

/// What the guards find in `files` (a path relative to `src/`, and the file's text).
fn violations(files: &[(String, String)]) -> Vec<String> {
    let mut out = Vec::new();
    for (path, text) in files {
        let crew = path.starts_with("crew/") || path.starts_with("readers/crew/");
        let typing_scope = crew || path == "herdr.rs";
        // Crew marks read the crew's checkouts, and never write one (ADR 0019).
        let writes_scope = crew || path == "reader/changes/crew.rs";
        for (n, line) in code_of(text) {
            if typing_scope {
                for bad in TYPING.iter().filter(|b| line.contains(*b)) {
                    out.push(format!("{path}:{n}: types into a pane ({bad})"));
                }
            }
            if writes_scope {
                for bad in WRITES.iter().filter(|b| line.contains(*b)) {
                    out.push(format!("{path}:{n}: writes a file ({bad})"));
                }
            }
            if path == DOOR_FILE {
                for bad in SHELL_STRINGS.iter().filter(|b| line.contains(*b)) {
                    out.push(format!("{path}:{n}: builds a shell string at the door ({bad})"));
                }
            } else {
                for bad in SSH_NAMES.iter().filter(|b| line.contains(*b)) {
                    out.push(format!("{path}:{n}: runs ssh outside {DOOR_FILE} ({bad})"));
                }
            }
            for script in scripts_in(&line) {
                if !READ_ONLY_SCRIPTS.contains(&script.as_str()) {
                    out.push(format!("{path}:{n}: names {script}, which Kinas never runs"));
                } else if path != SCRIPT_FILE {
                    out.push(format!("{path}:{n}: names {script} outside {SCRIPT_FILE}"));
                }
            }
        }
    }
    out
}

fn crate_sources() -> Vec<(String, String)> {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    let mut stack = vec![src.clone()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path: PathBuf = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs") {
                let rel = path.strip_prefix(&src).unwrap().to_string_lossy().replace('\\', "/");
                // This file names what it forbids.
                if rel != "readers/crew/guard.rs" {
                    files.push((rel, std::fs::read_to_string(&path).unwrap()));
                }
            }
        }
    }
    files
}

#[test]
fn no_typing_no_writes_four_scripts() {
    let files = crate_sources();
    for scope in ["crew/launch.rs", "crew/firstmate.rs", "readers/crew/mirror.rs", "herdr.rs", "reader/changes/crew.rs", DOOR_FILE] {
        assert!(files.iter().any(|(p, t)| p == scope && t.len() > 500), "the guard is not reading {scope}");
    }
    assert_eq!(violations(&files), Vec::<String>::new());
}

#[test]
fn the_guards_find_what_is_planted() {
    let planted = |path: &str, line: &str| vec![(path.to_string(), format!("fn f() {{\n    {line}\n}}\n"))];
    for (path, line) in [
        ("crew/launch.rs", r#"run(&["pane", "send-text", pane, "claude"]);"#),
        ("herdr.rs", r#"run(&["pane", "send-keys", pane, "Enter"]);"#),
        ("readers/crew/mod.rs", r#"Command::new("sh").args(["sh", "-c", line]);"#),
        ("crew/answer.rs", "session.pty_write(bytes);"),
        ("crew/home.rs", r#"std::fs::write(home.join("state/x"), "");"#),
        ("readers/crew/mirror.rs", "let f = OpenOptions::new().append(true).open(p);"),
        ("crew/config.rs", "std::fs::create_dir_all(home.join(\"data\"));"),
        ("reader/changes/crew.rs", r#"std::fs::write(worktree.join("notes.md"), "");"#),
        ("crew/answer.rs", r#"script(home, "fm-send.sh", &[task, text]);"#),
        ("lib.rs", r#"let hold = "fm-captain-hold.sh";"#),
        ("crew/firstmate.rs", r#"script(home, "fm-park.sh", &["tick"], LIMIT)"#),
        ("crew/launch.rs", r#"let s = home.join("bin/fm-fleet-snapshot.sh");"#),
        ("crew/launch.rs", r#"Command::new("ssh").arg(target);"#),
        ("pty.rs", r#"const SSH: &str = "/usr/bin/ssh";"#),
        ("readers/crew/mod.rs", r#"run(&["scp", from, to]);"#),
        ("remote.rs", r#"let a = [target, "-c", line];"#),
        ("remote.rs", r#"Command::new("bash").arg(script);"#),
    ] {
        assert_eq!(violations(&planted(path, line)).len(), 1, "{path}: {line}");
    }
    // Comments and test modules are not code; the four scripts in their one file are allowed.
    let fine = vec![
        ("crew/firstmate.rs".to_string(), "// not fm-send.sh, never\nfn a() { script(h, \"fm-project-mode.sh\", &[]) }\n#[cfg(test)]\nmod t { fn b() { std::fs::write(p, \"\"); } }\n".to_string()),
        ("crew/pin.rs".to_string(), "const A: u8 = 1; // COMMON_TOOLS, fm-bootstrap.sh:909\n".to_string()),
        // The door itself names ssh; a URL's scheme and a sentence are not a program.
        ("remote.rs".to_string(), "const SSH: &str = \"/usr/bin/ssh\";\nfn d(p: &Path) { p.join(\"ssh\"); }\n".to_string()),
        ("crew/repo.rs".to_string(), "fn u(s: &str) { s.strip_prefix(\"ssh://\"); }\n".to_string()),
        ("place.rs".to_string(), "const H: &str = \"Write it as user@host, host, or an ssh alias.\";\n".to_string()),
    ];
    assert_eq!(violations(&fine), Vec::<String>::new());
}
