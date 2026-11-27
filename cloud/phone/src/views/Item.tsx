import { useMutation } from "convex/react";
import { useState } from "react";
import { Button } from "../../../../app/src/ui/Button.tsx";
import { api } from "../../../convex/_generated/api";
import { ago, answerLines, captionOf, mintRequestId, refusalWords, requestFor, type Freshness, type InboxItem, type Kind, type RequestMemo } from "../model.ts";

/** One item: the question in its own lines, the recommendation, the three actions in thumb reach, then what became of it. */
export function Item({ token, item, fresh, label, now, onBack, onUnpaired }: { token: string; item: InboxItem | null; fresh: Freshness; label: string; now: number; onBack: () => void; onUnpaired: () => void }) {
  const submit = useMutation(api.phone.submitAnswer);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [memo, setMemo] = useState<RequestMemo | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const back = (
    <button type="button" className="p-back" onClick={onBack}>
      ‹ Inbox
    </button>
  );
  if (item === null) {
    return (
      <>
        {back}
        <p className="p-cap">No longer waiting.</p>
      </>
    );
  }
  const lines = answerLines(item.answer);

  const send = (kind: Kind, words: string) => {
    if (busy) return;
    // Send again keeps the same request id for the same words, so a lost reply can't make a second answer.
    const m = requestFor(memo, item.key, kind, words, mintRequestId);
    setMemo(m);
    setBusy(true);
    setRefused(null);
    submit({ token, key: item.key, kind, text: words, requestId: m.id })
      .then((r) => {
        if (r.refused !== undefined) setRefused(refusalWords({ refused: r.refused, why: r.why ?? "" }));
        else {
          setWriting(false);
          setText("");
        }
      })
      .catch((e: unknown) => {
        if (String((e as { data?: unknown }).data ?? e).includes("unpaired")) onUnpaired();
        else setRefused("Not delivered: couldn't reach the store. Send it again.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      {back}
      <p className="p-meta">{[item.project, item.title, `held ${ago(item.since, now)}`].filter((x) => x !== "").join(" · ")}</p>
      <div className="ui-qbox">
        <p className="p-question">{item.question}</p>
      </div>
      {item.recommendation !== null && <p className="p-cap">Recommendation: {item.recommendation}</p>}
      {fresh.state === "stale" && <p className="p-err">{captionOf(fresh, label)}</p>}
      {lines.done && <p className="p-done">{lines.done}</p>}
      {lines.read && <p className="p-done">{lines.read}</p>}
      {lines.reply && <p className="p-done">{lines.reply}</p>}
      {(lines.error ?? refused) && <p className="p-err" role="alert">{refused ?? lines.error}</p>}
      {lines.canAnswer &&
        (writing ? (
          <div className="p-form">
            <textarea className="p-input p-area" aria-label="Your answer" value={text} onChange={(e) => setText(e.currentTarget.value)} rows={4} />
            <div className="p-acts">
              <Button kind="primary" disabled={busy || text.trim() === ""} onClick={() => send("answer", text)}>
                {busy ? "Sending…" : "Send"}
              </Button>
              <Button kind="text" onClick={() => setWriting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-acts">
            <Button kind="primary" disabled={busy} onClick={() => send("approve", "")}>
              Approve
            </Button>
            <Button kind="secondary" disabled={busy} onClick={() => setWriting(true)}>
              Answer
            </Button>
            <Button kind="text" disabled={busy} onClick={() => send("deny", "")}>
              Deny
            </Button>
          </div>
        ))}
    </>
  );
}
