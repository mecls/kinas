//! The crew's code-grep guards (build spec §6.1–§6.3, §11.4 `guard::no_typing_no_writes_three_scripts`; the precedent is
//! `readers/hostinger/mod.rs`'s GET-only guard). They read this crate's own source and fail when:
//! - `crew/`, `readers/crew/` or `herdr.rs` could type into a pane — `send-text`, `send-keys`, a shell string, the PTY's
//!   write (ADR 0003);
//! - `crew/` or `readers/crew/` could write a file — under Firstmate's home above all (ADR 0016);
//! - any code names a Firstmate script but the three read-only ones, or names one outside `crew/firstmate.rs`, the only
//!   file that builds a path under `<home>/bin/` — `fm-send.sh` above all (slice 0's finding).
//!
//! Test modules and comments are not code here: a test may write a fixture, and a comment may say what is never run.
//! The negative control plants each forbidden thing in a string and proves the guard finds it.

#![cfg(test)]

use std::path::{Path, PathBuf};

const TYPING: &[&str] = &["send-text", "send-keys", "\"sh\", \"-c\"", "sh -c", "pty_write", "Session::write", ".write_all("];
const WRITES: &[&str] = &["File::create", "OpenOptions", "fs::write", "fs::rename", "fs::copy", "remove_file", "remove_dir", "create_dir", "set_permissions"];
const READ_ONLY_SCRIPTS: &[&str] = &["fm-fleet-snapshot.sh", "fm-afk-contract.sh", "fm-project-mode.sh"];
const SCRIPT_FILE: &str = "crew/firstmate.rs";

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
        for (n, line) in code_of(text) {
            if typing_scope {
                for bad in TYPING.iter().filter(|b| line.contains(*b)) {
                    out.push(format!("{path}:{n}: types into a pane ({bad})"));
                }
            }
            if crew {
                for bad in WRITES.iter().filter(|b| line.contains(*b)) {
                    out.push(format!("{path}:{n}: writes a file ({bad})"));
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
fn no_typing_no_writes_three_scripts() {
    let files = crate_sources();
    for scope in ["crew/launch.rs", "crew/firstmate.rs", "readers/crew/mirror.rs", "herdr.rs"] {
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
        ("crew/answer.rs", r#"script(home, "fm-send.sh", &[task, text]);"#),
        ("lib.rs", r#"let hold = "fm-captain-hold.sh";"#),
        ("crew/launch.rs", r#"let s = home.join("bin/fm-fleet-snapshot.sh");"#),
    ] {
        assert_eq!(violations(&planted(path, line)).len(), 1, "{path}: {line}");
    }
    // Comments and test modules are not code; the three scripts in their one file are allowed.
    let fine = vec![
        ("crew/firstmate.rs".to_string(), "// not fm-send.sh, never\nfn a() { script(h, \"fm-project-mode.sh\", &[]) }\n#[cfg(test)]\nmod t { fn b() { std::fs::write(p, \"\"); } }\n".to_string()),
        ("crew/pin.rs".to_string(), "const A: u8 = 1; // COMMON_TOOLS, fm-bootstrap.sh:909\n".to_string()),
    ];
    assert_eq!(violations(&fine), Vec::<String>::new());
}
