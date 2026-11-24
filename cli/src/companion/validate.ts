// The only parser of an rpc request (build spec §10, "the companion's rpc input"; ADR 0024). The Mac sends one JSON
// document on stdin; anything that is not exactly one of these shapes — an unknown verb, an extra field, a field of the
// wrong type, a string too long — is refused, and nothing runs. Verbs join as their slices land (§11.2).

export interface Cursor {
  epoch: string;
  offset: number;
  events: number;
}

export type Request = { verb: "hello" } | { verb: "bundle"; cursor: Cursor | null } | { verb: "refresh" };

export type Validated = Request | { refused: string };

const MAX_STRING = 256;

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
    case "refresh": {
      const extra = onlyKeys(input, ["verb"]);
      return extra ? { refused: extra } : { verb: input.verb };
    }
    case "bundle": {
      const extra = onlyKeys(input, ["verb", "cursor"]);
      if (extra) return { refused: extra };
      const cursor = cursorOf(input.cursor);
      return typeof cursor === "string" ? { refused: cursor } : { verb: "bundle", cursor };
    }
    default:
      return { refused: "unknown verb" };
  }
}
