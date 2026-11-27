import { captionOf, groupByProject, taskMeta, type Freshness, type Summary } from "../model.ts";

/** Crew: the board as a list per project; titles, words and times, never paths or branches. */
export function Crew({ summary, fresh, label }: { summary: Summary | null; fresh: Freshness; label: string }) {
  const groups = summary ? groupByProject(summary.board) : [];
  const lanes = summary?.lanes;
  const lanesWords = lanes && lanes.cap !== null && lanes.free !== null ? ` · ${lanes.free} of ${lanes.cap} lanes free` : "";
  return (
    <>
      <h1 className="p-large">Crew</h1>
      <p className="p-cap">
        {captionOf(fresh, label)}
        {lanesWords}
      </p>
      {summary !== null && groups.length === 0 && <p className="p-cap">No crew tasks.</p>}
      {groups.map((g) => (
        <section key={g.project}>
          <h2 className="p-title">{g.project}</h2>
          <div className="p-group">
            {g.tasks.map((t) => (
              <div className="p-row" key={t.task} data-task={t.task}>
                <div className="p-row-top">
                  <span>{t.title}</span>
                  <span className="p-badge" data-word={t.word}>{t.word}</span>
                </div>
                <span className="p-meta">{taskMeta(t)}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
