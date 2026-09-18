import { useState, type ReactNode } from "react";
import { hostingerListVms, removeHostingerToken, saveHostingerToken, setHostingerVm, type SettingsView, type VpsChoice } from "../api.ts";

// Settings → Hostinger (prd-hostinger-usage.md §3 Configure). The token form is the Convex one; the difference
// is the picker, because the machine is chosen from the account rather than typed as a numeric id (R4).

/** Copied from the Settings page rather than widened — see the note in `ConvexSection`. */
type Props = {
  settings: SettingsView;
  act: (section: string, what: () => Promise<void>, done?: string) => Promise<void>;
  note: (section: string) => ReactNode;
};

export function HostingerSection({ settings, act, note }: Props) {
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [vms, setVms] = useState<VpsChoice[] | null>(null);
  const [listing, setListing] = useState(false);

  return (
    <section className="settings-section" data-section="hostinger">
      <h2>Hostinger VPS</h2>
      <p className="muted">
        Create the token in hPanel under Account → API, and <strong>give it an expiry</strong>. Hostinger has no read-only scope — its tokens carry
        the owning account&apos;s permissions — so &ldquo;watch-only&rdquo; here is a property of Kinas, which only ever sends GET requests and has
        tests proving it, rather than of the token itself.
      </p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          void act("hostinger", () => saveHostingerToken(token), "Saved").finally(() => {
            setSaving(false);
            setToken("");
          });
        }}
      >
        <input
          type="password"
          className="field"
          autoComplete="off"
          aria-label="Hostinger API token"
          placeholder={settings.hostinger_key_saved ? "A token is saved" : "No token saved"}
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
        />
        {/* Labelled for the same reason as Convex's: several buttons on this page say "Save". */}
        <button type="submit" className="button" aria-label="Save Hostinger API token" disabled={saving || token.trim() === ""}>
          {saving ? "Saving…" : "Save"}
        </button>
        {settings.hostinger_key_saved && (
          <button type="button" className="button" onClick={() => void act("hostinger", () => removeHostingerToken(), "Removed")}>
            Remove
          </button>
        )}
      </form>

      <div className="row">
        {/* The list is fetched on demand and stored nowhere: only the chosen id is written. */}
        <button
          type="button"
          className="button"
          aria-label="List Hostinger VPS"
          disabled={!settings.hostinger_key_saved || listing}
          onClick={() => {
            setListing(true);
            void act("hostinger", () => hostingerListVms().then((list) => setVms(list))).finally(() => setListing(false));
          }}
        >
          {listing ? "Listing…" : "List my VPS"}
        </button>
        {settings.hostinger_vm_label !== "" && <span className="muted">Watching {settings.hostinger_vm_label}</span>}
      </div>

      {vms !== null && (
        <div className="row">
          <label className="muted" htmlFor="hostinger-vm">
            VPS
          </label>
          <select
            id="hostinger-vm"
            className="field"
            aria-label="Hostinger VPS"
            value={settings.hostinger_vm_id ?? ""}
            onChange={(e) => {
              const raw = e.currentTarget.value;
              // "None" disconnects it, which means zero requests rather than a request that fails (R4).
              if (raw === "") {
                void act("hostinger", () => setHostingerVm(null, ""), "VPS cleared");
                return;
              }
              const id = Number(raw);
              const chosen = vms.find((v) => v.id === id);
              void act("hostinger", () => setHostingerVm(id, chosen ? `${chosen.hostname} · ${chosen.plan}` : String(id)), "VPS saved");
            }}
          >
            <option value="">None</option>
            {vms.map((v) => (
              <option key={v.id} value={v.id}>
                {v.hostname} — {v.plan}, {v.state}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="muted">One machine, resource usage only. Snapshots, backups, firewall rules and Docker containers are not shown.</p>
      {note("hostinger")}
    </section>
  );
}
