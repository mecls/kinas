// What installed means for the crew (build spec §9), for the CLI: Firstmate's repository, pin and home folder, the
// tools at their exact versions with Firstmate's floors (fm-bootstrap.sh:929-939, fm-tasks-axi-lib.sh:59, fm-quota-axi-lib.sh:21 at the pin), and the prerequisites.
// The app spells the same out in app/src-tauri/src/crew/pin.rs; fixtures/crew-tools.json holds the two equal. Moving
// the pin moves tool floors too, so it is the captain's decision, never a side effect.

export const FIRSTMATE_REPO = "https://github.com/kunchenguid/firstmate";
export const FIRSTMATE_PIN = "427056c4181c41074ad24f051f79919330df0fa5"; // 2026-11-12; reviewed monthly (ADR 0020)
export const HOME_DIR = "firstmate"; // under the data directory
export const WORKSPACE_LABEL = "firstmate"; // Firstmate's own, backends/herdr.sh:360-369

export type ToolSource = "npm" | { repo: string; asset: string; sha256: string };

export interface Tool {
  name: string;
  version: string;
  /** A version, or "lease": treehouse's floor is a feature, `--lease` in `treehouse get --help`. */
  floor: string;
  required: boolean;
  source: ToolSource;
}

// prettier-ignore
export const TOOLS: readonly Tool[] = [
  { name: "treehouse",           version: "2.3.0",  floor: "lease",  required: true,  source: { repo: "kunchenguid/treehouse",   asset: "treehouse-v2.3.0-darwin-arm64.tar.gz",   sha256: "1cb09bcfa830b4eec5e54beeaa71589adb9c5d828573dda0f5150e2d80cf13d5" } },
  { name: "no-mistakes",         version: "1.79.0", floor: "1.46.0", required: true,  source: { repo: "kunchenguid/no-mistakes", asset: "no-mistakes-v1.79.0-darwin-arm64.tar.gz", sha256: "80c2f4b9b3d01cb5d60ca294226b41d7331408e6e5cf0400a576cf3ec25166d7" } },
  { name: "gh-axi",              version: "0.1.35", floor: "0.1.29", required: true,  source: "npm" },
  { name: "tasks-axi",           version: "0.2.6",  floor: "0.2.6",  required: true,  source: "npm" },
  { name: "quota-axi",           version: "0.1.51", floor: "0.1.51", required: true,  source: "npm" },
  { name: "chrome-devtools-axi", version: "0.1.35", floor: "0",      required: true,  source: "npm" }, // COMMON_TOOLS, fm-bootstrap.sh:909
  { name: "lavish-axi",          version: "0.1.80", floor: "0.1.80", required: false, source: "npm" },
];

export const PREREQS: readonly string[] = ["git", "gh", "node", "npm", "jq", "python3", "perl", "herdr", "claude"];

/** The tools whose install Firstmate follows with `<tool> setup hooks` (fm-bootstrap.sh:881): printed, never run. */
export const SETUP_HOOKS: readonly string[] = ["gh-axi", "chrome-devtools-axi", "lavish-axi"];

/** The first `major.minor.patch` in a version line (`no-mistakes version v1.79.0 (fc540ac)` → `1.79.0`). */
export function versionOf(text: string): string | null {
  return /(\d+)\.(\d+)\.(\d+)/.exec(text)?.slice(1, 4).join(".") ?? null;
}

/** Whether `version` is at or above `floor`; a floor of "0" is any version. Unparseable is below. */
export function atLeast(version: string, floor: string): boolean {
  if (floor === "0") return true;
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1, 4).map(Number) ?? null;
  const [a, b] = [parse(version), parse(floor)];
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
}

// The factory in the cloud (build spec §12 slice 4.1, §17 2026-11-25 #1): what `kinas companion install` puts in
// ~/.local/bin on a Linux machine, per architecture as Bun's `process.arch` names it, with the SHA-256 GitHub publishes
// for each asset (checked against the two darwin pins above, computed from downloads: equal). Herdr is the VPS's pin
// (0.9.5, ADR 0024), not the Mac's. treehouse and no-mistakes are the versions TOOLS pins.

export type Arch = "x64" | "arm64";

export interface LinuxRelease {
  /** The binary's name in ~/.local/bin, and inside a `tar.gz`. */
  name: string;
  version: string;
  repo: string;
  /** `raw`: the asset is the binary; `tar.gz`: an archive holding one file named `name`. */
  kind: "raw" | "tar.gz";
  assets: Record<Arch, { asset: string; sha256: string }>;
}

// prettier-ignore
export const LINUX_RELEASES: readonly LinuxRelease[] = [
  { name: "herdr",       version: "0.9.5",  repo: "herdrdev/herdr",          kind: "raw",    assets: {
    x64:   { asset: "herdr-linux-x86_64",                     sha256: "14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d" },
    arm64: { asset: "herdr-linux-aarch64",                    sha256: "17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c" } } },
  { name: "treehouse",   version: "2.3.0",  repo: "kunchenguid/treehouse",   kind: "tar.gz", assets: {
    x64:   { asset: "treehouse-v2.3.0-linux-amd64.tar.gz",    sha256: "94fd2b2c20c35aac1ddc2941317890ad82c9916f5ccecbac4a50cda783eed10f" },
    arm64: { asset: "treehouse-v2.3.0-linux-arm64.tar.gz",    sha256: "408589ba72b58d5e942071ed863a83fd96566cfd1e514945daa59defde528bbb" } } },
  { name: "no-mistakes", version: "1.79.0", repo: "kunchenguid/no-mistakes", kind: "tar.gz", assets: {
    x64:   { asset: "no-mistakes-v1.79.0-linux-amd64.tar.gz", sha256: "d178c8a5134763b8e5f6d82545a3a76285fbbcdc13d09020d1091ec80a3f8da6" },
    arm64: { asset: "no-mistakes-v1.79.0-linux-arm64.tar.gz", sha256: "eac3f8e494c7d2487594b7eb513e605e59588be4ce147390b8fd184a7e6a8b05" } } },
];

/**
 * Kinas's own Linux CLI, the companion, as the release attaches it (§16): `sha256` is null until the release step builds
 * `bun scripts/build-cli.ts --target bun-linux-x64` for this version and pins what it uploaded. Settings prints the
 * bootstrap command only for a pinned version.
 */
export const KINAS_LINUX: { repo: string; version: string; assets: Record<Arch, { asset: string; sha256: string | null }> } = {
  repo: "mecls/kinas",
  version: "0.1.0",
  assets: { x64: { asset: "kinas-linux-x64", sha256: null }, arm64: { asset: "kinas-linux-arm64", sha256: null } },
};

/** A GitHub release asset's download URL; every release here is tagged `v<version>`. */
export function releaseUrl(repo: string, version: string, asset: string): string {
  return `https://github.com/${repo}/releases/download/v${version}/${asset}`;
}
