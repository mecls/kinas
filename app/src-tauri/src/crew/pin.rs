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

/// The releases `kinas companion install` puts in `~/.local/bin` on a Linux machine (build spec §17 2026-11-25 #1),
/// mirrored here only to be held to the CLI's by the fixture: the app installs nothing on the VPS itself.
#[cfg(test)]
pub struct LinuxRelease {
    pub name: &'static str,
    pub version: &'static str,
    pub repo: &'static str,
    pub kind: &'static str,
    /// (asset, sha256) for x64, then arm64.
    pub assets: [(&'static str, &'static str); 2],
}
#[cfg(test)]
#[rustfmt::skip]
pub const LINUX_RELEASES: &[LinuxRelease] = &[
  LinuxRelease { name: "herdr",       version: "0.9.5",  repo: "herdrdev/herdr",          kind: "raw",    assets: [
    ("herdr-linux-x86_64",                     "14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d"),
    ("herdr-linux-aarch64",                    "17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c")] },
  LinuxRelease { name: "treehouse",   version: "2.3.0",  repo: "kunchenguid/treehouse",   kind: "tar.gz", assets: [
    ("treehouse-v2.3.0-linux-amd64.tar.gz",    "94fd2b2c20c35aac1ddc2941317890ad82c9916f5ccecbac4a50cda783eed10f"),
    ("treehouse-v2.3.0-linux-arm64.tar.gz",    "408589ba72b58d5e942071ed863a83fd96566cfd1e514945daa59defde528bbb")] },
  LinuxRelease { name: "no-mistakes", version: "1.79.0", repo: "kunchenguid/no-mistakes", kind: "tar.gz", assets: [
    ("no-mistakes-v1.79.0-linux-amd64.tar.gz", "d178c8a5134763b8e5f6d82545a3a76285fbbcdc13d09020d1091ec80a3f8da6"),
    ("no-mistakes-v1.79.0-linux-arm64.tar.gz", "eac3f8e494c7d2487594b7eb513e605e59588be4ce147390b8fd184a7e6a8b05")] },
];

/// Kinas's own Linux CLI on its release (§16): Settings prints the bootstrap command from it, and only for this version
/// with its SHA-256 pinned — null until the release step uploads the binaries and pins them.
pub struct KinasLinux {
    pub repo: &'static str,
    pub version: &'static str,
    /// (arch, asset, sha256) — `x64`, then `arm64`, as Bun's `process.arch` names them.
    pub assets: [(&'static str, &'static str, Option<&'static str>); 2],
}
pub const KINAS_LINUX: KinasLinux = KinasLinux {
    repo: "mecls/kinas",
    version: "0.1.0",
    assets: [("x64", "kinas-linux-x64", None), ("arm64", "kinas-linux-arm64", None)],
};

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
        let linux: Vec<Value> = LINUX_RELEASES
            .iter()
            .map(|r| {
                json!({ "name": r.name, "version": r.version, "repo": r.repo, "kind": r.kind, "assets": {
                    "x64": { "asset": r.assets[0].0, "sha256": r.assets[0].1 },
                    "arm64": { "asset": r.assets[1].0, "sha256": r.assets[1].1 } } })
            })
            .collect();
        assert_eq!(fixture["linux_releases"], Value::Array(linux));
        let assets: serde_json::Map<String, Value> =
            KINAS_LINUX.assets.iter().map(|(arch, asset, sha)| (arch.to_string(), json!({ "asset": asset, "sha256": sha }))).collect();
        assert_eq!(fixture["kinas_linux"], json!({ "repo": KINAS_LINUX.repo, "version": KINAS_LINUX.version, "assets": assets }));
    }
}
