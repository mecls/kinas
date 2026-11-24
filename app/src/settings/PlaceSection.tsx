import { useCallback, useEffect, useState } from "react";
import { crewErrorOf, getPlace, remoteHello, setPlace, type Place, type RemoteHello } from "../api.ts";
import { clock } from "../crew/detail.ts";
import { Button, Card, Dot } from "../ui/index.ts";
import { Block, Row } from "./Row.tsx";

// Settings → Where agents run (the factory in the cloud, build spec §12 slice 1.4; DESIGN.md 1.14; ADR 0024): this Mac,
// the default, or one Linux machine the captain owns or rents, named by an ssh target and a label. Slice 1 draws the
// choice, the two fields and the Reachable row; the checks, Install and phones join with their slices. Self-contained
// like CrewSection, and read again whenever Settings comes on screen.

/** The Reachable row's words: connected and the companion's version, or why not, in the door's own fixed words. */
function Reachable({ hello, checking }: { hello: RemoteHello | null; checking: boolean }) {
  if (checking && hello === null) return <span className="crew-quiet-inline">Checking…</span>;
  if (hello === null) return <span className="crew-quiet-inline">Not checked yet.</span>;
  if (!hello.reachable) {
    return (
      <span className="place-reach" data-state="down">
        <Dot color="--danger" /> <span className="crew-problem-inline">{hello.problem}</span>
      </span>
    );
  }
  const differ = hello.herdr_there !== null && hello.herdr_here !== null && hello.herdr_there !== hello.herdr_here;
  return (
    <span className="place-reach" data-state="up">
      <span>
        <Dot color="--ok" /> connected · Kinas {hello.companion_version} there · checked {clock(hello.checked_at)}
      </span>
      <span className="place-herdr" data-differ={differ || undefined}>
        {differ && <Dot color="--warn" />} Herdr <span className="crew-mono">{hello.herdr_there ?? "not installed"}</span> there ·{" "}
        <span className="crew-mono">{hello.herdr_here ?? "not installed"}</span> here
        {differ && " — they differ; the Work page attaches across them only if Herdr allows it"}
      </span>
    </span>
  );
}

export function PlaceSection({ active }: { active: boolean }) {
  const [place, setPlaceState] = useState<Place | null>(null);
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [hello, setHello] = useState<RemoteHello | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);

  const check = useCallback(() => {
    setChecking(true);
    remoteHello()
      .then(setHello)
      .catch((e: unknown) => setMessage({ text: crewErrorOf(e), problem: true }))
      .finally(() => setChecking(false));
  }, []);

  const shown = useCallback(
    (p: Place) => {
      setPlaceState(p);
      if (p.place === "vps") {
        setTarget(p.target);
        setLabel(p.label);
        check();
      } else {
        setHello(null);
      }
    },
    [check],
  );

  useEffect(() => {
    if (!active) return;
    getPlace()
      .then(shown)
      .catch((e: unknown) => setMessage({ text: crewErrorOf(e), problem: true }));
  }, [active, shown]);

  const save = (next: Place, done: string) => {
    setBusy(true);
    setMessage(null);
    setPlace(next)
      .then((p) => {
        shown(p);
        setMessage({ text: done, problem: false });
      })
      .catch((e: unknown) => setMessage({ text: crewErrorOf(e), problem: true }))
      .finally(() => setBusy(false));
  };

  const onVps = place?.place === "vps";
  const ready = target.trim() !== "" && label.trim() !== "";
  const useVps = () => save({ place: "vps", target: target.trim(), label: label.trim() }, "Agents run on the VPS");

  return (
    <Block id="place">
      <Card className="settings-section" data-section="place">
        <Row id="place.where">
          <div className="row" role="group" aria-label="Where agents run">
            <Button
              kind={onVps ? "secondary" : "primary"}
              className="button"
              aria-pressed={!onVps}
              disabled={busy || place === null || !onVps}
              onClick={() => save({ place: "mac" }, "Agents run on this Mac")}
            >
              This Mac
            </Button>
            <Button kind={onVps ? "primary" : "secondary"} className="button" aria-pressed={onVps} disabled={busy || place === null || onVps || !ready} onClick={useVps}>
              VPS
            </Button>
          </div>
        </Row>
        <Row id="place.target" wide>
          <input
            className="ui-input field settings-wide-field crew-mono"
            autoComplete="off"
            spellCheck={false}
            aria-label="SSH target"
            placeholder="user@host, host, or an ssh alias"
            value={target}
            onChange={(e) => setTarget(e.currentTarget.value)}
          />
        </Row>
        <Row id="place.label">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) useVps();
            }}
          >
            <input
              className="ui-input field crew-mono"
              autoComplete="off"
              spellCheck={false}
              aria-label="VPS label"
              placeholder="vps-1"
              value={label}
              onChange={(e) => setLabel(e.currentTarget.value)}
            />
            {/* Several buttons on this page say "Save"; this one names what it saves. */}
            <Button type="submit" kind="primary" className="button" aria-label="Save the VPS" disabled={busy || !ready}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </form>
        </Row>
        <Row id="place.reachable" wide>
          {onVps ? (
            <div className="row place-reachable">
              <Reachable hello={hello} checking={checking} />
              <Button className="button" disabled={checking} onClick={check}>
                {checking ? "Checking…" : "Check again"}
              </Button>
            </div>
          ) : (
            <span className="crew-quiet-inline">Agents run on this Mac. Sessions on a VPS keep running there, unshown.</span>
          )}
        </Row>
        <div className="settings-card-foot">
          <p className="settings-help">
            Kinas reaches the machine only with ssh and your own key, runs nothing there as root, and never buys, resizes or deletes it. Switching
            moves nothing: sessions on the other side keep running.
          </p>
          {message && <p className={message.problem ? "problem" : "settings-message"}>{message.text}</p>}
        </div>
      </Card>
    </Block>
  );
}
