import { Notifications } from "./Notifications.tsx";
import { groupByProject, ago, captionOf, projectLine, type Freshness, type InboxItem, type Summary } from "../model.ts";

/** Home: each project's one line, the items waiting on you, and the caption (build spec §4; phone-home mockup). */
export function Home({ token, summary, items, fresh, label, now, onOpen, onUnpaired }: { token: string; summary: Summary | null; items: InboxItem[]; fresh: Freshness; label: string; now: number; onOpen: (key: string) => void; onUnpaired: () => void }) {
  const groups = summary ? groupByProject(summary.board) : [];
  const waiting = items.filter((i) => i.answer === null || i.answer.status !== "delivered");
  return (
    <>
      <h1 className="p-large">Home</h1>
      <p className="p-cap">{captionOf(fresh, label)}</p>
      {groups.length > 0 && (
        <div className="p-group">
          {groups.map((g) => (
            <div className="p-row" key={g.project}>
              <div className="p-row-top">
                <span>{g.project}</span>
              </div>
              <span className="p-meta">{projectLine(g, summary!.waiting)}</span>
            </div>
          ))}
        </div>
      )}
      <h2 className="p-title">Waiting on you</h2>
      {waiting.length === 0 ? (
        <p className="p-cap">Nothing waiting on you.</p>
      ) : (
        <div className="p-group">
          {waiting.map((i) => (
            <button type="button" className="p-row p-tap" key={i.key} onClick={() => onOpen(i.key)}>
              <div className="p-row-top">
                <span>{firstLine(i.question)}</span>
              </div>
              <span className="p-meta">{[i.project, i.title, ago(i.since, now)].filter((x) => x !== "").join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
      <Notifications token={token} onUnpaired={onUnpaired} />
    </>
  );
}

/** A question's first line: what the row and a notification show. */
export const firstLine = (q: string): string => q.split("\n")[0]?.trim() || q;
