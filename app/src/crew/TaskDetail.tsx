import { useEffect, useState } from "react";
import { crewErrorOf, getCrewTask, type CrewTaskDetail } from "../api.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import type { KeyboardEvent } from "react";
import { Button, ChecksList, PanelBody, PanelFooter, PanelHeader, QuestionCard, Timeline } from "../ui/index.ts";
import { inboxKey } from "../ui/inboxKeys.ts";
import { BADGE_OF, lanesOf } from "./board.ts";
import { checksOf, prDetail, settingsLine, timelineOf, worktreeWord } from "./detail.ts";
import { ageText, copiedText } from "./inbox.ts";

// The right panel's second occupant (build spec §4 Task detail; mockup task-detail.html): what Firstmate reports about
// one task, read from Rust with `crew_task`, beside the reader in the aside and switched by `hidden` — the reader stays
// mounted with its tabs. Opening the brief or the report hands the panel back to the reader. An open decision shows as
// on the Inbox, and the footer acts as the Inbox does: Approve copies the answer line and goes to the first mate's pane;
// Answer and Deny open the item's box on the Inbox page, where the reply box lives (as Home's compact items do).

export function TaskDetail({
  id,
  hidden,
  version,
  folders,
  onClose,
  onOpenPath,
  onOpenPane,
  onApprove = () => {},
  onOpenBox = () => {},
}: {
  id: string | null;
  hidden: boolean;
  /** Changes whenever the crew's reading does, so the detail is read again with it. */
  version: number;
  folders: readonly SeatedFolder[];
  onClose: () => void;
  onOpenPath: (path: string) => void;
  onOpenPane: (id: string) => void;
  onApprove?: (task: string, key: string) => void;
  onOpenBox?: (task: string, key: string, kind: "answer" | "deny") => void;
}) {
  /** The last answer, and the id it was for: null when the mirror never held that task. */
  const [answer, setAnswer] = useState<{ id: string; detail: CrewTaskDetail | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The previous detail stays until `crew_task` answers (§4, Loading); a failure says why under the header.
  useEffect(() => {
    if (!id || hidden) return;
    let live = true;
    getCrewTask(id).then(
      (detail) => {
        if (!live) return;
        setAnswer({ id, detail });
        setError(null);
      },
      (e) => live && setError(crewErrorOf(e)),
    );
    return () => {
      live = false;
    };
  }, [id, hidden, version]);

  const shown = answer?.detail ?? null;
  const missing = answer !== null && answer.id === id && answer.detail === null;
  const lane = shown ? lanesOf([shown.task], folders)[0] : undefined;
  const gone = shown?.task.word === "gone";
  const pr = shown ? prDetail(shown) : null;
  const worktree = shown ? worktreeWord(shown) : null;
  /** The footer acts on the newest open decision. */
  const decision = shown && !gone ? (shown.decisions[0] ?? null) : null;
  const act = (action: "approve" | "answer" | "deny") => {
    if (!decision) return;
    if (action === "approve") onApprove(decision.task_id, decision.key);
    else onOpenBox(decision.task_id, decision.key, action);
  };
  // A, R and D while the panel holds focus, as on a focused inbox item (keymap.md).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!decision || (e.target instanceof HTMLElement && e.target.closest("textarea, input"))) return;
    const action = inboxKey(e, { boxOpen: false });
    if (!action) return;
    e.preventDefault();
    act(action);
  };

  return (
    <div className="crew-detail" hidden={hidden} data-task={shown?.task.id} onKeyDown={onKeyDown}>
      {shown && !missing && (
        <PanelHeader
          cat={lane?.cat ?? undefined}
          folder={lane?.name ?? shown.task.project_name ?? ""}
          title={shown.task.title ?? shown.task.id}
          state={BADGE_OF[shown.task.word]}
          onClose={onClose}
        />
      )}
      {error && (
        <p className="crew-error crew-detail-note" data-testid="crew-detail-error">
          Could not read the task: {error}
        </p>
      )}
      {missing && (
        <>
          <PanelHeader folder="" title={id} onClose={onClose} />
          <p className="crew-quiet crew-detail-note">Not in the fleet snapshot</p>
        </>
      )}
      {shown && !missing && gone && <p className="crew-quiet crew-detail-note" data-testid="crew-detail-gone">No longer in the fleet snapshot</p>}
      {shown && !missing && !gone && (
        <PanelBody>
          <h4>State</h4>
          {shown.state_line && (
            <p>
              <span className="ui-mono">{shown.state_line}</span>
            </p>
          )}
          <p className="ui-ink2">{settingsLine(shown)}</p>
          {shown.task.has_pane && (
            <Button className="crew-detail-action" aria-label={`Open ${shown.task.title ?? shown.task.id}'s pane`} onClick={() => onOpenPane(shown.task.id)}>
              Open its pane
            </Button>
          )}

          {shown.decisions.length > 0 && (
            <>
              <h4>Decision</h4>
              {shown.decisions.map((d) => (
                <div key={d.key} className="crew-decision" data-key={d.key}>
                  <QuestionCard question={d.summary} />
                  <p className="ui-ink2">
                    {d.verb === "captain-hold" ? "held for you" : <>key <span className="ui-mono">{d.key}</span></>} · {ageText(d.opened_at, Date.now())}
                  </p>
                  {d.copied_at !== null && <p className="ui-ink2 inbox-copied">{copiedText(d.copied_at)}</p>}
                </div>
              ))}
            </>
          )}

          <h4>The ask</h4>
          <p>{shown.task.title ?? shown.task.id}</p>
          {shown.excerpt && <p className="ui-ink2">“{shown.excerpt}”</p>}
          {shown.brief_path && (
            <Button kind="text" className="crew-detail-action" onClick={() => onOpenPath(shown.brief_path!)}>
              Open the brief
            </Button>
          )}

          {(shown.task.kind !== "scout" || pr) && (
            <>
              <h4>PR</h4>
              {pr ? <p className="crew-pr" data-testid="crew-detail-pr">{pr}</p> : <p className="ui-ink2">No PR yet</p>}
              {shown.checks.length > 0 && <ChecksList checks={checksOf(shown)} />}
            </>
          )}

          {shown.task.kind === "scout" && (
            <>
              <h4>Report</h4>
              {shown.report_path ? (
                <Button className="crew-detail-action" onClick={() => onOpenPath(shown.report_path!)}>
                  Open the report
                </Button>
              ) : (
                <p className="ui-ink2">Report not written yet</p>
              )}
            </>
          )}

          <h4>Timeline</h4>
          <Timeline items={timelineOf(shown)} />

          {worktree && (
            <>
              <h4>Worktree</h4>
              <p className="ui-ink2" data-testid="crew-detail-worktree" title={shown.worktree_display ?? undefined}>
                {worktree}
              </p>
            </>
          )}
        </PanelBody>
      )}
      {decision && (
        <PanelFooter>
          <Button kind="text" hint="D" onClick={() => act("deny")}>
            Deny
          </Button>
          <Button hint="R" onClick={() => act("answer")}>
            Answer
          </Button>
          <Button kind="primary" hint="A" onClick={() => act("approve")}>
            Approve
          </Button>
        </PanelFooter>
      )}
    </div>
  );
}
