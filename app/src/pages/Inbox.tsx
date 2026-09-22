import { EmptyState, TitleRow } from "../ui/index.ts";

// Inbox (DESIGN.md §5; keymap.md: click-only): every open decision from the fleet, which is Build 3. Until then
// nothing waits, and the page says exactly that.
export function InboxPage() {
  return (
    <div className="page-in inbox">
      <TitleRow title="Inbox" />
      <EmptyState>Nothing waiting on you.</EmptyState>
    </div>
  );
}
