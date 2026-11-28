import { useCallback, useEffect, useState } from "react";
import { crewErrorOf, remotePairStart, remotePhones, remoteTestNotification, remoteUnpair, type PairStart, type Phone } from "../api.ts";
import { writeClipboard } from "../terminal/clipboard.ts";
import { Button, Table } from "../ui/index.ts";
import { dayWords, expiryWords, groupCode, lastSeenWords, notificationsWords, REMOVE_WARNING } from "./phonesView.ts";
import { Row } from "./Row.tsx";

// Settings → Where agents run, the phones (the factory in the cloud, build spec §12 slice 8.1; DESIGN.md 1.14): Pair a phone
// shows a code the captain types on the phone, and the link that carries it, each with Copy, for ten minutes; the paired
// phones are a table with Remove. Nothing here keeps the code: it lives in this component's state and goes with it.

/** How often the paired phones are read while a code is on screen. */
const PHONES_REFRESH_MS = 4_000;

const COLUMNS = [
  { key: "name", label: "Phone" },
  { key: "paired", label: "Paired" },
  { key: "seen", label: "Last seen" },
  { key: "push", label: "Notifications" },
  { key: "action", label: "" },
];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button className="button" aria-label={label} onClick={() => void writeClipboard(text).then(setCopied)}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** The two rows, shown while the Linux machine answers. `active` is Settings being on screen. */
export function PhonesSection({ shown, active }: { shown: boolean; active: boolean }) {
  const [phones, setPhones] = useState<Phone[] | null>(null);
  const [pair, setPair] = useState<PairStart | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);

  const load = useCallback(() => {
    remotePhones()
      .then(setPhones)
      .catch((e: unknown) => {
        setPhones(null);
        setMessage({ text: crewErrorOf(e), problem: true });
      });
  }, []);

  useEffect(() => {
    if (!active || !shown) return;
    setMessage(null);
    load();
  }, [active, shown, load]);

  // The code's countdown: a tick a second while one is showing, and none after it ends.
  useEffect(() => {
    if (pair === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [pair]);

  // While a code shows, the phones are read again every few seconds, so the phone that just used it appears here.
  useEffect(() => {
    if (pair === null) return;
    const id = window.setInterval(load, PHONES_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [pair, load]);

  // A code past its time is gone from the screen, not left to be copied.
  useEffect(() => {
    if (pair !== null && now >= pair.expires_at) setPair(null);
  }, [now, pair]);

  const start = () => {
    setBusy(true);
    setMessage(null);
    remotePairStart()
      .then((p) => {
        setNow(Date.now());
        setPair(p);
      })
      .catch((e: unknown) => setMessage({ text: crewErrorOf(e), problem: true }))
      .finally(() => setBusy(false));
  };

  const test = () => {
    setBusy(true);
    setMessage(null);
    remoteTestNotification()
      .then(() => setMessage({ text: "A test notification was sent. If it doesn't arrive, check the phone's notifications.", problem: false }))
      .catch((e: unknown) => setMessage({ text: crewErrorOf(e), problem: true }))
      .finally(() => setBusy(false));
  };

  const remove = (p: Phone) => {
    if (armed !== p.id) {
      setArmed(p.id);
      return;
    }
    setArmed(null);
    setBusy(true);
    remoteUnpair(p.id)
      .then(setPhones)
      .catch((e: unknown) => setMessage({ text: crewErrorOf(e), problem: true }))
      .finally(() => setBusy(false));
  };

  const quiet = (text: string) => <span className="crew-quiet-inline">{text}</span>;
  const rows = (phones ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    paired: dayWords(p.paired_at, now),
    seen: lastSeenWords(p.last_seen_at, now),
    push: notificationsWords(p.push),
    action: (
      <span className="place-action">
        {armed === p.id && <span className="crew-problem-inline">{REMOVE_WARNING}</span>}
        <Button kind="text" className="button" disabled={busy} aria-label={`Remove ${p.name}`} onClick={() => remove(p)}>
          {armed === p.id ? "Remove it" : "Remove"}
        </Button>
      </span>
    ),
  }));

  return (
    <>
      <Row id="place.pair" wide>
        {shown ? (
          <div className="place-pair">
            {pair === null ? (
              <div className="row">
                <Button className="button" disabled={busy} onClick={start}>
                  {busy ? "Pairing…" : "Pair a phone"}
                </Button>
                {quiet("A code for the phone, good for ten minutes.")}
              </div>
            ) : (
              <>
                <div className="place-pair-code" data-code>
                  <span className="place-pair-digits crew-mono">{groupCode(pair.code)}</span>
                  <CopyButton text={pair.code} label="Copy the pairing code" />
                </div>
                {pair.url !== null ? (
                  <span className="place-command">
                    <code className="crew-mono">{pair.url}</code>
                    <CopyButton text={pair.url} label="Copy the pairing link" />
                  </span>
                ) : (
                  quiet("Open the phone page and type the code.")
                )}
                {quiet(expiryWords(pair.expires_at, now))}
                <div className="row">
                  <Button kind="text" className="button" disabled={busy} onClick={start}>
                    {busy ? "Pairing…" : "New code"}
                  </Button>
                  {quiet("The code above stops working at once.")}
                </div>
              </>
            )}
          </div>
        ) : (
          quiet("Only with a Linux machine.")
        )}
      </Row>
      <Row id="place.phones" wide>
        {shown ? (
          phones === null ? (
            quiet("Reading the phones…")
          ) : phones.length === 0 ? (
            quiet("No phone is paired.")
          ) : (
            <>
              <Table className="place-phones" caption="Paired phones" columns={COLUMNS} rows={rows} rowKey={(r) => String(r.id)} rowProps={(r) => ({ "data-phone": String(r.id) })} />
              <Button className="button" disabled={busy} onClick={test}>
                Send a test notification
              </Button>
            </>
          )
        ) : (
          quiet("Only with a Linux machine.")
        )}
        {message && <p className={message.problem ? "problem" : "settings-message"}>{message.text}</p>}
      </Row>
    </>
  );
}
