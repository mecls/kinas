//! What "installed" means for the crew (build spec §9): Firstmate's repository and pinned commit, the folder its home
//! takes under Kinas's data directory, Firstmate's own workspace label, and the tools at their exact versions with
//! Firstmate's floors (`fm-bootstrap.sh:929-939`, `fm-tasks-axi-lib.sh:59`, `fm-quota-axi-lib.sh:21` at the pin).
//! Mirrored in `packages/commands/src/crew-tools.ts`. Moving the pin moves tool floors too, so it is the captain's
//! decision, never a side effect.

/// Where `kinas crew setup` clones from (`cli/src/crew-setup.ts`). The app never clones: here it is held to the CLI's
/// twin by `equals_the_shared_fixture`, its only reader.
#[cfg_attr(not(test), allow(dead_code))]
pub const FIRSTMATE_REPO: &str = "https://github.com/kunchenguid/firstmate";
pub const FIRSTMATE_PIN: &str = "427056c4181c41074ad24f051f79919330df0fa5"; // 2026-11-12; reviewed monthly (ADR 0020)
pub const HOME_DIR: &str = "firstmate"; // under paths::data_dir()
pub const WORKSPACE_LABEL: &str = "firstmate"; // Firstmate's own, backends/herdr.sh:360-369
pub struct Tool {
    pub name: &'static str,
    pub version: &'static str,
    pub floor: &'static str,
    pub required: bool,
    pub source: Source,
}
pub enum Source {
    Npm,
    /// The app probes a release tool's `--version` and never installs one: what to download and its checksum are the
    /// CLI's (`kinas crew setup`), held to it here by `equals_the_shared_fixture`, their only reader in the app.
    #[cfg_attr(not(test), allow(dead_code))]
    GithubRelease { repo: &'static str, asset: &'static str, sha256: &'static str },
}
#[rustfmt::skip]
pub const TOOLS: &[Tool] = &[
  Tool { name: "treehouse",           version: "2.3.0",  floor: "lease",  required: true,  source: Source::GithubRelease { repo: "kunchenguid/treehouse",   asset: "treehouse-v2.3.0-darwin-arm64.tar.gz",   sha256: "1cb09bcfa830b4eec5e54beeaa71589adb9c5d828573dda0f5150e2d80cf13d5" } },
  Tool { name: "no-mistakes",         version: "1.79.0", floor: "1.46.0", required: true,  source: Source::GithubRelease { repo: "kunchenguid/no-mistakes", asset: "no-mistakes-v1.79.0-darwin-arm64.tar.gz", sha256: "80c2f4b9b3d01cb5d60ca294226b41d7331408e6e5cf0400a576cf3ec25166d7" } },
  Tool { name: "gh-axi",              version: "0.1.35", floor: "0.1.29", required: true,  source: Source::Npm },
  Tool { name: "tasks-axi",           version: "0.2.6",  floor: "0.2.6",  required: true,  source: Source::Npm },
  Tool { name: "quota-axi",           version: "0.1.51", floor: "0.1.51", required: true,  source: Source::Npm },
  Tool { name: "chrome-devtools-axi", version: "0.1.35", floor: "0",      required: true,  source: Source::Npm }, // COMMON_TOOLS, fm-bootstrap.sh:909
  Tool { name: "lavish-axi",          version: "0.1.80", floor: "0.1.80", required: false, source: Source::Npm },
];
pub const PREREQS: &[&str] = &["git", "gh", "node", "npm", "jq", "python3", "perl", "herdr", "claude"];

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    /// The CLI spells the same list out in `packages/commands/src/crew-tools.ts`; this fixture holds the two equal.
    #[test]
    fn equals_the_shared_fixture() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/crew-tools.json");
        let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(
            fixture["firstmate"],
            json!({ "repo": FIRSTMATE_REPO, "pin": FIRSTMATE_PIN, "home_dir": HOME_DIR, "workspace_label": WORKSPACE_LABEL })
        );
        let tools: Vec<Value> = TOOLS
            .iter()
            .map(|t| {
                let source = match &t.source {
                    Source::Npm => json!("npm"),
                    Source::GithubRelease { repo, asset, sha256 } => json!({ "repo": repo, "asset": asset, "sha256": sha256 }),
                };
                json!({ "name": t.name, "version": t.version, "floor": t.floor, "required": t.required, "source": source })
            })
            .collect();
        assert_eq!(fixture["tools"], Value::Array(tools));
        assert_eq!(fixture["prereqs"], json!(PREREQS));
    }
}
