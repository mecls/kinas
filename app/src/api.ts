// The typed door between the webview and the Rust core. Reads only, plus two nudges; every write to the
// store happens in Rust (PRD R7).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ReadingState = "fresh" | "stale" | "dead" | "reset";
export type Subscription = "claude-plan" | "ollama-cloud";
export type QuotaWindow = "session" | "week" | "month_credits";
export type ReaderId = "claude-plan" | "ollama-cloud" | "claude-code-logs" | "pi-logs" | "host" | "convex" | "hostinger" | "crew";

/**
 * A provider whose metrics live in `provider_metrics`, not `quotas`.
 *
 * Deliberately separate from `Subscription`: Convex writes no `quotas` row, because nine metrics across two
 * windows do not fit that table's one-`used_pct`-per-row shape (convex R9). Widening `Subscription` instead
 * would put Convex into every gauge that reads `quotas` and find nothing there.
 */
export type MetricProvider = "convex" | "hostinger";

export interface QuotaView {
  subscription: Subscription;
  window: QuotaWindow;
  used_pct: number;
  left_pct: number;
  resets_at: number | null;
  plan: string | null;
  source: string;
  updated_at: number;
  state: ReadingState;
  /** Per-model request counts the provider reports for this window (Ollama); empty otherwise. */
  models: { name: string; request_count: number }[];
}

/**
 * One metric of one provider for one window, from `provider_metrics` (convex R9).
 *
 * Not a `QuotaView`: a quota is one percentage per window, while a provider metric carries a raw `used` with an
 * *optional* limit. `used_pct` and `left_pct` are both nullable on purpose, mirroring the Rust `Option` — a
 * figure with no plan allowance (R8's AI-gateway cost) has no percentage and no "remaining", and a non-null
 * type here would force the UI to invent a zero.
 */
export interface ProviderMetricView {
  provider: MetricProvider;
  /** As stored: the API's own key, or `actionCompute` for the R7 sum. */
  metric: string;
  /** `day` and `month` are calendar-aligned **UTC**, which is not Europe/Lisbon (convex R4). */
  window: string;
  used: number;
  limit_value: number | null;
  unit: string | null;
  /** Unrounded and **not clamped**: over 100 % is real and billed (convex R6). */
  used_pct: number | null;
  left_pct: number | null;
  /** Whatever the reader wanted said about the row's subject; Hostinger puts `hostname · plan · state` here. */
  detail: string | null;
  source: string;
  updated_at: number;
  state: ReadingState;
}

export interface ReaderView {
  reader: ReaderId;
  state: "ok" | "error" | "not_configured";
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  stale_after_ms: number;
  dead_after_ms: number;
}

export interface HostView {
  machine: string;
  cpu_pct: number | null;
  mem_used_gb: number;
  mem_total_gb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  /** Finder's "available" (free space plus purgeable), GiB; null when macOS did not report it. */
  disk_available_gb: number | null;
  updated_at: number;
  state: ReadingState;
}

export interface UsageDay {
  date: string;
  harness: "claude-code" | "pi";
  provider: string;
  model: string;
  tokens_in: number;
  tokens_cache_read: number;
  tokens_out: number;
  messages: number;
}

export interface Backfill {
  done: number;
  total: number;
  running: boolean;
}

export interface HookStatus {
  state: "receiving" | "last_seen" | "never_seen";
  captured_at: number | null;
  minutes_ago: number | null;
}

export interface UsageSnapshot {
  now: number;
  quotas: QuotaView[];
  /** Read in the same pass as `quotas`, so the page never mixes readings from two moments (convex R§3). */
  provider_metrics: ProviderMetricView[];
  readers: ReaderView[];
  host: HostView | null;
  /** The last 30 Europe/Lisbon days, oldest first; days with no rows are absent. */
  usage: UsageDay[];
  /** The earliest date in usage_daily, so the chart can hatch the days before it (R26). */
  first_usage_date: string | null;
  /** The 30 dates the chart shows, oldest first, in Europe/Lisbon. */
  days: string[];
  backfill: Backfill;
  claude_hook: HookStatus;
}


// The crew (build spec §11.2): Kinas's read-only mirror of Firstmate's fleet. Words are Rust's, derived at read time.
export type CrewPage = "uninstalled" | "installed" | "running";
export type CrewWord = "queued" | "working" | "needs decision" | "blocked" | "CI red" | "PR open" | "ready" | "done" | "failed" | "paused" | "unknown" | "gone";
export interface CrewPr {
  number: number;
  state: string | null;
  draft: boolean;
  mergeable: string | null;
  checks_total: number | null;
  checks_failed: number | null;
}
export interface CrewTask {
  id: string;
  title: string | null;
  repo: string | null;
  project_name: string | null;
  kind: string;
  word: CrewWord;
  overnight_word: CrewWord;
  harness: string | null;
  first_seen_at: number;
  first_working_at: number | null;
  done_at: number | null;
  gone_at: number | null;
  last_event_at: number | null;
  last_event_text: string | null;
  pr: CrewPr | null;
  has_pane: boolean;
}
export interface CrewDecision {
  task_id: string;
  key: string;
  verb: string;
  summary: string;
  task_title: string | null;
  repo: string | null;
  opened_at: number;
  copied_at: number | null;
}
export interface CrewSnapshot {
  now: number;
  /** The last good snapshot's own time (ISO 8601), for the `as of` caption. */
  generated: string | null;
  reader: ReaderView;
  page: CrewPage;
  blocked: string | null;
  tasks: CrewTask[];
  decisions: CrewDecision[];
  reconcile: string[];
  waiting: number;
  overnight_since: number;
}
export interface CrewError {
  code: string;
  message: string;
}
export type PinState =
  | { state: "pinned"; short: string }
  | { state: "moved"; short: string; from: string }
  | { state: "tangle"; branch: string }
  | { state: "missing" };
export interface ToolState {
  name: string;
  /** The pinned version; "—" for a prerequisite. */
  pinned: string;
  installed: string | null;
  state: "installed" | "below_floor" | "missing";
  required: boolean;
}
export interface CrewSettings {
  pin: PinState;
  home_display: string;
  backend: string | null;
  tools: ToolState[];
  prereqs: ToolState[];
  gh_signed_in: boolean | null;
  away: { entered: string; expected_return: string | null } | null;
  projects: { name: string; mode: string; yolo: boolean }[];
  installed: boolean;
  blocked: string | null;
}
export const getCrew = () => invoke<CrewSnapshot>("crew_snapshot");
export const getCrewSettings = () => invoke<CrewSettings>("crew_settings");
/** The launcher: "focused" (it was running), "run" (its workspace was there without it), "created". */
export const launchFirstMate = () => invoke<"focused" | "run" | "created">("crew_launch");
/** A crew command's refusal, in its own words (CrewError), or the error as it came. */
export const crewErrorOf = (e: unknown): string =>
  e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string" ? (e as { message: string }).message : String(e);
/** What the Work page's chrome says about the pane (build spec §4 Work). */
export interface PaneState {
  session: string;
  workspace: string | null;
  word: CrewWord | null;
  profile: string | null;
  stale: boolean;
}
export const crewPaneState = () => invoke<PaneState>("crew_pane_state");
export const setCrewVisible = (visible: boolean) => invoke<void>("set_crew_visible", { visible });
export const onCrewChanged = (handler: () => void): Promise<UnlistenFn> => listen("crew_changed", handler);

export const getUsageSnapshot = () => invoke<UsageSnapshot>("get_usage_snapshot");
/** The session the Work page's chrome names: `default`, a debug build's test session, or a plain shell. */
export const paneSession = () => invoke<{ session: string; shell: boolean }>("pane_session");
export const setUsageVisible = (visible: boolean) => invoke<void>("set_usage_visible", { visible });
export const refreshReadings = () => invoke<void>("refresh_readings");

export type LinkStatus =
  | { state: "linked"; target: string }
  | { state: "created"; target: string }
  | { state: "repointed"; from: string; target: string }
  | { state: "conflict"; reason: string }
  | { state: "no_bundle" };

export interface SettingsView {
  org_name: string;
  /** Which ground the window draws on: "system" follows macOS. */
  appearance: "system" | "light" | "dark";
  /** The accent as "#rrggbb", or null for the brand's own (DESIGN.md §2.1). */
  accent: string | null;
  /** "subscription/window", e.g. "claude-plan/session". */
  menu_bar_quota: string;
  /** Tauri accelerator syntax, e.g. "Cmd+Shift+Space". */
  global_hotkey: string;
  launch_at_login: boolean;
  hotkey_error: string | null;
  autostart_error: string | null;
  cli_link: LinkStatus;
  ollama_key_saved: boolean;
  /** Whether a Convex deploy key is in the Keychain. Never the key itself (convex R2). */
  convex_key_saved: boolean;
  /** The watched deployment, or empty for "no deployment" — then no request is made at all (convex R3, R14). */
  convex_deployment_url: string;
  /** "starter" or "professional"; only changes which denominators the gauges use (convex R6). */
  convex_plan: string;
  /** Whether a Hostinger API token is in the Keychain. Never the token itself (hostinger R3). */
  hostinger_key_saved: boolean;
  /** The watched VPS, or null for "none chosen" — then no request is made at all (hostinger R4). */
  hostinger_vm_id: number | null;
  /** `hostname · plan`, so the picker can name the selection without re-listing the account. */
  hostinger_vm_label: string;
  claude_hook: HookStatus;
  /** The command Open in editor runs in a new Herdr pane (reader R36). */
  reader_editor: string;
  /** The projects folder the reader and the CLI work from (reader R1b). */
  projects_root: string;
  /** True when KINAS_ROOT overrides the saved folder, so the field is not in charge. */
  projects_root_from_env: boolean;
}

export const getSettings = () => invoke<SettingsView>("get_settings");
export const setOrgName = (name: string) => invoke<void>("set_org_name", { name });
/** Rejected unless one line of 1–200 characters after trimming. */
export const setReaderEditor = (value: string) => invoke<void>("set_reader_editor", { value });
/** The projects folder (reader R1b): an absolute path that exists. Answers with the canonical path it stored. */
export const setProjectsRoot = (path: string) => invoke<string>("set_projects_root", { path });

/**
 * A client folder (DESIGN.md §3.1): a git repository under the projects root, or a folder added inside it, as
 * projects.rs finds and names it. Hidden and removed ones are listed too, flagged (folder views, 2026-09-23): the
 * colours are seated over every folder before a surface filters (shell/folders.ts).
 */
export interface ProjectRow {
  name: string;
  path: string;
  /** `~/…` under the home folder, absolute otherwise. */
  display: string;
  /** Settings' choice of --cat-N, or null for the one ui/category.ts derives from the name. */
  category: number | null;
  internal: boolean;
  /** Off the sidebar and Home; still in Settings' list. */
  hidden: boolean;
  /** Off Settings' list too, in its Removed list. Wins over `hidden`. */
  removed: boolean;
}
/** Every repository up to three levels under the projects root, and every added folder; the walk stands for a minute in Rust. */
export const listProjects = () => invoke<ProjectRow[]>("list_projects");
/** 1 to 6, refused otherwise. */
export const setFolderCategory = (name: string, cat: number) => invoke<void>("set_folder_category", { name, cat });
export const setFolderInternal = (name: string, internal: boolean) => invoke<void>("set_folder_internal", { name, internal });
/** By path, which Rust checks against its listing ("Not a client folder" otherwise). */
export const setFolderHidden = (path: string, hidden: boolean) => invoke<void>("set_folder_hidden", { path, hidden });
/** Remove, or Restore — which also shows the folder again. Nothing on disk is touched. */
export const setFolderRemoved = (path: string, removed: boolean) => invoke<void>("set_folder_removed", { path, removed });
/** What Add a client folder… did: nothing (Cancel), or what became of the folder picked, named as the listing names it. */
export type AddOutcome = { outcome: "cancelled" } | { outcome: "added" | "shown" | "restored" | "already"; name: string };
/** A folder sheet in the projects folder, from Rust; refused (in Rust's words) outside it, on the root itself, or while one is open. */
export const addClientFolder = () => invoke<AddOutcome>("add_client_folder");
/** The app applies it to the window itself, title bar included; the page follows through prefers-color-scheme. */
export const setAppearance = (value: string) => invoke<void>("set_appearance", { value });
/** "#rrggbb" lower-case, refused otherwise; null removes the choice. The page sets --brand-accent itself. */
export const setAccent = (value: string | null) => invoke<void>("set_accent", { value });
export const setMenuBarQuota = (value: string) => invoke<void>("set_menu_bar_quota", { value });
/** Rejected by the app unless the chord includes ⌘ (R30). */
export const setGlobalHotkey = (chord: string) => invoke<void>("set_global_hotkey", { chord });
export const setLaunchAtLogin = (enabled: boolean) => invoke<void>("set_launch_at_login", { enabled });
export const saveOllamaKey = (key: string) => invoke<void>("save_ollama_key", { key });
export const removeOllamaKey = () => invoke<void>("remove_ollama_key");
/**
 * The Convex deploy key — mint it with **only** `deployment:usage:view`, which cannot deploy, read or write
 * data, run functions, or read environment variables (convex R2). Saving polls immediately.
 */
export const saveConvexKey = (key: string) => invoke<void>("save_convex_key", { key });
export const removeConvexKey = () => invoke<void>("remove_convex_key");
/** `https://` and a host, with no path — the reader appends its own. Empty disconnects the deployment. */
export const setConvexDeployment = (url: string) => invoke<void>("set_convex_deployment", { url });
/** "starter" or "professional"; anything else is refused rather than silently read back as starter. */
export const setConvexPlan = (plan: string) => invoke<void>("set_convex_plan", { plan });

/** One machine on the Hostinger account, for the picker (hostinger R4). */
export interface VpsChoice {
  id: number;
  hostname: string;
  plan: string;
  state: string;
}

/**
 * Hostinger's token has no read-only scope — its docs say a token has the same permissions as the owning user —
 * so "watch-only" is enforced in `readers/hostinger/`, which is GET-only and holds two tests proving it
 * (hostinger R1). Saving polls immediately.
 */
export const saveHostingerToken = (token: string) => invoke<void>("save_hostinger_token", { token });
export const removeHostingerToken = () => invoke<void>("remove_hostinger_token");
/** Lists the account's machines for the picker; stores nothing. */
export const hostingerListVms = () => invoke<VpsChoice[]>("hostinger_list_vms");
/** `null` watches none, which is how the VPS is disconnected. */
export const setHostingerVm = (vmId: number | null, label: string) => invoke<void>("set_hostinger_vm", { vmId, label });

export interface UiPrefs {
  /** The in-window shortcuts Settings saved, by action; missing actions use settings/shortcuts.ts's defaults. */
  shortcuts: Record<string, string>;
  sidebar_visible: boolean;
  /**
   * The reader's share of the row it sits in, 20–80 percent (default 55). That row was the Work page until
   * 2026-09-18 and is the whole stage since (the reader is the panel on its right); the key kept its name, so a
   * width saved before the move still applies.
   */
  reader_width_pct: number;
  /** The accent as "#rrggbb", or null for the brand's own; applied at boot. */
  accent: string | null;
  /** Whether Contents and Files show beside the text, and the side column's width; defaults when never set. */
  reader_side: ReaderSide;
}

/** The reader's side column (reader-layout PRD rule 4): one set for the whole reader, never per file. */
export interface ReaderSide {
  contents: boolean;
  files: boolean;
  /** In px, 160–480. Drawn narrower when the text would get less than 320 px (reader/side.ts). */
  width: number;
}

export const getUiPrefs = () => invoke<UiPrefs>("get_ui_prefs");
/** Rejected by the app unless every action is known, every chord includes ⌘ and no chord is used twice. */
export const setShortcuts = (shortcuts: Record<string, string>) => invoke<void>("set_shortcuts", { shortcuts });
export const setSidebarVisible = (visible: boolean) => invoke<void>("set_sidebar_visible", { visible });
/** Rejected outside 20–80 percent. */
export const setReaderWidth = (pct: number) => invoke<void>("set_reader_width", { pct });
/** Rejected outside 160–480 px. One call per gesture: a toggle's click, a drag's end, a double-click. */
export const setReaderSide = (side: ReaderSide) => invoke<void>("set_reader_side", { side });

// The reader (tasks/prd-kinas-open.md). Every command re-checks its path in Rust; a refusal arrives as ReaderError.

export type ReaderKind = "file" | "dir";

export interface ReaderText {
  text: string;
  /** Unchanged hash: a reload does nothing (R30). */
  hash: string;
  mtime_ms: number;
  size: number;
}

/**
 * How the reader shows a document (R2). Rust decides this, next to the read that produced the bytes, because
 * `"html"` is the difference between escaping text and executing code — the webview is what that protects, so the
 * webview does not get to choose.
 */
export type ReaderRender = "markdown" | "source" | "html" | "image";

export interface ReaderDoc {
  path: string;
  display_path: string;
  /** The projects root's real path, for links that start with `/`. */
  root: string;
  kind: ReaderKind;
  /** Null for a folder, which has no document to render. */
  render: ReaderRender | null;
  /** The lowercased extension, or file name when there is none, so a highlighter can be chosen (R11). */
  ext: string;
  text: ReaderText | null;
}

/** An accepted `kinas open` (R18). */
export interface ReaderShow {
  path: string;
  kind: ReaderKind;
  confirm: boolean;
  received_at_ms: number;
  root: string;
  /** Several files matched the name: the reader lists these and opens none until one is clicked (R1b). */
  pick?: string[];
}

export interface ReaderError {
  code: string;
  message: string;
}

export interface DirEntry {
  name: string;
  path: string;
  kind: ReaderKind;
}

export interface DirListing {
  entries: DirEntry[];
  more: number;
}

export function readerErrorOf(e: unknown): ReaderError {
  if (e && typeof e === "object" && "message" in e && "code" in e) return e as ReaderError;
  return { code: "unknown", message: String(e) };
}

export const readerOpen = (path: string) => invoke<ReaderDoc>("reader_open", { path });
export const readerReadText = (path: string) => invoke<ReaderText>("reader_read_text", { path });
export const readerListDir = (path: string) => invoke<DirListing>("reader_list_dir", { path });
export const readerReadImage = (path: string) => invoke<ArrayBuffer>("reader_read_image", { path });
export const readerConfirm = (path: string, allow: boolean) => invoke<void>("reader_confirm", { path, allow });
export const readerAllowClick = (path: string) => invoke<{ path: string; kind: ReaderKind }>("reader_allow_click", { path });
export const readerClose = () => invoke<void>("reader_close");
export const openExternal = (url: string) => invoke<void>("open_external", { url });
export const readerRendered = (lines: number, diagrams: number, ms: number) => invoke<void>("reader_rendered", { lines, diagrams, ms });
export const readerOpenInEditor = (path: string) => invoke<void>("reader_open_in_editor", { path });
/**
 * Asks Herdr for the folder's workspace: `focused` when one already carried its label, `created` otherwise. Rust
 * re-checks the folder and makes every Herdr call; nothing is typed into the terminal (reader/workspace.rs).
 */
export const readerOpenInTerminal = (path: string) => invoke<"created" | "focused">("reader_open_in_terminal", { path });

/** A pinned file or folder, as the sidebar shows it. `exists` is false when nothing is at the path right now. */
export interface PinView {
  path: string;
  display_path: string;
  kind: ReaderKind;
  exists: boolean;
}

/**
 * Pinned files and folders: the one thing about what Miguel reads that survives a relaunch, and only by an explicit
 * click. Each call answers with the whole list, so the sidebar redraws from one answer. A pin opens no door —
 * opening one still goes through `follow()` and `reader_allow_click` (reader/pins.rs).
 */
export const readerPins = () => invoke<PinView[]>("reader_pins");
/** Rejected unless the reader may already read the path, and past 50 pins. */
export const readerPin = (path: string) => invoke<PinView[]>("reader_pin", { path });
export const readerUnpin = (path: string) => invoke<PinView[]>("reader_unpin", { path });

/** A download's answer. The file's **name** only: where Miguel put the copy never comes back across this line. */
export type ReaderExported = { status: "saved"; name: string; bytes: number } | { status: "cancelled" };
/**
 * Download a copy of the open file. The page names the file and nothing else: Rust re-checks the path, opens the
 * macOS save sheet itself, reads the file itself and writes the copy itself (reader/export.rs).
 */
export const readerExport = (path: string) => invoke<ReaderExported>("reader_export", { path });
/** Opens the macOS print sheet on the window. What prints is decided by styles/print.css alone. */
export const readerPrint = () => invoke<void>("reader_print");
export const onReaderShow = (handler: (e: ReaderShow) => void): Promise<UnlistenFn> => listen<ReaderShow>("reader_show", (e) => handler(e.payload));
export const onReaderChanged = (handler: (e: { path: string }) => void): Promise<UnlistenFn> =>
  listen<{ path: string }>("reader_changed", (e) => handler(e.payload));

// Tree changes (tasks/tree-changes/prd.md): what changed on disk under a file tree since it was first shown. Rust
// watches, compares and decides every mark; the webview draws what the latest summary says (reader/changes/mod.rs).

export type Mark = "A" | "M" | "D";

export interface ChangeEntry {
  path: string;
  kind: ReaderKind;
  mark: Mark;
}

/** A folder that existed at both moments, with changes beneath it: their count and the strongest of them. */
export interface FolderRollup {
  path: string;
  count: number;
  strongest: Mark;
}

/** One root's whole summary, sent after every burst: it replaces the last one, never patches it. */
export interface TreeChanges {
  /** The root's real path. */
  root: string;
  /** The baseline moment every caption and tooltip counts from. */
  since_ms: number;
  /** False when the watch could not start: the tree works as today, without marks. */
  watching: boolean;
  /** The baseline has been taken; until then nothing is marked. */
  ready: boolean;
  /** Changed entries under the root, an added or deleted folder counting once. */
  total: number;
  entries: ChangeEntry[];
  folders: FolderRollup[];
  /** Folders whose direct children changed in this burst: an expanded one re-lists. */
  touched: string[];
}

/** Starts following a folder's tree, or answers with what it already follows: the first showing is the baseline. */
export const treeChangesWatch = (root: string) => invoke<TreeChanges>("tree_changes_watch", { root });
/** Clears one root's marks and starts its baseline again, now. Refused for a root not watched. */
export const treeChangesRefresh = (root: string) => invoke<TreeChanges>("tree_changes_refresh", { root });

export type DiffRowKind = "context" | "add" | "remove";

/** One line of a diff: 1-based line numbers, one-sided for an added or removed line; `fold` for a hidden one. */
export interface DiffRow {
  kind: DiffRowKind;
  old: number | null;
  new: number | null;
  text: string;
  fold: number | null;
}

/** A changed file against its text at the baseline (reader/changes/diff.rs). */
export interface DiffView {
  path: string;
  display_path: string;
  root: string;
  ext: string;
  since_ms: number;
  mark: Mark;
  added: number;
  removed: number;
  rows: DiffRow[];
  folds: { id: number; lines: number }[];
  /** A deleted file's old text, which Copy copies; null otherwise. */
  baseline_text: string | null;
}

/**
 * The Changes view of a changed file. Refused as `not_watched` for a path no watched root marks, `no_baseline` when
 * Kinas kept no text to compare (the reason is the message), `too_many_changes` past the diff's 500 ms.
 */
export const treeChangesDiff = (path: string) => invoke<DiffView>("tree_changes_diff", { path });
/**
 * Download what a deleted file said at its tree's baseline. As `readerExport`, the page names the path and nothing
 * else: Rust finds the text in its record, opens the save sheet and writes the bytes (reader/export.rs).
 */
export const treeChangesExport = (path: string) => invoke<ReaderExported>("tree_changes_export", { path });
export const onTreeChanged = (handler: (c: TreeChanges) => void): Promise<UnlistenFn> => listen<TreeChanges>("tree_changed", (e) => handler(e.payload));

export const onOpenPalette = (handler: () => void): Promise<UnlistenFn> => listen("open_palette", handler);
export const onReadingsChanged = (handler: () => void): Promise<UnlistenFn> => listen("readings_changed", handler);
export const onBackfillProgress = (handler: (b: Backfill) => void): Promise<UnlistenFn> =>
  listen<Backfill>("backfill_progress", (e) => handler(e.payload));
