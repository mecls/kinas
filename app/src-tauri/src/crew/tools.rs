//! The crew's tool health (build spec §4 Settings, §9): whether each tool of `pin::TOOLS` is installed at or above its
//! floor, whether the prerequisites are there and `gh` is signed in, and where Firstmate's clone stands. Found on the
//! login shell's `PATH` without running a shell; a release tool is asked `--version`, an npm tool's version is read from
//! the `package.json` its command links to — so no npm tool, and never `quota-axi`, is run (ADR 0016). Every probe has
//! 5 s. The answer is kept 60 s; "Refresh readings" clears it.

use super::home::{pin_state, PinState};
use super::pin::{Source, Tool, PREREQS, TOOLS};
use crate::login_path::login_path;
use crate::proc::{self, Run};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const PROBE_LIMIT: Duration = Duration::from_secs(5);
const CACHE_MS: i64 = 60_000;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ToolState {
    pub name: &'static str,
    /// The pinned version; "—" for a prerequisite, which has none.
    pub pinned: &'static str,
    pub installed: Option<String>,
    /// DESIGN.md 1.4's words: "installed" | "below_floor" | "missing".
    pub state: &'static str,
    pub required: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct Health {
    pub tools: Vec<ToolState>,
    pub prereqs: Vec<ToolState>,
    /// None when `gh` itself is missing.
    pub gh_signed_in: Option<bool>,
    pub pin: PinState,
    pub checked_at: i64,
}

static CACHE: Mutex<Option<(PathBuf, Health)>> = Mutex::new(None);

/// The health of the home's install, at most 60 s old, and whether it was probed just now.
pub(crate) fn health(home: &Path, now: i64) -> (Health, bool) {
    {
        let cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((cached_home, h)) = cache.as_ref() {
            if cached_home == home && now - h.checked_at < CACHE_MS {
                return (h.clone(), false);
            }
        }
    }
    let fresh = probe(home, now);
    *CACHE.lock().unwrap_or_else(|p| p.into_inner()) = Some((home.to_path_buf(), fresh.clone()));
    (fresh, true)
}

/// The cached health when there is one, without probing: for readers that must stay cheap.
pub(crate) fn cached(home: &Path) -> Option<Health> {
    let cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
    cache.as_ref().filter(|(h, _)| h == home).map(|(_, health)| health.clone())
}

/// "Refresh readings": the next `health` probes again.
pub(crate) fn clear() {
    *CACHE.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

/// The first required tool that is not installed at or above its floor: what blocks the launch.
pub(crate) fn first_missing_required(h: &Health) -> Option<&'static str> {
    h.tools.iter().find(|t| t.required && t.state != "installed").map(|t| t.name)
}

fn probe(home: &Path, now: i64) -> Health {
    let path = login_path();
    let tools = TOOLS.iter().map(|t| tool_state(t, path)).collect();
    let prereqs = PREREQS
        .iter()
        .map(|name| {
            let found = which(name, path).is_some();
            ToolState { name, pinned: "—", installed: None, state: if found { "installed" } else { "missing" }, required: true }
        })
        .collect();
    let gh_signed_in = which("gh", path).map(|gh| run(&gh, &["auth", "status"], path).is_some_and(|r| r.ok()));
    Health { tools, prereqs, gh_signed_in, pin: pin_state(home), checked_at: now }
}

fn tool_state(tool: &'static Tool, path: &str) -> ToolState {
    let found = which(tool.name, path);
    let installed = found.as_ref().and_then(|bin| match tool.source {
        Source::Npm => npm_version(bin, tool.name),
        Source::GithubRelease { .. } => run(bin, &["--version"], path).and_then(|r| version_in(&format!("{}\n{}", r.stdout, r.last_err.unwrap_or_default()))),
    });
    let meets = match (&installed, found.as_ref()) {
        (Some(_), Some(bin)) if tool.floor == "lease" => run(bin, &["get", "--help"], path).is_some_and(|r| r.stdout.contains("--lease")),
        (Some(v), _) => at_least(v, tool.floor),
        _ => false,
    };
    let state = match (&installed, meets) {
        (None, _) => "missing",
        (Some(_), true) => "installed",
        (Some(_), false) => "below_floor",
    };
    ToolState { name: tool.name, pinned: tool.version, installed, state, required: tool.required }
}

fn run(bin: &Path, args: &[&str], path: &str) -> Option<proc::Ran> {
    proc::run(&Run { program: bin, args, cwd: None, set: &[("PATH", path)], limit: PROBE_LIMIT }).ok()
}

/// A command on `path`, found without running anything: the first executable file of that name.
pub(crate) fn which(name: &str, path: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    path.split(':')
        .filter(|d| !d.is_empty())
        .map(|d| Path::new(d).join(name))
        .find(|p| std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0))
}

/// An npm tool's version, from the `package.json` its command links to, found by walking up from the linked file.
fn npm_version(bin: &Path, name: &str) -> Option<String> {
    let real = std::fs::canonicalize(bin).ok()?;
    real.ancestors().skip(1).take(6).find_map(|dir| {
        let text = std::fs::read_to_string(dir.join("package.json")).ok()?;
        let pkg: serde_json::Value = serde_json::from_str(&text).ok()?;
        (pkg.get("name")?.as_str()? == name).then(|| pkg.get("version")?.as_str().map(str::to_string))?
    })
}

/// The first `major.minor.patch` in a version line (`no-mistakes version v1.79.0 (fc540ac)` → `1.79.0`).
fn version_in(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    (0..bytes.len()).find_map(|i| {
        if !text.is_char_boundary(i) || (i > 0 && bytes[i - 1].is_ascii_digit()) {
            return None;
        }
        let rest = &text[i..];
        let mut parts = rest.splitn(3, '.');
        let (a, b, c) = (parts.next()?, parts.next()?, parts.next()?);
        let c: String = c.chars().take_while(char::is_ascii_digit).collect();
        let ok = |s: &str| !s.is_empty() && s.chars().all(|ch| ch.is_ascii_digit());
        (ok(a) && ok(b) && ok(&c)).then(|| format!("{a}.{b}.{c}"))
    })
}

/// `version` at or above `floor`; a floor of "0" is any version, an unparseable version is below.
fn at_least(version: &str, floor: &str) -> bool {
    if floor == "0" {
        return true;
    }
    let parse = |v: &str| -> Option<[u64; 3]> {
        let mut it = v.split('.').map(|p| p.parse::<u64>().ok());
        let parts = [it.next()??, it.next()??, it.next()??];
        it.next().is_none().then_some(parts)
    };
    match (parse(version), parse(floor)) {
        (Some(v), Some(f)) => v >= f,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_the_first_triple() {
        assert_eq!(version_in("no-mistakes version v1.79.0 (fc540ac) 2026-09-19T09:34:44Z").as_deref(), Some("1.79.0"));
        assert_eq!(version_in("v2.3.0\n").as_deref(), Some("2.3.0"));
        assert_eq!(version_in("build 12 of 3.4.5").as_deref(), Some("3.4.5"));
        assert_eq!(version_in("1.2").as_deref(), None);
        assert_eq!(version_in("unknown"), None);
        assert_eq!(version_in("gh-axi — 0.1.35").as_deref(), Some("0.1.35"));
    }

    #[test]
    fn floors_compare_numerically() {
        assert!(at_least("0.1.35", "0.1.29"));
        assert!(at_least("0.1.29", "0.1.29"));
        assert!(!at_least("0.1.28", "0.1.29"));
        assert!(at_least("0.10.0", "0.9.9"));
        assert!(at_least("anything", "0"));
        assert!(!at_least("dev", "0.1.0"));
    }

    fn script(path: &Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// A stub PATH: two release tools answering `--version`, npm tools linked to their package.json, one tool missing,
    /// one below its floor. The npm tools' scripts exit 99, so a probe that ran one would read nothing.
    #[test]
    fn tools_are_probed_without_running_an_npm_tool() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        script(&bin.join("treehouse"), r#"if [ "$1" = get ]; then echo "  --lease"; else echo v2.3.0; fi"#);
        script(&bin.join("no-mistakes"), "echo no-mistakes version v1.40.0");
        for (name, version) in [("gh-axi", "0.1.35"), ("quota-axi", "0.1.49"), ("chrome-devtools-axi", "0.1.35"), ("lavish-axi", "0.1.76")] {
            let pkg = dir.path().join("lib/node_modules").join(name);
            std::fs::create_dir_all(pkg.join("dist/bin")).unwrap();
            std::fs::write(pkg.join("package.json"), format!(r#"{{"name":"{name}","version":"{version}"}}"#)).unwrap();
            script(&pkg.join("dist/bin").join(format!("{name}.js")), "exit 99");
            std::os::unix::fs::symlink(pkg.join("dist/bin").join(format!("{name}.js")), bin.join(name)).unwrap();
        }
        let path = format!("{}:/usr/bin:/bin", bin.display());
        let states: Vec<(&str, Option<String>, &str)> = TOOLS.iter().map(|t| tool_state(t, &path)).map(|s| (s.name, s.installed, s.state)).collect();
        assert_eq!(
            states,
            vec![
                ("treehouse", Some("2.3.0".into()), "installed"),
                ("no-mistakes", Some("1.40.0".into()), "below_floor"),
                ("gh-axi", Some("0.1.35".into()), "installed"),
                ("tasks-axi", None, "missing"),
                ("quota-axi", Some("0.1.49".into()), "installed"),
                ("chrome-devtools-axi", Some("0.1.35".into()), "installed"),
                ("lavish-axi", Some("0.1.76".into()), "installed"),
            ]
        );
        let h = Health { tools: TOOLS.iter().map(|t| tool_state(t, &path)).collect(), prereqs: vec![], gh_signed_in: None, pin: PinState::Missing, checked_at: 0 };
        assert_eq!(first_missing_required(&h), Some("no-mistakes"));
    }
}
