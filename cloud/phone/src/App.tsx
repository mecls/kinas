import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { codeFromHash, freshness, inboxCount, TABS, TAB_WORDS, type Tab } from "./model.ts";
import { clearToken, readToken, writeToken } from "./store.ts";
import { Crew } from "./views/Crew.tsx";
import { Factory } from "./views/Factory.tsx";
import { Home } from "./views/Home.tsx";
import { Inbox } from "./views/Inbox.tsx";
import { Item } from "./views/Item.tsx";
import { Pair } from "./views/Pair.tsx";

// The phone page (build spec §4 "The phone", §11.1): pair, then four tabs. An item opens from the Inbox or from a
// notification's address (`#item=<key>`); an unpaired token sends the person back to Pair with the reason.

/** `#item=<key>`: the item a notification opened; null otherwise. */
export const itemFromHash = (hash: string): string | null => {
  const m = /^#item=(.+)$/.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
};

function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

function Paired({ token, onUnpaired }: { token: string; onUnpaired: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [itemKey, setItemKey] = useState<string | null>(() => itemFromHash(location.hash));
  const now = useNow();
  const reading = useQuery(api.phone.reading, { token });
  const inbox = useQuery(api.phone.inbox, { token });

  useEffect(() => {
    const on = () => {
      const k = itemFromHash(location.hash);
      setItemKey(k);
      if (k !== null) setTab("inbox");
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const open = useCallback((key: string | null) => {
    setItemKey(key);
    history.replaceState(null, "", key === null ? location.pathname : `#item=${encodeURIComponent(key)}`);
  }, []);

  const fresh = useMemo(() => freshness(reading, now), [reading, now]);
  const summary = reading?.summary ?? null;
  const label = summary?.label ?? "Linux machine";
  const items = inbox ?? [];
  const item = itemKey === null ? null : (items.find((i) => i.key === itemKey) ?? null);

  return (
    <div className="p-app" data-tab={tab}>
      <main className="p-body">
        {tab === "inbox" && itemKey !== null ? (
          <Item token={token} item={item} fresh={fresh} label={label} now={now} onBack={() => open(null)} onUnpaired={onUnpaired} />
        ) : tab === "home" ? (
          <Home token={token} onUnpaired={onUnpaired} summary={summary} items={items} fresh={fresh} label={label} now={now} onOpen={(k) => { setTab("inbox"); open(k); }} />
        ) : tab === "inbox" ? (
          <Inbox items={items} loading={inbox === undefined} fresh={fresh} label={label} now={now} onOpen={open} />
        ) : tab === "crew" ? (
          <Crew summary={summary} fresh={fresh} label={label} />
        ) : (
          <Factory />
        )}
      </main>
      <nav className="p-tabs" aria-label="Tabs">
        {TABS.map((t) => (
          <button key={t} type="button" aria-current={tab === t ? "page" : undefined} onClick={() => { setTab(t); if (t !== "inbox") open(null); }}>
            {TAB_WORDS[t]}
            {t === "inbox" && inboxCount(items) > 0 && <b>{inboxCount(items)}</b>}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  const [token, setToken] = useState<string | null>(() => readToken());
  const [removed, setRemoved] = useState(false);
  const pair = useMutation(api.phone.pair);
  const fromAddress = useMemo(() => codeFromHash(location.hash), []);

  const unpaired = useCallback(() => {
    clearToken();
    setToken(null);
    setRemoved(true);
  }, []);

  if (token === null) {
    return (
      <Pair
        initialCode={fromAddress}
        removed={removed}
        onPair={async (code, name) => {
          const r = await pair({ code, name });
          if (r.error !== undefined) return r.error;
          if (r.token === undefined) return "Couldn't pair. Try again.";
          if (!writeToken(r.token)) return "This browser won't keep the pairing. Open the page in Safari, not a private window.";
          history.replaceState(null, "", location.pathname);
          setRemoved(false);
          setToken(r.token);
          return null;
        }}
      />
    );
  }
  return <Paired token={token} onUnpaired={unpaired} />;
}
