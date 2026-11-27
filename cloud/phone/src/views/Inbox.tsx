import { ago, captionOf, type Freshness, type InboxItem } from "../model.ts";
import { firstLine } from "./Home.tsx";

/** Inbox: what waits on you, a held task or a keyed decision, newest question first as the Mac's Inbox has it. */
export function Inbox({ items, loading, fresh, label, now, onOpen }: { items: InboxItem[]; loading: boolean; fresh: Freshness; label: string; now: number; onOpen: (key: string) => void }) {
  const held = items.filter((i) => isHeld(i.key));
  const decisions = items.filter((i) => !isHeld(i.key));
  const group = (title: string, list: InboxItem[]) =>
    list.length === 0 ? null : (
      <>
        <h2 className="p-title">{title}</h2>
        <div className="p-group">
          {list.map((i) => (
            <button type="button" className="p-row p-tap" key={i.key} onClick={() => onOpen(i.key)} data-item={i.key}>
              <div className="p-row-top">
                <span>{firstLine(i.question)}</span>
                {i.answer?.status === "delivered" && <span className="p-meta">answered</span>}
              </div>
              <span className="p-meta">{[i.project, i.title, ago(i.since, now)].filter((x) => x !== "").join(" · ")}</span>
            </button>
          ))}
        </div>
      </>
    );
  return (
    <>
      <h1 className="p-large">Inbox</h1>
      <p className="p-cap">{captionOf(fresh, label)}</p>
      {loading ? <p className="p-cap">reading…</p> : items.length === 0 ? <p className="p-cap">Nothing waiting on you.</p> : null}
      {group("Held for you", held)}
      {group("Decisions", decisions)}
    </>
  );
}

/** A held task's item names the task twice: `<task>@<task>@<opened>` (the companion's item for a captain hold). */
export function isHeld(key: string): boolean {
  const [task, decision] = key.split("@");
  return task !== undefined && task === decision;
}
