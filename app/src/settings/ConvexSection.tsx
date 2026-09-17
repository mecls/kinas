import { useState, type ReactNode } from "react";
import { removeConvexKey, saveConvexKey, setConvexDeployment, setConvexPlan, type SettingsView } from "../api.ts";

// Settings → Convex (prd-convex-usage.md §3 Configure). The key form is the Ollama one: a password input whose
// *placeholder* says whether a key is saved — never its value — and which clears on submit.
//
// Self-contained state on purpose, so this owns its three fields without reaching into the Settings page's own.

/**
 * What the Settings page hands down: `act` runs a command and shows a per-section message; `note` renders it.
 *
 * `act`'s signature is copied from the page rather than widened. Typing the callback as `() => Promise<unknown>`
 * looks more permissive but is the opposite: a function returning `Promise<unknown>` cannot be passed where
 * `Promise<void>` is expected, so the page's own `act` would not satisfy it.
 */
type Props = {
  settings: SettingsView;
  act: (section: string, what: () => Promise<void>, done?: string) => Promise<void>;
  note: (section: string) => ReactNode;
};

export function ConvexSection({ settings, act, note }: Props) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <section className="settings-section" data-section="convex">
      <h2>Convex usage</h2>
      <p className="muted">
        Mint the deploy key in the deployment&apos;s Settings with <strong>only</strong> <code>deployment:usage:view</code>. So scoped it cannot deploy,
        read or write data, run functions, or read environment variables — and Kinas only ever reads.
      </p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          void act("convex", () => saveConvexKey(key), "Saved").finally(() => {
            setSaving(false);
            setKey("");
          });
        }}
      >
        <input
          type="password"
          className="field"
          autoComplete="off"
          aria-label="Convex deploy key"
          placeholder={settings.convex_key_saved ? "A key is saved" : "No key saved"}
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
        />
        {/* Labelled, because there is more than one "Save" on this page and a text selector would match the
            first — which is Ollama's. The embedded driver refuses a text selector mixed with CSS, so an
            aria-label is the only way for a test to name this button unambiguously. */}
        <button type="submit" className="button" aria-label="Save Convex deploy key" disabled={saving || key.trim() === ""}>
          {saving ? "Saving…" : "Save"}
        </button>
        {settings.convex_key_saved && (
          <button type="button" className="button" onClick={() => void act("convex", () => removeConvexKey(), "Removed")}>
            Remove
          </button>
        )}
      </form>

      <div className="row">
        {/* Saved on blur, like the other text settings. `defaultValue` rather than a controlled value, so a
            settings reload cannot fight what is being typed. Empty disconnects the deployment: no requests. */}
        <input
          type="url"
          className="field"
          autoComplete="off"
          aria-label="Convex deployment URL"
          placeholder="https://your-deployment.convex.cloud"
          defaultValue={settings.convex_deployment_url}
          onBlur={(e) => {
            const url = e.currentTarget.value.trim();
            if (url === settings.convex_deployment_url) return;
            void act("convex", () => setConvexDeployment(url), url === "" ? "Deployment cleared" : "Deployment saved");
          }}
        />
      </div>

      <div className="row">
        <label className="muted" htmlFor="convex-plan">
          Plan
        </label>
        {/* The tier only chooses which published allowances the gauges divide by (R6). */}
        <select
          id="convex-plan"
          className="field"
          aria-label="Convex plan"
          value={settings.convex_plan === "professional" ? "professional" : "starter"}
          onChange={(e) => void act("convex", () => setConvexPlan(e.currentTarget.value), "Plan saved")}
        >
          <option value="starter">Starter</option>
          <option value="professional">Professional</option>
        </select>
      </div>

      <p className="muted">
        One deployment, and per-deployment figures rather than team-wide ones. Storage, file storage, backups and seats are not in this API at all.
      </p>
      {note("convex")}
    </section>
  );
}
