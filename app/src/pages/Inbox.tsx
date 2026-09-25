import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CrewDecision, CrewSnapshot } from "../api.ts";
import { fleetAsOf } from "../crew/board.ts";
import { ageText, copiedText, inboxGroups, titleOf } from "../crew/inbox.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import { Dot, EmptyState, InboxItem, Section, SectionHeader, TitleRow } from "../ui/index.ts";
import { inboxKey } from "../ui/inboxKeys.ts";

// Inbox (build spec §4 Inbox page; DESIGN.md 1.7; mockup inbox.html): everything waiting on the captain, from the
// fleet — a worker's open decision, or a task Firstmate holds for them. Every item is answered the same way: Approve
// puts `On <task> (<key>): Approved — go ahead.` on the clipboard at once and goes to the first mate's pane; Answer and
// Deny open a box whose Copy and go does the same with the words typed. Kinas sends nothing; the item stays, and
// still counts, until Firstmate closes it in its chat. A, R and D act on a focused item (keymap.md).

export type AnswerKind = "approve" | "answer" | "deny";

/** An item's reply box, opened from here or from the task detail's footer. */
export interface InboxBox {
  task: string;
  key: string;
  kind: "answer" | "deny";
}

const itemId = (d: CrewDecision) => `${d.task_id}\u0000${d.key}`;

function Item({
  d,
  held,
  folders,
  now,
  box,
  text,
  onText,
  onBox,
  onAnswer,
}: {
  d: CrewDecision;
  held: boolean;
  folders: readonly SeatedFolder[];
  now: number;
  box: InboxBox["kind"] | null;
  text: string;
  onText: (t: string) => void;
  onBox: (kind: InboxBox["kind"] | null) => void;
  onAnswer: (kind: AnswerKind, text: string) => void;
}) {
  const folder = d.repo ? folders.find((f) => !f.removed && f.repo === d.repo) : undefined;
  const context = held ? (
    `Held for you · ${titleOf(d)} · ${ageText(d.opened_at, now)}`
  ) : (
    <>
      {titleOf(d)} · <span className="ui-mono">{d.key}</span> · {ageText(d.opened_at, now)}
    </>
  );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const action = inboxKey(e, { boxOpen: box !== null });
    if (!action) return;
    e.preventDefault();
    if (action === "approve") onAnswer("approve", "");
    else onBox(action);
  };
  return (
    <li className="inbox-item" data-task={d.task_id} data-key={d.key} data-verb={d.verb}>
      <InboxItem
        cat={folder?.cat}
        keys
        tabIndex={0}
        onKeyDown={onKeyDown}
        question={d.summary || titleOf(d)}
        context={context}
        state={box ? "answering" : "open"}
        answer={text}
        onAnswerChange={onText}
        copyDisabled={box === "answer" && text.trim() === ""}
        copied={copiedText(d.copied_at) ?? undefined}
        onApprove={() => onAnswer("approve", "")}
        onAnswer={() => onBox("answer")}
        onDeny={() => onBox("deny")}
        onCopy={() => box && onAnswer(box, text)}
        onCancel={() => onBox(null)}
      />
    </li>
  );
}

export function InboxPage({
  crew,
  folders = [],
  request = null,
  onAnswer = async () => false,
}: {
  crew: CrewSnapshot | null;
  folders?: readonly SeatedFolder[];
  /** A box to open, from the task detail's Answer or Deny; `seq` makes a repeat distinct. */
  request?: (InboxBox & { seq: number }) | null;
  /** Resolves true once the line is on the clipboard — a launcher refusal after that still counts as copied. */
  onAnswer?: (task: string, key: string, kind: AnswerKind, text: string) => Promise<boolean>;
}) {
  const [box, setBox] = useState<(InboxBox & { text: string }) | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (request) setBox({ task: request.task, key: request.key, kind: request.kind, text: "" });
  }, [request]);

  const answer = (d: CrewDecision, kind: AnswerKind, text: string) => {
    if (busy.current) return;
    busy.current = true;
    void onAnswer(d.task_id, d.key, kind, text)
      .then((copied) => {
        if (copied) setBox(null);
      })
      .finally(() => {
        busy.current = false;
      });
  };

  if (!crew) {
    return (
      <div className="page-in inbox">
        <TitleRow title="Inbox" />
      </div>
    );
  }
  const groups = inboxGroups(crew);
  const empty = groups.decisions.length === 0 && groups.held.length === 0 && groups.reconcile.length === 0;
  const list = (items: CrewDecision[], held: boolean) => (
    <ul className="ui-inbox inbox-list">
      {items.map((d) => {
          const open = box && box.task === d.task_id && box.key === d.key ? box : null;
          return (
            <Item
              key={itemId(d)}
              d={d}
              held={held}
              folders={folders}
              now={crew.now}
              box={open?.kind ?? null}
              text={open?.text ?? ""}
              onText={(text) => setBox((b) => (b ? { ...b, text } : b))}
              onBox={(kind) => setBox(kind ? { task: d.task_id, key: d.key, kind, text: open?.text ?? "" } : null)}
              onAnswer={(kind, text) => answer(d, kind, text)}
            />
          );
        })}
    </ul>
  );

  return (
    <div className="page-in inbox">
      <TitleRow title="Inbox" />
      {crew.reader.state === "error" && crew.reader.last_error && (
        <p className="crew-error" data-testid="crew-error">
          Crew: {crew.reader.last_error} · showing the last reading
        </p>
      )}
      {empty ? (
        <EmptyState>Nothing waiting on you.</EmptyState>
      ) : (
        <>
          {groups.decisions.length > 0 && (
            <Section data-section="decisions">
              <SectionHeader title="Decisions" caption={fleetAsOf(crew.generated, crew.now) ?? undefined} source="the fleet snapshot's open decisions" />
              {list(groups.decisions, false)}
            </Section>
          )}
          {groups.held.length > 0 && (
            <Section data-section="held">
              <SectionHeader title="Held for you" />
              {list(groups.held, true)}
            </Section>
          )}
          {groups.reconcile.length > 0 && (
            <Section data-section="reconcile">
              <SectionHeader title="Reconcile" caption="information — nothing here is repaired" />
              <ul className="inbox-reconcile">
                {groups.reconcile.map((line) => (
                  <li key={line}>
                    <Dot color="--stale" />
                    {line}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
