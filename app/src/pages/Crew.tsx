import { EmptyState, TitleRow } from "../ui/index.ts";

// Crew (DESIGN.md §5; keymap.md: click-only, ⌘3 reserved): the bridge over the first mate's fleet, which is Build 3.
// Until then the page says so in one line and offers no button that would do nothing.
export function CrewPage() {
  return (
    <div className="page-in crew">
      <TitleRow title="Crew" />
      <EmptyState>The crew arrives with Build 3.</EmptyState>
    </div>
  );
}
