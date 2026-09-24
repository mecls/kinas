// What installed means for the crew (build spec §9), for the CLI: Firstmate's repository, pin and home folder, the
// tools at their exact versions with Firstmate's floors (fm-bootstrap.sh:909-926 at the pin), and the prerequisites.
// The app spells the same out in app/src-tauri/src/crew/pin.rs; fixtures/crew-tools.json holds the two equal. Moving
// the pin moves tool floors too, so it is the captain's decision, never a side effect.

export const FIRSTMATE_REPO = "https://github.com/kunchenguid/firstmate";
export const FIRSTMATE_PIN = "f9f74a1d91cc7e105ec3df2249eda4e07f9ba540"; // 2026-09-22; reviewed monthly
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
  { name: "tasks-axi",           version: "0.2.5",  floor: "0.2.4",  required: true,  source: "npm" },
  { name: "quota-axi",           version: "0.1.49", floor: "0.1.29", required: true,  source: "npm" },
  { name: "chrome-devtools-axi", version: "0.1.35", floor: "0",      required: true,  source: "npm" }, // COMMON_TOOLS, fm-bootstrap.sh:909
  { name: "lavish-axi",          version: "0.1.76", floor: "0.1.46", required: false, source: "npm" },
];

export const PREREQS: readonly string[] = ["git", "gh", "node", "npm", "jq", "python3", "herdr", "claude"];

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
