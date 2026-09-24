import type { CrewSettings, ToolState } from "../api.ts";
import { HealthBadge, Table, type HealthState } from "../ui/index.ts";

// The crew's tools, pinned (build spec §4 Settings; mockups board.html and settings-crew.html): one row per tool of
// crew/pin.rs with its pinned version and its health in DESIGN.md 1.4's words, then gh, signed in or not. The same
// table on the Crew page before the first launch and in Settings → Crew.

const COLUMNS = [
  { key: "tool", label: "Tool" },
  { key: "pinned", label: "Pinned", align: "right" as const },
  { key: "state", label: "State" },
];

function toolRow(t: ToolState) {
  return {
    tool: (
      <>
        {t.name}
        {!t.required && <span className="crew-quiet-inline"> optional</span>}
      </>
    ),
    pinned: t.pinned,
    state: <HealthBadge state={t.state as HealthState} optional={!t.required} />,
    name: t.name,
  };
}

export function ToolTable({ settings }: { settings: CrewSettings }) {
  const gh: HealthState = settings.gh_signed_in === null ? "missing" : settings.gh_signed_in ? "signed_in" : "signed_out";
  const rows = [...settings.tools.map(toolRow), { tool: "gh", pinned: "—", state: <HealthBadge state={gh} />, name: "gh" }];
  return (
    <Table
      className="crew-tools"
      caption="Tools, pinned"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => String(r.name)}
      rowProps={(r) => ({ "data-tool": String(r.name) })}
    />
  );
}
