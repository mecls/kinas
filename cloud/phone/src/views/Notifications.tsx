import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { Button } from "../../../../app/src/ui/Button.tsx";
import { api } from "../../../convex/_generated/api";
import { PUSH_WORDS, allowNotifications, currentState, type PushState } from "../push.ts";

/** Allow notifications, on a tap, with where this browser stands in words (build spec §11.3 F, slice 9.2). */
export function Notifications({ token, onUnpaired }: { token: string; onUnpaired: () => void }) {
  const subscribe = useMutation(api.phone.subscribe);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

  useEffect(() => {
    void currentState().then(setState);
  }, []);

  if (state === null) return null;
  if (!publicKey) return <p className="p-cap">Notifications aren't set up on this build.</p>;

  const allow = () => {
    setBusy(true);
    setError(null);
    allowNotifications(publicKey)
      .then((s) => subscribe({ token, subscription: s }))
      .then(() => currentState().then(setState))
      .catch((e: unknown) => {
        if (String((e as { data?: unknown }).data ?? e).includes("unpaired")) onUnpaired();
        else if ((e as Error).message === "denied") void currentState().then(setState);
        else setError("Couldn't turn notifications on. Try again.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="p-form" data-notifications={state}>
      <p className="p-cap">{PUSH_WORDS[state]}</p>
      {state === "off" && (
        <div className="p-acts">
          <Button kind="secondary" disabled={busy} onClick={allow}>
            {busy ? "Turning on…" : "Allow notifications"}
          </Button>
        </div>
      )}
      {error && <p className="p-err" role="alert">{error}</p>}
    </div>
  );
}
