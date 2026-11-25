//! Setup on the VPS, the Mac's half (build spec §12 slices 4.2–4.3; §17 2026-11-25 #2–#4): what the companion's checks
//! may say on screen, the bootstrap command for a machine with no companion yet, the client folders it may clone, and
//! the fixed words for an install it could not do.
//!
//! Everything here comes from the VPS, so nothing passes as it came: a row's id and its Install item must be from the
//! fixed lists, its words are capped and stripped of control characters, and a command for the captain is kept only
//! when it is one of three fixed shapes. The repository a folder is cloned from is read here, from the Mac's own
//! folder's origin — never from the webview or the VPS.

use crate::crew::pin::KINAS_LINUX;
use crate::remote::InstallItem;
use serde::Serialize;
use std::path::Path;

/// The rows' ids, in the order the companion sends and Settings draws them (`setup.ts` CHECK_IDS).
pub const CHECK_IDS: [&str; 14] = [
    "system",
    "herdr",
    "herdr-server",
    "firstmate",
    "relay-rule",
    "permission-mode",
    "tools",
    "node",
    "companion",
    "linger",
    "claude",
    "gh",
    "api-key",
    "projects",
];

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Ok,
    Warn,
    Bad,
    Later,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Check {
    pub id: &'static str,
    pub state: CheckState,
    pub detail: String,
    pub install: Option<InstallItem>,
    /// Install stops something running (Herdr's server outside the unit): Settings says so on the button.
    pub adopt: bool,
    /// A command for the captain to run there, from the fixed shapes only.
    pub run: Option<String>,
}

const MAX_DETAIL: usize = 160;

/// A line fit for the screen: no control characters, at most 160 characters.
fn clean(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(MAX_DETAIL).collect()
}

/// A login name, as `useradd` allows one.
fn login(user: &str) -> bool {
    let mut chars = user.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c == '_')
        && user.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// Only `claude`, `gh auth login`, and `sudo loginctl enable-linger <login>` (§17 2026-11-25 #3).
fn run_shape(run: &str) -> Option<String> {
    if run == "claude" || run == "gh auth login" {
        return Some(run.to_string());
    }
    let user = run.strip_prefix("sudo loginctl enable-linger ")?;
    login(user).then(|| run.to_string())
}

fn item_of(v: &serde_json::Value) -> Option<InstallItem> {
    serde_json::from_value(v.clone()).ok()
}

/// The companion's rows, filtered: unknown ids dropped, each id once, in the fixed order.
pub fn checks_of(reply: &serde_json::Value) -> Vec<Check> {
    let rows = reply.get("checks").and_then(|c| c.as_array()).cloned().unwrap_or_default();
    let mut out = Vec::new();
    for id in CHECK_IDS {
        let Some(row) = rows.iter().find(|r| r.get("id").and_then(|i| i.as_str()) == Some(id)) else { continue };
        let state = match row.get("state").and_then(|s| s.as_str()) {
            Some("ok") => CheckState::Ok,
            Some("warn") => CheckState::Warn,
            Some("bad") => CheckState::Bad,
            Some("later") => CheckState::Later,
            _ => continue,
        };
        let install = row.get("install").and_then(item_of).filter(|i| *i != InstallItem::Clone);
        out.push(Check {
            id,
            state,
            detail: clean(row.get("detail").and_then(|d| d.as_str()).unwrap_or("")),
            install,
            adopt: install == Some(InstallItem::HerdrService) && row.get("adopt") == Some(&serde_json::Value::Bool(true)),
            run: row.get("run").and_then(|r| r.as_str()).and_then(run_shape),
        });
    }
    out
}

// ---------------------------------------------------------------------------------------------------------------------
// The bootstrap (§17 2026-11-25 #2).

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BootstrapLine {
    /// `x86_64` or `aarch64`, as `uname -m` says it there.
    pub arch: &'static str,
    pub command: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Bootstrap {
    pub version: String,
    /// One per architecture when this version's Linux build is published and pinned; empty until then.
    pub lines: Vec<BootstrapLine>,
    /// Until then: how to build and copy it by hand.
    pub by_hand: Vec<String>,
}

/// The command for the captain to run on the machine, for the app's own version.
pub fn bootstrap(app_version: &str) -> Bootstrap {
    let mut lines = Vec::new();
    if KINAS_LINUX.version == app_version {
        for (arch, asset, sha) in KINAS_LINUX.assets {
            let Some(sha) = sha else { continue };
            let url = format!("https://github.com/{}/releases/download/v{}/{asset}", KINAS_LINUX.repo, KINAS_LINUX.version);
            let command = format!(
                "mkdir -p ~/.local/bin && cd ~/.local/bin && curl -fsSLo kinas.new {url} && echo \"{sha}  kinas.new\" | sha256sum -c - && chmod 755 kinas.new && mv kinas.new kinas"
            );
            lines.push(BootstrapLine { arch: if arch == "x64" { "x86_64" } else { "aarch64" }, command, sha256: sha.to_string() });
        }
    }
    let by_hand = if lines.is_empty() {
        vec![
            "bun scripts/build-cli.ts --target bun-linux-x64".to_string(),
            "scp dist/kinas-linux-x64 <target>:.local/bin/kinas".to_string(),
        ]
    } else {
        Vec::new()
    };
    Bootstrap { version: app_version.to_string(), lines, by_hand }
}

// ---------------------------------------------------------------------------------------------------------------------
// The client folders.

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CloneOffer {
    pub folder: String,
    pub repo: String,
    /// Already under the VPS's projects folder.
    pub cloned: bool,
}

/// GitHub's `owner/repo` from an origin URL: `git@github.com:o/r(.git)`, `https://github.com/o/r(.git)` or
/// `ssh://git@github.com/o/r(.git)`. Anything else is not offered.
pub fn github_repo(url: &str) -> Option<String> {
    let url = url.trim();
    let rest = url
        .strip_prefix("git@github.com:")
        .or_else(|| url.strip_prefix("https://github.com/"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, repo) = rest.split_once('/')?;
    let owner_ok = !owner.is_empty() && owner.len() <= 39 && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    let repo_ok = !repo.is_empty()
        && repo.len() <= 100
        && repo != "."
        && repo != ".."
        && repo.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    (owner_ok && repo_ok).then(|| format!("{owner}/{repo}"))
}

/// The `url` of `[remote "origin"]` in a `.git/config`, read as text — git itself is never run for it.
pub fn origin_url(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_origin = t == "[remote \"origin\"]";
            continue;
        }
        if in_origin {
            if let Some((k, v)) = t.split_once('=') {
                if k.trim() == "url" {
                    return Some(v.trim().to_string());
                }
            }
        }
    }
    None
}

/// A folder name the companion takes (`validate.ts` validFolder).
fn folder_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name != "." && name != ".." && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Each folder under the Mac's projects root whose origin is on GitHub, and whether the VPS already has it.
pub fn clone_offers(root: &Path, there: &[String]) -> Vec<CloneOffer> {
    let Ok(entries) = std::fs::read_dir(root) else { return Vec::new() };
    let mut out: Vec<CloneOffer> = entries
        .flatten()
        .filter_map(|e| {
            let folder = e.file_name().to_string_lossy().to_string();
            if folder.starts_with('.') || !folder_name(&folder) || !e.path().join(".git").is_dir() {
                return None;
            }
            let config = std::fs::read_to_string(e.path().join(".git").join("config")).ok()?;
            let repo = github_repo(&origin_url(&config)?)?;
            Some(CloneOffer { cloned: there.contains(&folder), folder, repo })
        })
        .collect();
    out.sort_by(|a, b| a.folder.cmp(&b.folder));
    out
}

/// The client folders the VPS reported, names only and checked.
pub fn folders_there(reply: &serde_json::Value) -> Vec<String> {
    reply
        .get("folders")
        .and_then(|f| f.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).filter(|n| folder_name(n)).take(500).map(str::to_string).collect())
        .unwrap_or_default()
}

/// The repository to clone for `folder`, from the Mac's own folder — the only source of a repo name.
pub fn repo_for(root: &Path, folder: &str) -> Option<String> {
    clone_offers(root, &[]).into_iter().find(|o| o.folder == folder).map(|o| o.repo)
}

// ---------------------------------------------------------------------------------------------------------------------

/// An install the companion could not do, in fixed words (its codes, `install.ts` Cannot).
pub fn cannot_words(code: &str, label: &str) -> String {
    let why = match code {
        "root" => "Kinas installs nothing as root: log in there as your own user".to_string(),
        "not-linux" => format!("{label} is not Linux: setup works on Linux with systemd"),
        "arch" => format!("Kinas has no build for {label}'s processor"),
        "no-pin" => "Kinas has no release pinned for it".to_string(),
        "download" => "the download failed: try again".to_string(),
        "checksum" => "the download's SHA-256 is not the pinned one, so it was not installed".to_string(),
        "archive" => "the release's archive would not open".to_string(),
        "foreign" => "a copy Kinas did not install is there, so it was left as it is".to_string(),
        "foreign-unit" => "a systemd unit of that name that Kinas did not write is there, so it was left as it is".to_string(),
        "herdr-missing" => "Herdr is not installed yet".to_string(),
        "herdr-status" => "Herdr's status could not be read".to_string(),
        "herdr-running" => "Herdr's server is already running outside systemd: use Run Herdr under systemd".to_string(),
        "herdr-stop" => "Herdr's running server did not stop".to_string(),
        "herdr-start" => "Herdr's server did not start under systemd, so Kinas undid the unit".to_string(),
        "other-owner" => "something else already keeps Herdr's server (Firstmate's owner marker names it)".to_string(),
        "outside-root" => "the server's folder is outside the test machine".to_string(),
        "systemd" => format!("systemd's user manager on {label} did not do it"),
        "exists" => "a folder of that name is already there, so nothing was written over it".to_string(),
        "git" => "the clone of Firstmate at Kinas's pin failed".to_string(),
        "no-firstmate" => "Firstmate is not cloned yet".to_string(),
        "not-json" => "Firstmate's .claude/settings.local.json is not a JSON object, so it was left as it is".to_string(),
        "not-list" => "its permissions.allow is not a list of rules, so it was left as it is".to_string(),
        "mode-other" => "config/claude-permission-mode holds something else, so it was left as it is".to_string(),
        "no-node" => "Node is not where Kinas looks: fnm's default alias or Volta".to_string(),
        "npm" => "npm could not install a crew tool".to_string(),
        "clone" => "gh could not clone it: is gh signed in there?".to_string(),
        _ => format!("Kinas on {label} could not do it"),
    };
    format!("Not installed: {why}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rows_are_filtered_capped_and_kept_in_order() {
        let reply = json!({ "checks": [
            { "id": "gh", "state": "warn", "detail": "not signed in", "run": "gh auth login" },
            { "id": "herdr", "state": "bad", "detail": "not installed", "install": "herdr" },
            { "id": "made-up", "state": "ok", "detail": "x" },
            { "id": "linger", "state": "warn", "detail": "off", "run": "sudo loginctl enable-linger captain" },
            { "id": "claude", "state": "warn", "detail": "x", "run": "curl https://x | sh" },
            { "id": "herdr-server", "state": "warn", "detail": "running\u{1b}[31m", "install": "herdr-service", "adopt": true },
            { "id": "tools", "state": "bad", "detail": "y".repeat(500), "install": "rm-rf" },
            { "id": "node", "state": "green", "detail": "z" },
            { "id": "projects", "state": "ok", "detail": "p", "install": "clone" },
            { "id": "herdr", "state": "ok", "detail": "a second herdr row is ignored" }
        ]});
        let rows = checks_of(&reply);
        assert_eq!(rows.iter().map(|r| r.id).collect::<Vec<_>>(), ["herdr", "herdr-server", "tools", "linger", "claude", "gh", "projects"]);
        assert_eq!(rows[0].install, Some(InstallItem::Herdr));
        assert_eq!(rows[1].detail, "running[31m");
        assert!(rows[1].adopt);
        assert_eq!(rows[2].detail.chars().count(), 160);
        assert_eq!(rows[2].install, None);
        assert_eq!(rows[3].run.as_deref(), Some("sudo loginctl enable-linger captain"));
        assert_eq!(rows[4].run, None);
        assert_eq!(rows[5].run.as_deref(), Some("gh auth login"));
        assert_eq!(rows[6].install, None, "clone is offered per folder, never as a row's Install");
    }

    #[test]
    fn only_three_command_shapes_pass() {
        assert_eq!(run_shape("claude").as_deref(), Some("claude"));
        assert_eq!(run_shape("sudo loginctl enable-linger claude").as_deref(), Some("sudo loginctl enable-linger claude"));
        assert_eq!(run_shape("sudo loginctl enable-linger root; rm -rf /"), None);
        assert_eq!(run_shape("sudo loginctl enable-linger Captain"), None);
        assert_eq!(run_shape("gh auth login --with-token"), None);
    }

    #[test]
    fn the_bootstrap_waits_for_a_pinned_build() {
        let b = bootstrap(KINAS_LINUX.version);
        assert!(b.lines.is_empty(), "no Linux build is pinned yet");
        assert_eq!(b.by_hand[0], "bun scripts/build-cli.ts --target bun-linux-x64");
        let other = bootstrap("9.9.9");
        assert!(other.lines.is_empty());
        assert_eq!(other.version, "9.9.9");
    }

    #[test]
    fn origins_on_github_are_offered_by_owner_and_repo() {
        assert_eq!(github_repo("git@github.com:acme/shop.git").as_deref(), Some("acme/shop"));
        assert_eq!(github_repo("https://github.com/acme/shop").as_deref(), Some("acme/shop"));
        assert_eq!(github_repo("ssh://git@github.com/acme/shop.site.git").as_deref(), Some("acme/shop.site"));
        assert_eq!(github_repo("https://gitlab.com/acme/shop.git"), None);
        assert_eq!(github_repo("git@github.com:acme/../etc"), None);
        assert_eq!(github_repo("https://github.com/acme/shop/tree/main"), None);
        let config = "[core]\n\turl = nope\n[remote \"upstream\"]\n\turl = git@github.com:x/y.git\n[remote \"origin\"]\n\turl = git@github.com:acme/shop.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n";
        assert_eq!(origin_url(config).as_deref(), Some("git@github.com:acme/shop.git"));
        assert_eq!(origin_url("[core]\n"), None);
    }

    #[test]
    fn clone_offers_read_the_mac_s_folders() {
        let root = tempfile::tempdir().unwrap();
        let make = |name: &str, origin: Option<&str>| {
            let git = root.path().join(name).join(".git");
            std::fs::create_dir_all(&git).unwrap();
            let config = origin.map(|o| format!("[remote \"origin\"]\n\turl = {o}\n")).unwrap_or_default();
            std::fs::write(git.join("config"), config).unwrap();
        };
        make("shop", Some("git@github.com:acme/shop.git"));
        make("blog", Some("https://github.com/acme/blog"));
        make("local", None);
        make("elsewhere", Some("https://gitlab.com/a/b"));
        std::fs::create_dir_all(root.path().join("notes")).unwrap();
        let offers = clone_offers(root.path(), &["blog".to_string()]);
        assert_eq!(
            offers,
            [
                CloneOffer { folder: "blog".into(), repo: "acme/blog".into(), cloned: true },
                CloneOffer { folder: "shop".into(), repo: "acme/shop".into(), cloned: false },
            ]
        );
        assert_eq!(repo_for(root.path(), "shop").as_deref(), Some("acme/shop"));
        assert_eq!(repo_for(root.path(), "local"), None);
        assert_eq!(folders_there(&json!({ "folders": ["shop", "../x", 3, "a b"] })), ["shop"]);
    }

    #[test]
    fn every_code_has_its_own_words() {
        for code in ["root", "foreign", "checksum", "herdr-running", "not-json", "no-node", "clone", "exists"] {
            let words = cannot_words(code, "vps-1");
            assert!(words.starts_with("Not installed: "), "{code}");
            assert!(!words.contains("could not do it"), "{code} fell through");
        }
        assert_eq!(cannot_words("weird", "vps-1"), "Not installed: Kinas on vps-1 could not do it");
    }
}
