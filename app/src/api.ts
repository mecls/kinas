// The typed door between the webview and the Rust core. Reads only, plus two nudges; every write to the
// store happens in Rust (PRD R7).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ReadingState = "fresh" | "stale" | "dead" | "reset";
export type Subscription = "claude-plan" | "ollama-cloud";
export type QuotaWindow = "session" | "week" | "month_credits";
export type ReaderId = "claude-plan" | "ollama-cloud" | "claude-code-logs" | "pi-logs" | "host";

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

export const getUsageSnapshot = () => invoke<UsageSnapshot>("get_usage_snapshot");
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
  /** "subscription/window", e.g. "claude-plan/session". */
  menu_bar_quota: string;
  /** Tauri accelerator syntax, e.g. "Cmd+Shift+Space". */
  global_hotkey: string;
  launch_at_login: boolean;
  hotkey_error: string | null;
  autostart_error: string | null;
  cli_link: LinkStatus;
  ollama_key_saved: boolean;
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
export const setMenuBarQuota = (value: string) => invoke<void>("set_menu_bar_quota", { value });
/** Rejected by the app unless the chord includes ⌘ (R30). */
export const setGlobalHotkey = (chord: string) => invoke<void>("set_global_hotkey", { chord });
export const setLaunchAtLogin = (enabled: boolean) => invoke<void>("set_launch_at_login", { enabled });
export const saveOllamaKey = (key: string) => invoke<void>("save_ollama_key", { key });
export const removeOllamaKey = () => invoke<void>("remove_ollama_key");

export interface UiPrefs {
  /** The in-window shortcuts Settings saved, by action; missing actions use settings/shortcuts.ts's defaults. */
  shortcuts: Record<string, string>;
  sidebar_visible: boolean;
  /** The reader's share of the Work page, 20–80 percent (default 55). */
  reader_width_pct: number;
}

export const getUiPrefs = () => invoke<UiPrefs>("get_ui_prefs");
/** Rejected by the app unless every action is known, every chord includes ⌘ and no chord is used twice. */
export const setShortcuts = (shortcuts: Record<string, string>) => invoke<void>("set_shortcuts", { shortcuts });
export const setSidebarVisible = (visible: boolean) => invoke<void>("set_sidebar_visible", { visible });
/** Rejected outside 20–80 percent. */
export const setReaderWidth = (pct: number) => invoke<void>("set_reader_width", { pct });

// The reader (tasks/prd-kinas-open.md). Every command re-checks its path in Rust; a refusal arrives as ReaderError.

export type ReaderKind = "file" | "dir";

export interface ReaderText {
  text: string;
  /** Unchanged hash: a reload does nothing (R30). */
  hash: string;
  mtime_ms: number;
  size: number;
}

export interface ReaderDoc {
  path: string;
  display_path: string;
  /** The projects root's real path, for links that start with `/`. */
  root: string;
  kind: ReaderKind;
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
export const onReaderShow = (handler: (e: ReaderShow) => void): Promise<UnlistenFn> => listen<ReaderShow>("reader_show", (e) => handler(e.payload));
export const onReaderChanged = (handler: (e: { path: string }) => void): Promise<UnlistenFn> =>
  listen<{ path: string }>("reader_changed", (e) => handler(e.payload));

export const onOpenPalette = (handler: () => void): Promise<UnlistenFn> => listen("open_palette", handler);
export const onReadingsChanged = (handler: () => void): Promise<UnlistenFn> => listen("readings_changed", handler);
export const onBackfillProgress = (handler: (b: Backfill) => void): Promise<UnlistenFn> =>
  listen<Backfill>("backfill_progress", (e) => handler(e.payload));
