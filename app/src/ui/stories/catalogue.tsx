import type { ReactNode } from "react";
import {
  AccentField,
  Badges,
  Bar,
  Button,
  Card,
  CheckIcon,
  ChecksList,
  Chip,
  ConnectionRow,
  CrewIcon,
  Dot,
  EmptyState,
  Field,
  FileIcon,
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
  MetricRow,
  NavHeading,
  NavItem,
  PanelBody,
  PanelFooter,
  PanelHeader,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  ProgressList,
  ProgressRow,
  QuestionCard,
  Rows,
  Section,
  SectionHeader,
  SegBar,
  StatusBadge,
  Switch,
  Table,
  Tag,
  TerminalChrome,
  TerminalIcon,
  Timeline,
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
      { name: "shell", node: <TerminalChrome session="default" state="stale" profile="plain shell" actions={[{ label: "Copy", onClick: noop }]} /> },
    ],
  },
  {
    component: "Panel",
    states: [
      {
        name: "task-detail",
        node: (
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxWidth: "var(--panel-w)" }}>
            <PanelHeader cat={1} folder="ar-watches" title="Inventory sync rewrite" state="decision" />
            <PanelBody>
              <h4>Brief</h4>
              <p>Replace the nightly CSV import with the supplier's webhook so stock changes land within a minute.</p>
              <h4>Plan</h4>
              <ol>
                <li>Replace the nightly CSV import with the supplier's webhook.</li>
                <li>Verify each payload with a signed secret.</li>
                <li>Write stock changes to Convex and log them per watch.</li>
                <li>Keep the CSV import as a fallback for one release.</li>
              </ol>
              <h4>Question</h4>
              <QuestionCard question="Store the webhook secret in Convex env or the VPS keychain?" recommendation="Recommendation: Convex env, so preview deploys get it too." />
              <h4>Checks</h4>
              <ChecksList checks={[{ state: "done", name: "build", result: "1 m 12 s" }, { state: "red", name: "next build", result: "failed", error: "next build: Type error in app/booking/page.tsx:41" }]} />
              <h4>Timeline</h4>
              <Timeline items={[{ time: "05:48", text: "Plan ready, one decision needed", state: "decision" }]} />
            </PanelBody>
            <PanelFooter>
              <Button kind="text">Deny</Button>
              <Button>Answer</Button>
              <Button kind="primary">Approve plan</Button>
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
            <NavItem icon={<FileIcon />} label="Reader" />
            <NavItem icon={<GearIcon />} label="Settings" />
            <NavHeading>Client folders</NavHeading>
            <NavItem chip={1} label="ar-watches" />
            <NavItem chip={5} label="kinas" tag="internal" />
            <ConnectionRow name="Hostinger VPS" state="connected" />
          </div>
        ),
      },
      {
        // The three drawn beyond the preview's sprite, for the sidebar's folder rows (icons.tsx).
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
