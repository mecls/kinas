import { EmptyState, Section, SectionHeader, TitleRow } from "../ui/index.ts";

// Home (DESIGN.md §5; keymap.md ⌘1): the first screen since 2026-09-22. Its anatomy is the preview's — Overnight,
// Waiting on you, Usage — and until the Home slice of the design-system build fills them, each section says plainly
// what it has, which is nothing: the crew comes with Build 3, and the readings are on the Usage page one click away.
// Always mounted, like every page (App.tsx); `hidden` is the shell's.
export function HomePage({ onGo }: { onGo: (page: "usage") => void }) {
  return (
    <div className="page-in home">
      <TitleRow title="Home" />
      <Section aria-label="Overnight" data-section="overnight">
        <SectionHeader title="Overnight" />
        <EmptyState>Nothing ran overnight — the crew arrives with Build 3.</EmptyState>
      </Section>
      <Section aria-label="Waiting on you" data-section="waiting">
        <SectionHeader title="Waiting on you" />
        <EmptyState>Nothing waiting on you.</EmptyState>
      </Section>
      <Section aria-label="Usage" data-section="usage">
        <SectionHeader title="Usage" action={{ label: "Open usage", onClick: () => onGo("usage") }} />
        <EmptyState>The readings are on the Usage page.</EmptyState>
      </Section>
    </div>
  );
}
