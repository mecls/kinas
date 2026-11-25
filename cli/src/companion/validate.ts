// The only parser of an rpc request (build spec §10, "the companion's rpc input"; ADR 0024). The Mac sends one JSON
// document on stdin; anything that is not exactly one of these shapes — an unknown verb, an extra field, a field of the
// wrong type, a string too long — is refused, and nothing runs. Verbs join as their slices land (§11.2).

export interface Cursor {
  epoch: string;
  offset: number;
  events: number;
}

export type Request =
  | { verb: "hello" }
  | { verb: "bundle"; cursor: Cursor | null }
  | { verb: "refresh" }
  | { verb: "view" }
  | { verb: "launch-first-mate" }
  | { verb: "focus"; workspace: string }
  | { verb: "open-workspace"; folder: string; label: string };

export type Validated = Request | { refused: string };

const MAX_STRING = 256;
/** A folder's path under the projects folder, as the Mac's reader allows one. */
const MAX_FOLDER = 1024;
/** Open in the terminal's label (reader/workspace.rs `MAX_LABEL_CHARS`). */
const MAX_LABEL_CHARS = 80;

/** A Herdr workspace id as Herdr prints one (`w3`): letters, digits, `:`, `_`, `-`. */
export function workspaceId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9:_-]{1,64}$/.test(v);
}

/** A folder under the projects folder: `""` (the folder itself) or relative parts, none empty, `.` or `..`. */
export function relativeFolder(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_FOLDER || /[\u0000-\u001f\u007f]/.test(v)) return false;
  if (v === "") return true;
  return !v.startsWith("/") && v.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** A workspace label: 1–80 characters and no control character. */
export function label(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && [...v].length <= MAX_LABEL_CHARS && !/[\u0000-\u001f\u007f]/.test(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function onlyKeys(o: Record<string, unknown>, allowed: string[]): string | null {
  const extra = Object.keys(o).find((k) => !allowed.includes(k));
  return extra === undefined ? null : `unknown field ${JSON.stringify(extra.slice(0, 40))}`;
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function cursorOf(v: unknown): Cursor | null | string {
  if (v === null || v === undefined) return null;
  if (!isObject(v)) return "cursor is not an object";
  const extra = onlyKeys(v, ["epoch", "offset", "events"]);
  if (extra) return extra;
  if (typeof v.epoch !== "string" || v.epoch.length > MAX_STRING) return "cursor.epoch is not a short string";
  if (!count(v.offset) || !count(v.events)) return "cursor.offset and cursor.events are counts";
  return { epoch: v.epoch, offset: v.offset, events: v.events };
}

export function validate(input: unknown): Validated {
  if (!isObject(input)) return { refused: "the request is not an object" };
  switch (input.verb) {
    case "hello":
    case "refresh":
    case "view":
    case "launch-first-mate": {
      const extra = onlyKeys(input, ["verb"]);
      return extra ? { refused: extra } : { verb: input.verb };
    }
    case "bundle": {
      const extra = onlyKeys(input, ["verb", "cursor"]);
      if (extra) return { refused: extra };
      const cursor = cursorOf(input.cursor);
      return typeof cursor === "string" ? { refused: cursor } : { verb: "bundle", cursor };
    }
    case "focus": {
      const extra = onlyKeys(input, ["verb", "workspace"]);
      if (extra) return { refused: extra };
      return workspaceId(input.workspace) ? { verb: "focus", workspace: input.workspace } : { refused: "workspace is not a Herdr workspace id" };
    }
    case "open-workspace": {
      const extra = onlyKeys(input, ["verb", "folder", "label"]);
      if (extra) return { refused: extra };
      if (!relativeFolder(input.folder)) return { refused: "folder is not a folder under the projects folder" };
      if (!label(input.label)) return { refused: "label is not a workspace label" };
      return { verb: "open-workspace", folder: input.folder, label: input.label };
    }
    default:
      return { refused: "unknown verb" };
  }
}
