//! What "installed" means for the crew (build spec §9): Firstmate's repository and pinned commit, the folder its home
//! takes under Kinas's data directory, Firstmate's own workspace label, and the tools at their exact versions with
//! Firstmate's floors (`fm-bootstrap.sh:909-926`, `fm-tasks-axi-lib.sh:45`, `fm-quota-axi-lib.sh:20` at the pin).
//! Mirrored in `packages/commands/src/crew-tools.ts`. Moving the pin moves tool floors too, so it is the captain's
//! decision, never a side effect.
// The tools and the launcher's constants are read from their slices on (2: setup and health; 3: the launcher).
#![allow(dead_code)]

pub const FIRSTMATE_REPO: &str = "https://github.com/kunchenguid/firstmate";
pub const FIRSTMATE_PIN: &str = "f9f74a1d91cc7e105ec3df2249eda4e07f9ba540"; // 2026-09-22; reviewed monthly
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
    GithubRelease { repo: &'static str, asset: &'static str, sha256: &'static str },
}
#[rustfmt::skip]
pub const TOOLS: &[Tool] = &[
  Tool { name: "treehouse",           version: "2.3.0",  floor: "lease",  required: true,  source: Source::GithubRelease { repo: "kunchenguid/treehouse",   asset: "treehouse-v2.3.0-darwin-arm64.tar.gz",   sha256: "1cb09bcfa830b4eec5e54beeaa71589adb9c5d828573dda0f5150e2d80cf13d5" } },
  Tool { name: "no-mistakes",         version: "1.79.0", floor: "1.46.0", required: true,  source: Source::GithubRelease { repo: "kunchenguid/no-mistakes", asset: "no-mistakes-v1.79.0-darwin-arm64.tar.gz", sha256: "80c2f4b9b3d01cb5d60ca294226b41d7331408e6e5cf0400a576cf3ec25166d7" } },
  Tool { name: "gh-axi",              version: "0.1.35", floor: "0.1.29", required: true,  source: Source::Npm },
  Tool { name: "tasks-axi",           version: "0.2.5",  floor: "0.2.4",  required: true,  source: Source::Npm },
  Tool { name: "quota-axi",           version: "0.1.49", floor: "0.1.29", required: true,  source: Source::Npm },
  Tool { name: "chrome-devtools-axi", version: "0.1.35", floor: "0",      required: true,  source: Source::Npm }, // COMMON_TOOLS, fm-bootstrap.sh:909
  Tool { name: "lavish-axi",          version: "0.1.76", floor: "0.1.46", required: false, source: Source::Npm },
];
pub const PREREQS: &[&str] = &["git", "gh", "node", "npm", "jq", "python3", "herdr", "claude"];
