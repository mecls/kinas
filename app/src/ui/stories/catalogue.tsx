import type { ReactNode } from "react";
import {
  AccentField,
  Badges,
  Bar,
  Button,
  Card,
  ChangeMark,
  ChangesIcon,
  Diff,
  DiffRefusal,
  type DiffShape,
  CheckIcon,
  ChecksList,
  Chip,
  ConnectionRow,
  CrewIcon,
  Dot,
  EmptyState,
  Field,
  FolderIcon,
  Gauge,
  GaugeIcon,
  Gauges,
  GearIcon,
  HomeIcon,
  InboxIcon,
  Inbox,
  InboxItem,
  Input,
  Lane,
  Menu,
  MetricRow,
  NavHeading,
  NavItem,
  PanelBody,
  PanelFooter,
  PanelHeader,
  PinIcon,
  PinOffIcon,
  RefreshIcon,
  BackIcon,
  EyeIcon,
  CodeIcon,
  ListIcon,
  ExpandIcon,
  CollapseIcon,
  PlusIcon,
  ProgressList,
  ProgressRow,
  QuestionCard,
  Rows,
  Section,
  SectionHeader,
  SegBar,
  StatusBadge,
  HealthBadge,
  Switch,
  Table,
  TabStrip,
  Tag,
  TerminalChrome,
  TerminalIcon,
  Timeline,
  TitleBar,
  TitleRow,
  Toast,
  Wordmark,
  BADGE,
  type BadgeState,
} from "../index.ts";

// One story per state DESIGN.md §4 names, with the preview's own copy (design/preview.html, the component section,
// lines 517–616). stories.test.ts holds this list to the library's exports; stories.e2e.ts renders it in both themes.
// (Named catalogue.tsx because the page is Stories.tsx and the disk does not tell the two apart by case.)

export interface Story {
  component: string;
  states: { name: string; node: ReactNode }[];
}

const noop = () => {};
const STATES = Object.keys(BADGE) as BadgeState[];
// A tree row's name and its mark, as the file tree lays them out: the name takes the row, the mark sits at its end.
const withMark = (name: string, mark: ReactNode) => (
  <span style={{ display: "inline-flex", alignItems: "center", width: "var(--sidebar-w)", justifyContent: "space-between" }}>
    {name} {mark}
  </span>
);
// A file edited since 14:02: two lines changed, one added, and a long unchanged run folded between them.
const EDITED: DiffShape = {
  mark: "M",
  added: 3,
  removed: 1,
  folds: [{ id: 0, lines: 34 }],
  rows: [
    { kind: "context", old: 1, new: 1, text: "# Overview", fold: null },
    { kind: "context", old: 2, new: 2, text: "", fold: null },
    { kind: "remove", old: 3, new: null, text: "Kinas reads what agents write.", fold: null },
    { kind: "add", old: null, new: 3, text: "Kinas reads what agents write, and marks what they change.", fold: null },
    { kind: "context", old: 4, new: 4, text: "", fold: null },
    { kind: "context", old: 5, new: 5, text: "## The reader", fold: null },
    { kind: "context", old: 6, new: 6, text: "", fold: null },
    ...Array.from({ length: 34 }, (_, i) => ({ kind: "context" as const, old: 7 + i, new: 7 + i, text: `Line ${7 + i} of the overview.`, fold: 0 })),
    { kind: "context", old: 41, new: 41, text: "", fold: null },
    { kind: "context", old: 42, new: 42, text: "## Tree changes", fold: null },
    { kind: "context", old: 43, new: 43, text: "", fold: null },
    { kind: "add", old: null, new: 44, text: "Every file tree marks A, M and D since it was first shown.", fold: null },
    { kind: "add", old: null, new: 45, text: "", fold: null },
  ],
};
const GONE: DiffShape = {
  mark: "D",
  added: 0,
  removed: 3,
  folds: [],
  rows: ["# Old plan", "", "Ship the reader first."].map((text, i) => ({ kind: "remove" as const, old: i + 1, new: null, text, fold: null })),
};
const withChip = (cat: 1 | 2 | 3 | 4 | 5 | 6, name: string) => (
  <span style={{ display: "inline-flex", gap: "var(--space-2)", alignItems: "center" }}>
    <Chip cat={cat} /> {name}
  </span>
);

export const STORIES: Story[] = [
  {
    component: "Button",
    states: [
      { name: "primary", node: <Button kind="primary">Approve plan</Button> },
      { name: "secondary", node: <Button>Answer</Button> },
      { name: "text", node: <Button kind="text">Deny</Button> },
      {
        name: "hint",
        node: (
          <Button kind="primary" hint="⌘N">
            <PlusIcon /> Launch task
          </Button>
        ),
      },
      { name: "disabled", node: <Button disabled>Answer</Button> },
    ],
  },
  {
    component: "StatusBadge",
    states: [...STATES.map((state) => ({ name: state as string, node: <StatusBadge state={state} /> })), { name: "counted", node: <StatusBadge state="done" count={4} /> }],
  },
  {
    component: "HealthBadge",
    states: [
      { name: "installed", node: <HealthBadge state="installed" /> },
      { name: "below-floor", node: <HealthBadge state="below_floor" /> },
      { name: "missing", node: <HealthBadge state="missing" /> },
      { name: "optional", node: <HealthBadge state="missing" optional /> },
      { name: "signed-in", node: <HealthBadge state="signed_in" /> },
      { name: "not-signed-in", node: <HealthBadge state="signed_out" /> },
    ],
  },
  {
    component: "Dot",
    states: [
      { name: "solid", node: <Dot color="--ok" /> },
      { name: "ring", node: <Dot color="--warn" kind="ring" /> },
      { name: "cross", node: <Dot color="--ink-3" kind="cross" /> },
    ],
  },
  {
    component: "Chip",
    states: ([1, 2, 3, 4, 5, 6] as const).map((cat) => ({ name: `cat-${cat}`, node: withChip(cat, ["teal", "violet", "walnut", "olive", "rose", "slate"][cat - 1]!) })),
  },
  {
    component: "Tag",
    states: [
      { name: "internal", node: <Tag>internal</Tag> },
      { name: "order", node: <Tag>order</Tag> },
    ],
  },
  {
    component: "ChangeMark",
    states: [
      { name: "added", node: withMark("new-note.md", <ChangeMark mark="A" words="new-note.md, added since 14:02" />) },
      { name: "modified", node: withMark("overview.md", <ChangeMark mark="M" words="overview.md, modified since 14:02" />) },
      { name: "deleted", node: withMark("old-plan.md", <ChangeMark mark="D" words="old-plan.md, deleted since 14:02" />) },
      { name: "rollup", node: withMark("docs", <ChangeMark mark="D" count={3} words="docs, 3 changes inside since 14:02" />) },
      { name: "rollup-many", node: withMark("app", <ChangeMark mark="M" count={150} words="app, 150 changes inside since 14:02" />) },
    ],
  },
  {
    component: "Gauge",
    states: [
      { name: "fine", node: <Gauge title="Fine" used={42} unit="% used" detail="resets in 3 h 43 m" /> },
      { name: "warn", node: <Gauge title="Past 80 %" used={84} unit="% of 100 GB" tone="warn" detail="about 16 GB left" /> },
      { name: "danger", node: <Gauge title="Past 95 %" used={97} unit="% used" tone="danger" detail="resets Thursday 14:00" /> },
      { name: "stale", node: <Gauge title="Stale" used={71} unit="% used" tone="stale" muted detail="09:02, stale" /> },
      { name: "dead", node: <Gauge title="Dead" used={null} unit="% used" dead detail="last seen yesterday 22:10" /> },
    ],
  },
  {
    component: "Bar",
    states: [
      { name: "fine", node: <Bar pct={42} /> },
      { name: "warn", node: <Bar pct={84} tone="warn" /> },
      { name: "danger", node: <Bar pct={97} tone="danger" /> },
      { name: "stale", node: <Bar pct={71} tone="stale" /> },
      { name: "inline", node: <Bar pct={38} inline /> },
      { name: "segmented", node: <SegBar done={4} working={1} wait={1} fail={0} /> },
    ],
  },
  {
    component: "MetricRow",
    states: [
      {
        name: "rows",
        node: (
          <Rows>
            <MetricRow label="Function calls" used={100} value="312" unit="" upperBound />
            <MetricRow label="Database I/O" used={38} value="1.9" unit="of 5 GB" />
            <MetricRow label="File storage" used={12} value="0.6" unit="of 5 GB" />
            <MetricRow label="Action compute" used={27} value="5.4" unit="of 20 GB·h" />
          </Rows>
        ),
      },
      {
        name: "attention",
        node: (
          <Rows title="Needs attention">
            <MetricRow label="Hostinger VPS, disk" used={84} value="84" unit="% of 100 GB" tone="warn" />
            <MetricRow label="Convex, function calls" used={100} value="312" unit="" upperBound />
          </Rows>
        ),
      },
    ],
  },
  {
    component: "SectionHeader",
    states: [
      { name: "reading", node: <SectionHeader title="Usage" caption="as of 09:31" source="Oldest reading on this section" action={{ label: "Open usage", onClick: noop }} /> },
      { name: "activity", node: <SectionHeader title="Overnight" caption="since 23:40 yesterday, 9 h 51 m" source="Source: crew event log" /> },
      { name: "info", node: <SectionHeader title="Convex" caption="as of 09:29" info="Calendar month to date against the billing period's allowance: an upper bound." /> },
      { name: "plain", node: <SectionHeader title="Waiting on you" caption="3 items" action={{ label: "Open inbox", onClick: noop }} /> },
    ],
  },
  {
    component: "TitleRow",
    states: [
      {
        name: "home",
        node: (
          <TitleRow title="Home">
            <Button>
              <Dot color="--warn" kind="ring" /> <span className="ui-num">3</span> waiting on you
            </Button>
            <Button kind="primary" hint="⌘N">
              <PlusIcon /> Launch task
            </Button>
          </TitleRow>
        ),
      },
    ],
  },
  {
    component: "Table",
    states: [
      {
        name: "today",
        node: (
          <Table
            columns={[
              { key: "provider", label: "Today" },
              { key: "requests", label: "Requests", align: "right" },
              { key: "cost", label: "Cost", align: "right" },
            ]}
            rows={[
              { provider: withChip(6, "Claude"), requests: "412", cost: <>0.00 <span className="ui-unit">plan</span></> },
              { provider: withChip(2, "Codex"), requests: "186", cost: <>0.00 <span className="ui-unit">plan</span></> },
              { provider: withChip(3, "Ollama"), requests: "1,904", cost: <>3.12 <span className="ui-unit">credits</span></> },
            ]}
          />
        ),
      },
    ],
  },
  {
    component: "Card",
    states: [
      {
        name: "plain",
        node: (
          <Card title="Client list CSV export">
            <StatusBadge state="done" />
          </Card>
        ),
      },
      {
        name: "selected",
        node: (
          <Card title="Inventory sync rewrite" selected>
            <StatusBadge state="decision" />
          </Card>
        ),
      },
    ],
  },
  {
    component: "Lane",
    states: [
      {
        name: "with-cards",
        node: (
          <Lane name="ar-watches" cat={1} slots="Claude 1/1 · Codex 1/2">
            <Card title="Inventory sync rewrite" selected>
              <StatusBadge state="decision" />
            </Card>
            <Card title="Client list CSV export">
              <StatusBadge state="done" />
            </Card>
          </Lane>
        ),
      },
      { name: "empty", node: <Lane name="arc-edu" cat={2} slots="Claude 0/1 · Codex 0/2" /> },
      {
        name: "no-chip",
        node: (
          <Lane name="tools-cli">
            <Card title="Upgrade the argument parser">
              <StatusBadge state="working" />
            </Card>
          </Lane>
        ),
      },
      {
        // 1.4, the first mate: an internal folder's lane, counted in Firstmate's words.
        name: "internal",
        node: (
          <Lane name="kinas" cat={3} internal counts="1 in flight · 2 queued">
            <Card title="Which pages load slowest?">
              <StatusBadge state="working" />
            </Card>
          </Lane>
        ),
      },
    ],
  },
  {
    component: "ProgressRow",
    states: [
      {
        name: "list",
        node: (
          <ProgressList label="Client folders">
            <ProgressRow cat={1} name="ar-watches" event="Plan ready for you: inventory sync rewrite, 05:48" seg={{ done: 4, working: 0, wait: 1, fail: 0 }} badges={[{ state: "decision", count: 1 }, { state: "done", count: 4 }]} selected onSelect={noop} />
            <ProgressRow cat={2} name="arc-edu" event="Working: enrolment export to Drive, started 04:10" seg={{ done: 2, working: 1, wait: 0, fail: 0 }} badges={[{ state: "working", count: 1 }, { state: "done", count: 2 }]} onSelect={noop} />
            <ProgressRow cat={3} name="acme-9c2e-site" event="CI red on PR #31: build failed, 03:22" seg={{ done: 1, working: 0, wait: 0, fail: 1 }} badges={[{ state: "red", count: 1 }, { state: "done", count: 1 }]} onSelect={noop} />
            <ProgressRow cat={5} name="kinas" internal event="PR #142 open: gauge stale state, 06:12" seg={{ done: 5, working: 0, wait: 2, fail: 0 }} badges={[{ state: "pr", count: 2 }, { state: "done", count: 5 }]} onSelect={noop} />
          </ProgressList>
        ),
      },
      {
        name: "quiet",
        node: (
          <ProgressList label="Client folders">
            <ProgressRow cat={4} name="client-portal" event="No work overnight" onSelect={noop} />
          </ProgressList>
        ),
      },
    ],
  },
  {
    component: "InboxItem",
    states: [
      {
        name: "plan",
        node: (
          <Inbox>
            <InboxItem cat={1} question="Store the supplier webhook secret in Convex env or the VPS keychain?" recommendation="Recommendation: Convex env, so preview deploys get it too." approveLabel="Approve plan" approveHint="A" onApprove={noop} onAnswer={noop} onDeny={noop} />
            <InboxItem cat={5} question="Review PR #142: gauge stale state" recommendation="All checks pass. Two screenshots changed, both expected." approveLabel="Approve PR" approveHint="A" onApprove={noop} onAnswer={noop} onDeny={noop} />
          </Inbox>
        ),
      },
      // 1.4 and 1.7, the first mate: a crew decision carries a question alone, then its quiet line; its answers go on
      // the clipboard for the first mate's pane.
      {
        name: "decision",
        node: (
          <Inbox>
            <InboxItem
              cat={1}
              keys
              question="REST or GraphQL for the export listing?"
              context={<>Export listing as CSV · <span className="ui-mono">api-shape</span> · 12 min ago</>}
              onApprove={noop}
              onAnswer={noop}
              onDeny={noop}
            />
          </Inbox>
        ),
      },
      {
        name: "answering",
        node: (
          <Inbox>
            <InboxItem
              cat={1}
              keys
              state="answering"
              question="Keep the CSV import as a fallback for one release?"
              context={<>Webhook for stock changes · <span className="ui-mono">fallback</span> · 25 min ago</>}
              answer="Yes — keep it for one release, then remove it."
              onApprove={noop}
              onAnswer={noop}
              onDeny={noop}
            />
          </Inbox>
        ),
      },
      {
        name: "copied",
        node: (
          <Inbox>
            <InboxItem
              cat={2}
              keys
              question="Ship dark mode behind a setting or on for everyone?"
              context={<>Dark mode for the portal · <span className="ui-mono">rollout</span> · 1 h ago</>}
              copied="Copied 09:28 — paste it into the first mate's pane"
              onApprove={noop}
              onAnswer={noop}
              onDeny={noop}
            />
          </Inbox>
        ),
      },
      {
        name: "compact",
        node: (
          <Inbox>
            <InboxItem cat={3} compact keys question="Is a 2 MB export size limit acceptable?" context="How is the reader's export guarded? · 2 h ago" onApprove={noop} onAnswer={noop} onDeny={noop} />
          </Inbox>
        ),
      },
    ],
  },
  {
    component: "Timeline",
    states: [
      {
        name: "task",
        node: (
          <Timeline
            items={[
              { time: "23:52", text: "Order: rewrite inventory sync on the supplier webhook", state: "order" },
              { time: "00:14", text: "Codex crewmate started", state: "working" },
              { time: "03:40", text: "Prototype passes 38 of 38 tests", state: "done" },
              { time: "05:48", text: "Plan ready, one decision needed", state: "decision" },
            ]}
          />
        ),
      },
    ],
  },
  {
    component: "Diff",
    states: [
      { name: "modified", node: <Diff view={EDITED} language="markdown" /> },
      { name: "deleted", node: <Diff view={GONE} language="markdown" /> },
      { name: "no-copy", node: <DiffRefusal text="Kinas kept no copy of this file from 14:02, so there is nothing to compare — the folder holds more text than Kinas keeps" /> },
      { name: "too-many", node: <DiffRefusal text="Too many changes to show — 1,204 lines then, 980 now" /> },
    ],
  },
  {
    component: "Toast",
    states: [
      { name: "success", node: <Toast action={{ label: "Undo", onClick: noop }}>Plan approved</Toast> },
      { name: "error", node: <Toast kind="error">CI failed on PR #31. Open the checks to see the build error.</Toast> },
    ],
  },
  {
    component: "EmptyState",
    states: [
      { name: "with-action", node: <EmptyState action={{ label: "Launch task", onClick: noop }}>No work overnight in this folder.</EmptyState> },
      { name: "plain", node: <EmptyState>Nothing waiting on you.</EmptyState> },
    ],
  },
  {
    component: "TerminalChrome",
    states: [
      {
        name: "working",
        node: (
          <div style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--line)" }}>
            <TerminalChrome session="crew-3 · ar-watches" state="working" profile="codex" actions={[{ label: "Detach", onClick: noop }, { label: "Copy", onClick: noop }]} />
            <pre style={{ margin: 0, background: "var(--term-bg)", color: "var(--term-fg)", font: "var(--fs-sm)/1.6 var(--font-mono)", padding: "var(--space-4)" }}>
              {"~/clients/ar-watches $ pnpm test\n ✓ inventory/webhook.verify (12)\n ✓ inventory/stock.write (26)\nTest files  2 passed · Tests  38 passed · 4.1 s"}
            </pre>
          </div>
        ),
      },
      // DESIGN.md 1.4: the badge is a worker's only, so the shell and the first mate draw none.
      { name: "shell", node: <TerminalChrome session="shell" profile="plain shell" actions={[{ label: "Copy", onClick: noop }]} /> },
      { name: "first-mate", node: <TerminalChrome session="default · firstmate" profile="claude" actions={[{ label: "Copy", onClick: noop }]} /> },
    ],
  },
  {
    component: "Panel",
    states: [
      {
        name: "task-detail",
        node: (
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxWidth: "var(--panel-w)" }}>
            {/* 1.4, the first mate: what Firstmate reports and nothing it does not — no plan, no recommendation. */}
            <PanelHeader cat={1} folder="ar-watches" title="Inventory sync rewrite" state="decision" onClose={() => {}} />
            <PanelBody>
              <h4>State</h4>
              <p>
                <span className="ui-mono">state: parked · source: status-log · waiting on the captain</span>
              </p>
              <h4>The ask</h4>
              <p>Replace the nightly CSV import with the supplier's webhook so stock changes land within a minute.</p>
              <h4>Decision</h4>
              <QuestionCard question="Store the webhook secret in Convex env or the VPS keychain?" />
              <h4>Checks</h4>
              <ChecksList checks={[{ state: "done", name: "build", result: "1 m 12 s" }, { state: "red", name: "next build", result: "failed", error: "next build: Type error in app/booking/page.tsx:41" }]} />
              <h4>Timeline</h4>
              <Timeline items={[{ time: "05:48", text: "Plan ready, one decision needed", state: "decision" }]} />
            </PanelBody>
            <PanelFooter>
              <Button kind="text">Deny</Button>
              <Button>Answer</Button>
              <Button kind="primary">Approve</Button>
            </PanelFooter>
          </div>
        ),
      },
    ],
  },
  {
    component: "Nav",
    states: [
      {
        name: "sidebar",
        node: (
          <div style={{ width: "var(--sidebar-w)", display: "flex", flexDirection: "column", gap: "var(--space-0)", padding: "var(--space-3) var(--space-2)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", minHeight: "320px" }}>
            <Wordmark />
            <NavItem icon={<HomeIcon />} label="Home" current />
            <NavItem icon={<TerminalIcon />} label="Work" />
            <NavItem icon={<CrewIcon />} label="Crew" />
            <NavItem icon={<InboxIcon />} label="Inbox" count={3} />
            <NavItem icon={<GaugeIcon />} label="Usage" count={0} />
            <NavHeading>Client folders</NavHeading>
            <NavItem chip={1} label="ar-watches" />
            <NavItem chip={5} label="kinas" tag="internal" />
            <ConnectionRow name="Hostinger VPS" state="connected" />
            <NavItem icon={<GearIcon />} label="Settings" />
          </div>
        ),
      },
      {
        // The four drawn beyond the preview's sprite, for the sidebar's folder rows (icons.tsx): refresh since 1.6.
        name: "folder-icons",
        node: (
          <div style={{ display: "flex", gap: "var(--space-4)", color: "var(--ink-2)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1h)" }}>
              <FolderIcon /> folder
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1h)" }}>
              <PinIcon size="sm" /> pin
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1h)" }}>
              <PinOffIcon size="sm" /> unpin
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1h)" }}>
              <RefreshIcon size="sm" /> refresh
            </span>
          </div>
        ),
      },
      {
        // The reader header's six (slice 6), drawn on the same grid.
        name: "reader-icons",
        node: (
          <div style={{ display: "flex", gap: "var(--space-4)", color: "var(--ink-2)" }}>
            <BackIcon /> <EyeIcon /> <CodeIcon /> <ChangesIcon /> <ListIcon /> <ExpandIcon /> <CollapseIcon />
          </div>
        ),
      },
      {
        name: "connection-states",
        node: (
          <div style={{ width: "var(--sidebar-w)" }}>
            <ConnectionRow name="Hostinger VPS" state="connected" />
            <ConnectionRow name="Hostinger VPS" state="stale" />
            <ConnectionRow name="Hostinger VPS" state="error" detail="HTTP 401" />
          </div>
        ),
      },
    ],
  },
  {
    // DESIGN.md §4 Menu (1.3): the reader's ▾ and the client folders' right-click. A story's menu is placed by its
    // story, not the caller's class; it takes focus as it mounts, as it does in the app, and closing it does nothing.
    component: "Menu",
    states: [
      {
        name: "plain",
        node: <Menu label="acme" items={[{ id: "hide", label: "Hide from sidebar", onSelect: () => {} }, { id: "add", label: "Add a client folder…", onSelect: () => {} }]} onClose={() => {}} />,
      },
      {
        name: "disabled",
        node: (
          <Menu
            label="More actions"
            items={[
              { id: "download", label: "Download a copy", disabledReason: "Open a file to download a copy", onSelect: () => {} },
              { id: "print", label: "Print to PDF…", onSelect: () => {} },
              { id: "pin", label: "Pin to the sidebar", onSelect: () => {} },
            ]}
            onClose={() => {}}
          />
        ),
      },
      {
        name: "divider",
        node: (
          <Menu
            label="Client folders"
            items={[
              { id: "hide", label: "Hide from sidebar", onSelect: () => {} },
              { id: "add", label: "Add a client folder…", onSelect: () => {} },
              { id: "hidden", divider: true },
              { id: "show-acme", label: "Show acme", onSelect: () => {} },
              { id: "show-hub", label: "Show hub", onSelect: () => {} },
            ]}
            onClose={() => {}}
          />
        ),
      },
    ],
  },
  {
    // DESIGN.md §4 Tab strip (1.5): the reader's open files, the showing one joined to the header below it.
    component: "TabStrip",
    states: [
      {
        name: "plain",
        node: (
          <div style={{ width: "calc(var(--sidebar-w) * 3)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--surface)" }}>
            <TabStrip
              label="Open files"
              tabs={[
                { key: "/r/tasks/reader-layout/prd.md", name: "prd.md", detail: null, title: "tasks/reader-layout/prd.md" },
                { key: "/r/tasks/reader-layout/status.md", name: "status.md", detail: null, title: "tasks/reader-layout/status.md" },
                { key: "/r/DESIGN.md", name: "DESIGN.md", detail: null, title: "DESIGN.md" },
              ]}
              selected="/r/tasks/reader-layout/status.md"
              onSelect={noop}
              onClose={noop}
              onMove={noop}
            />
            <div style={{ height: "var(--hit)", borderBottom: "1px solid var(--line)" }} />
          </div>
        ),
      },
      {
        // Fifteen, the most there can be: the strip scrolls sideways inside its box and the page does not.
        name: "many",
        node: (
          <div style={{ width: "calc(var(--sidebar-w) * 3)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--surface)" }}>
            <TabStrip
              label="Open files"
              tabs={Array.from({ length: 15 }, (_, i) => ({ key: `/r/notes-${i + 1}.md`, name: `notes-${i + 1}.md`, detail: null, title: `notes-${i + 1}.md` }))}
              selected="/r/notes-3.md"
              onSelect={noop}
              onClose={noop}
              onMove={noop}
            />
          </div>
        ),
      },
      {
        // Mid-drag: status.md held 90 px right of its place, lifted, and DESIGN.md slid aside to make room for it.
        name: "dragging",
        node: (
          <div style={{ width: "calc(var(--sidebar-w) * 3)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--surface)" }}>
            <TabStrip
              label="Open files"
              tabs={[
                { key: "/r/tasks/reader-layout/prd.md", name: "prd.md", detail: null, title: "tasks/reader-layout/prd.md" },
                { key: "/r/tasks/reader-layout/status.md", name: "status.md", detail: null, title: "tasks/reader-layout/status.md" },
                { key: "/r/DESIGN.md", name: "DESIGN.md", detail: null, title: "DESIGN.md" },
                { key: "/r/keymap.md", name: "keymap.md", detail: null, title: "keymap.md" },
              ]}
              selected="/r/tasks/reader-layout/prd.md"
              onSelect={noop}
              onClose={noop}
              onMove={noop}
              dragPreview={{ key: "/r/tasks/reader-layout/status.md", dx: 90 }}
            />
          </div>
        ),
      },
      {
        name: "same-name",
        node: (
          <div style={{ width: "calc(var(--sidebar-w) * 3)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--surface)" }}>
            <TabStrip
              label="Open files"
              tabs={[
                { key: "/r/tasks/first-mate/prd.md", name: "prd.md", detail: "first-mate", title: "tasks/first-mate/prd.md" },
                { key: "/r/tasks/reader-layout/prd.md", name: "prd.md", detail: "reader-layout", title: "tasks/reader-layout/prd.md" },
                { key: "/r/tasks/reader-layout/status.md", name: "status.md", detail: null, title: "tasks/reader-layout/status.md" },
              ]}
              selected="/r/tasks/reader-layout/prd.md"
              onSelect={noop}
              onClose={noop}
              onMove={noop}
            />
          </div>
        ),
      },
    ],
  },
  {
    // DESIGN.md §4 Title bar (1.5): the window's own. The empty room on the left is where the system draws the
    // traffic lights, which a story cannot; a drag on it moves this window, as it does in the app.
    component: "TitleBar",
    states: [
      {
        // At launch: nothing to go back or forward to.
        name: "start",
        node: (
          <div style={{ width: "calc(var(--sidebar-w) * 3)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <TitleBar sidebarShown sidebarChord="⌘S" onSidebar={noop} canBack={false} canForward={false} onBack={noop} onForward={noop} fullscreen={false} />
          </div>
        ),
      },
      {
        // Somewhere to go both ways: the captain has gone back from a later place.
        name: "back-and-forward",
        node: (
          <div style={{ width: "calc(var(--sidebar-w) * 3)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <TitleBar sidebarShown sidebarChord="⌘S" onSidebar={noop} canBack canForward onBack={noop} onForward={noop} fullscreen={false} />
          </div>
        ),
      },
      {
        name: "sidebar-hidden",
        node: (
          <div style={{ width: "calc(var(--sidebar-w) * 3)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <TitleBar sidebarShown={false} sidebarChord="⌘S" onSidebar={noop} canBack canForward={false} onBack={noop} onForward={noop} fullscreen={false} />
          </div>
        ),
      },
      {
        // No traffic lights, so the buttons start at the bar's padding.
        name: "fullscreen",
        node: (
          <div style={{ width: "calc(var(--sidebar-w) * 3)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <TitleBar sidebarShown sidebarChord="⌘S" onSidebar={noop} canBack canForward onBack={noop} onForward={noop} fullscreen />
          </div>
        ),
      },
    ],
  },
  {
    component: "Field",
    states: [
      {
        name: "text",
        node: (
          <Field label="Organisation name" help="Shown on the launch screen and in the packet.">
            <Input aria-label="Organisation name" defaultValue="Sintra Labs" />
          </Field>
        ),
      },
      {
        name: "secret",
        node: (
          <Field label="Ollama Cloud API key" help="Stored in Keychain">
            <Input type="password" aria-label="Ollama Cloud API key" placeholder="A key is saved" />
            <Button>Save</Button>
          </Field>
        ),
      },
      {
        name: "switch",
        node: (
          <Field label="Ask for a plan before building">
            <Switch checked onChange={noop} aria-label="Ask for a plan before building" />
            <Switch checked={false} onChange={noop} aria-label="Off" />
          </Field>
        ),
      },
      { name: "accent", node: <AccentField value={null} onChange={noop} /> },
    ],
  },
  {
    component: "Section",
    states: [
      {
        name: "usage",
        node: (
          <Section>
            <SectionHeader title="Usage" caption="as of 09:31" source="Oldest reading on this section" action={{ label: "Open usage", onClick: noop }} />
            <Gauges>
              <Gauge title="Claude, this week" used={62} unit="% used" detail="resets Thursday 14:00" />
              <Gauge title="Claude, this session" used={34} unit="% used" detail="resets in 3 h 43 m, 13:30" />
              <Gauge title="Ollama credits" used={71} unit="% used" detail="renews 1 October" />
            </Gauges>
          </Section>
        ),
      },
    ],
  },
  {
    component: "Badges",
    states: [
      {
        name: "row",
        node: (
          <Badges>
            <StatusBadge state="decision" count={1} />
            <StatusBadge state="done" count={4} />
          </Badges>
        ),
      },
    ],
  },
];
