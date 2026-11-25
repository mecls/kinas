import { useCallback, useEffect, useState } from "react";
import { crewErrorOf, getPlace, remoteHello, remoteInstall, setPlace, type InstallItem, type Place, type RemoteHello, type SetupCheck } from "../api.ts";
import { clock } from "../crew/detail.ts";
import { writeClipboard } from "../terminal/clipboard.ts";
import { Button, Card, Dot, Table } from "../ui/index.ts";
import { ADOPT_WARNING, allOk, byHand, CHECK_LABELS, installLabel, TONE } from "./placeSetup.ts";
import { Block, Row } from "./Row.tsx";

// Settings → Where agents run (the factory in the cloud, build spec §12 slice 1.4; DESIGN.md 1.14; ADR 0024): this Mac,
// the default, or one Linux machine the captain owns or rents, named by an ssh target and a label. Slice 1 draws the
// choice, the two fields and the Reachable row. Slice 4 adds setup: the checks table with Install on a row Kinas can
// fix (one item per click, as the captain's user), the command for the captain where only they can (claude, gh auth
// login, the linger line), the bootstrap command while no companion answers there, and the client folders to clone.
// Phones join with their slice. Self-contained like CrewSection, and read again whenever Settings comes on screen.

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

/** A command in mono with Copy beside it. */
function Copyable({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="place-command">
      <code className="crew-mono">{text}</code>
      <Button className="button" aria-label={label ?? `Copy ${text}`} onClick={() => void writeClipboard(text).then(setCopied)}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

const SETUP_COLUMNS = [
  { key: "check", label: "Check" },
  { key: "state", label: "State" },
  { key: "action", label: "" },
];

/** The checks, in the companion's order: a row's dot and words, then its Install or the captain's command. */
function SetupTable({
  checks,
  busy,
  armed,
  onInstall,
}: {
  checks: SetupCheck[];
  busy: InstallItem | null;
  armed: InstallItem | null;
  onInstall: (c: SetupCheck) => void;
}) {
  const rows = checks.map((c) => {
    const words = installLabel(c);
    const danger = c.id === "api-key" && c.state === "bad";
    return {
      id: c.id,
      check: CHECK_LABELS[c.id] ?? c.id,
      state: (
        <span className="place-check" data-state={c.state}>
          <Dot color={TONE[c.state]} kind={c.state === "later" ? "ring" : "solid"} />
          <span className={danger ? "crew-problem-inline" : undefined}>{c.detail}</span>
        </span>
      ),
      action:
        c.install !== null && words !== null ? (
          <span className="place-action">
            {armed === c.install && <span className="crew-problem-inline">{ADOPT_WARNING}</span>}
            <Button className="button" disabled={busy !== null} onClick={() => onInstall(c)}>
              {busy === c.install ? "Installing…" : words}
            </Button>
          </span>
        ) : c.run !== null ? (
          <Copyable text={c.run} label={`Copy the command for ${CHECK_LABELS[c.id] ?? c.id}`} />
        ) : null,
    };
  });
  return (
    <Table
      className="place-checks"
      caption="On the VPS"
      columns={SETUP_COLUMNS}
      rows={rows}
      rowKey={(r) => String(r.id)}
      rowProps={(r) => ({ "data-check": String(r.id) })}
    />
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
  const [installing, setInstalling] = useState<InstallItem | null>(null);
  const [armed, setArmed] = useState<InstallItem | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);

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

  /** One item, the captain's click; an install that stops something running takes a second click. */
  const install = (c: SetupCheck) => {
    if (c.install === null) return;
    if (c.adopt && armed !== c.install) {
      setArmed(c.install);
      return;
    }
    setArmed(null);
    setInstalling(c.install);
    setMessage(null);
    remoteInstall(c.install, { adopt: c.adopt || undefined })
      .then((h) => {
        setHello(h);
        setMessage({ text: `${CHECK_LABELS[c.id] ?? c.id}: done`, problem: false });
      })
      .catch((e: unknown) => {
        setMessage({ text: crewErrorOf(e), problem: true });
        check();
      })
      .finally(() => setInstalling(null));
  };

  const clone = (folder: string) => {
    setCloning(folder);
    setMessage(null);
    remoteInstall("clone", { folder })
      .then((h) => {
        setHello(h);
        setMessage({ text: `${folder}: cloned`, problem: false });
      })
      .catch((e: unknown) => setMessage({ text: crewErrorOf(e), problem: true }))
      .finally(() => setCloning(null));
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
        <Row id="place.bootstrap" wide>
          {onVps && hello?.companion_missing ? (
            <div className="place-bootstrap" data-published={hello.bootstrap.lines.length > 0 || undefined}>
              {hello.bootstrap.lines.length > 0 ? (
                hello.bootstrap.lines.map((l) => (
                  <div key={l.arch} className="place-bootstrap-line">
                    <span className="crew-quiet-inline">{l.arch}</span>
                    <Copyable text={l.command} label={`Copy the ${l.arch} command`} />
                    <span className="crew-quiet-inline crew-mono">SHA-256 {l.sha256}</span>
                  </div>
                ))
              ) : (
                <>
                  <span className="crew-quiet-inline">
                    No Linux build of Kinas {hello.bootstrap.version} is published yet. Build it on this Mac, in Kinas's repository, and copy it there:
                  </span>
                  {byHand(hello.bootstrap.by_hand, target.trim() || "<target>").map((l) => (
                    <Copyable key={l} text={l} />
                  ))}
                </>
              )}
              <span className="crew-quiet-inline">Then Check again.</span>
            </div>
          ) : (
            <span className="crew-quiet-inline">{onVps ? "Kinas answers there." : "Only with a VPS."}</span>
          )}
        </Row>
        <Row id="place.setup" wide>
          {onVps && hello?.reachable ? (
            <div className="place-setup" data-done={allOk(hello.checks) || undefined}>
              <SetupTable checks={hello.checks} busy={installing} armed={armed} onInstall={install} />
            </div>
          ) : (
            <span className="crew-quiet-inline">{onVps ? "Once Kinas answers there." : "Only with a VPS."}</span>
          )}
        </Row>
        <Row id="place.clones" wide>
          {onVps && hello?.reachable ? (
            hello.clones.length === 0 ? (
              <span className="crew-quiet-inline">No client folder on this Mac has a GitHub origin.</span>
            ) : (
              <ul className="place-clones">
                {hello.clones.map((o) => (
                  <li key={o.folder} data-folder={o.folder} data-cloned={o.cloned || undefined}>
                    <span className="crew-mono">{o.folder}</span> <span className="crew-quiet-inline">{o.repo}</span>
                    {o.cloned ? (
                      <span className="crew-quiet-inline"> · cloned</span>
                    ) : (
                      <Button className="button" disabled={cloning !== null} aria-label={`Clone ${o.folder}`} onClick={() => clone(o.folder)}>
                        {cloning === o.folder ? "Cloning…" : "Clone"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <span className="crew-quiet-inline">{onVps ? "Once Kinas answers there." : "Only with a VPS."}</span>
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
