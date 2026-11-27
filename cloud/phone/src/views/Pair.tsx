import { useState } from "react";
import { Button } from "../../../../app/src/ui/Button.tsx";
import { codeTyped, deviceName } from "../model.ts";

/** First open: the code Settings showed on the Mac, typed or arrived with in the address (build spec §11.3 F). */
export function Pair({ initialCode, removed, onPair }: { initialCode: string | null; removed: boolean; onPair: (code: string, name: string) => Promise<string | null> }) {
  const [text, setText] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = codeTyped(text);

  const submit = () => {
    if (code === null || busy) return;
    setBusy(true);
    setError(null);
    onPair(code, deviceName(navigator.userAgent))
      .then(setError)
      .catch(() => setError("Couldn't reach the store. Try again."))
      .finally(() => setBusy(false));
  };

  return (
    <main className="p-body p-pair">
      <h1 className="p-large">Kinas</h1>
      {removed && <p className="p-err">This phone was removed. Pair it again from Settings on the Mac.</p>}
      <p className="p-cap">Pair this phone with the code Settings shows on your Mac.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="p-form"
      >
        <input className="p-input" aria-label="Pairing code" autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" maxLength={12} value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder="AB3K-9XZQ" />
        <div className="p-acts">
          <Button type="submit" kind="primary" disabled={code === null || busy}>
            {busy ? "Pairing…" : "Pair"}
          </Button>
        </div>
      </form>
      {error && <p className="p-err" role="alert">{error}</p>}
      <p className="p-cap">Then add this page to the home screen and allow notifications.</p>
    </main>
  );
}
